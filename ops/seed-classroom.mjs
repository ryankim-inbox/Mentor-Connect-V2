import { randomBytes } from "node:crypto";
import { open, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateAppliedMigrations } from "../lib/db/tools/migration-ledger.mjs";
import { verifySchemaAssets } from "../lib/db/tools/schema-assets.mjs";
import { validateClassroomTarget } from "./bootstrap-classroom.mjs";

const { Client } = createRequire(
  new URL("../lib/db/package.json", import.meta.url),
)("pg");

const defaultRootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const accountSpecs = [
  {
    key: "mentor",
    email: "mentor@classroom.example.edu",
    name: "Classroom Mentor",
    role: "mentor",
  },
  {
    key: "mentee",
    email: "mentee@classroom.example.edu",
    name: "Classroom Mentee",
    role: "mentee",
  },
];

function validateOrigin(origin) {
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error("CLASSROOM_ORIGIN must be a valid HTTP origin");
  }
  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    parsed.origin !== origin ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error("CLASSROOM_ORIGIN must be an exact HTTP origin");
  }
  return parsed.origin;
}

function requestId(response) {
  const value = response.headers.get("x-request-id") ?? "";
  return /^[A-Za-z0-9._-]{1,128}$/.test(value) ? value : "unavailable";
}

function responseCookie(response) {
  const values = response.headers.getSetCookie?.() ?? [
    response.headers.get("set-cookie"),
  ];
  for (const value of values) {
    const pair = value?.split(";", 1)[0] ?? "";
    const separator = pair.indexOf("=");
    if (
      pair.slice(0, separator) === "peerbridge_session" &&
      pair.length <= 4096 &&
      !/[\s;,\r\n]/.test(pair)
    ) {
      return pair;
    }
  }
  throw new Error(
    "classroom register response did not set a safe session cookie",
  );
}

async function apiJson({ origin, method, pathname, body, cookie }) {
  const response = await fetch(new URL(pathname, origin), {
    method,
    redirect: "error",
    headers: {
      "content-type": "application/json",
      origin,
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(
      `classroom API ${method} failed with status ${response.status} (request ${requestId(response)})`,
    );
  }
  try {
    return { response, payload: await response.json() };
  } catch {
    throw new Error(
      `classroom API ${method} returned invalid JSON with status ${response.status} (request ${requestId(response)})`,
    );
  }
}

function validatedRegisteredUser(payload, expected) {
  const user = payload?.user;
  if (
    !Number.isSafeInteger(user?.id) ||
    user.id <= 0 ||
    user.email !== expected.email ||
    user.role !== expected.role ||
    user.districtId !== expected.districtId
  ) {
    throw new Error("classroom register response has an invalid user record");
  }
  return user;
}

async function verifySelectedDatabaseUser(client, user, expected) {
  const { rows } = await client.query(
    `SELECT id, email, role, district_id AS "districtId", subjects
     FROM users WHERE id = $1`,
    [user.id],
  );
  const selected = rows[0];
  if (
    selected?.id !== user.id ||
    selected.email !== expected.email ||
    selected.role !== expected.role ||
    selected.districtId !== expected.districtId
  ) {
    throw new Error(
      "classroom register response does not match the selected database",
    );
  }
  return selected;
}

async function prepareBaseFixtures({
  client,
  ledger,
  fixtureSql,
  credentialFile,
}) {
  let credentialHandle;
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL search_path TO public, pg_catalog");
    await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [
      ledger.advisoryLockKey,
    ]);
    const applied = await client.query(`
      SELECT ordinal, migration_id AS "migrationId", checksum,
             applied_at AS "appliedAt", app_sha AS "appSha"
      FROM mentor_connect_schema_migrations
      ORDER BY ordinal
    `);
    if (validateAppliedMigrations(ledger.migrations, applied.rows).length > 0) {
      throw new Error("classroom seed requires schema version 0002");
    }
    const population = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM districts
        UNION ALL SELECT 1 FROM tags
        UNION ALL SELECT 1 FROM users
        UNION ALL SELECT 1 FROM questions
        UNION ALL SELECT 1 FROM chat_rooms
      ) AS populated
    `);
    if (population.rows[0]?.populated) {
      throw new Error("classroom seed requires an unseeded database");
    }
    credentialHandle = await open(credentialFile, "wx", 0o600);
    await client.query(fixtureSql);
    const fixtures = await client.query(`
      SELECT
        ARRAY(SELECT id FROM districts ORDER BY id) AS "districtIds",
        (SELECT id FROM chat_rooms WHERE type = 'global') AS "globalRoomId"
    `);
    await client.query("COMMIT");
    return { credentialHandle, ...fixtures.rows[0] };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (credentialHandle) await credentialHandle.close().catch(() => {});
    throw error;
  }
}

export async function seedClassroom({
  client,
  origin,
  credentialFile,
  rootDir = defaultRootDir,
}) {
  const classroomOrigin = validateOrigin(origin);
  if (!credentialFile) throw new Error("CLASSROOM_CREDENTIAL_FILE is required");
  const [{ ledger }, fixtureSql] = await Promise.all([
    verifySchemaAssets({ rootDir }),
    readFile(path.join(rootDir, "database/fixtures/classroom.sql"), "utf8"),
  ]);
  const prepared = await prepareBaseFixtures({
    client,
    ledger,
    fixtureSql,
    credentialFile,
  });
  const accounts = {};
  try {
    for (const account of accountSpecs) {
      const password = randomBytes(24).toString("base64url");
      const expected = {
        ...account,
        districtId: prepared.districtIds[0],
      };
      const registered = await apiJson({
        origin: classroomOrigin,
        method: "POST",
        pathname: "/api/auth/register",
        body: {
          email: account.email,
          name: account.name,
          password,
          role: account.role,
          districtId: expected.districtId,
        },
      });
      const user = validatedRegisteredUser(registered.payload, expected);
      await verifySelectedDatabaseUser(client, user, expected);
      accounts[account.key] = { id: user.id, email: user.email, password };

      if (account.key === "mentor") {
        const cookie = responseCookie(registered.response);
        const updated = await apiJson({
          origin: classroomOrigin,
          method: "PATCH",
          pathname: `/api/users/${user.id}`,
          body: { subjects: ["Math"] },
          cookie,
        });
        if (updated.payload?.id !== user.id) {
          throw new Error(
            "classroom mentor profile response has an invalid user record",
          );
        }
        const selected = await verifySelectedDatabaseUser(
          client,
          user,
          expected,
        );
        if (
          !Array.isArray(selected.subjects) ||
          selected.subjects.length !== 1 ||
          selected.subjects[0] !== "Math"
        ) {
          throw new Error(
            "classroom mentor subjects do not match the selected database",
          );
        }
      }
    }

    const question = await client.query(
      `INSERT INTO questions (student_id, subject, topic, message)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [accounts.mentee.id, "Math", "Algebra", "Classroom practice question"],
    );
    const credentials = {
      accounts,
      fixtures: {
        questionId: question.rows[0].id,
        globalRoomId: prepared.globalRoomId,
        districtIds: prepared.districtIds,
      },
    };
    await prepared.credentialHandle.writeFile(
      `${JSON.stringify(credentials, null, 2)}\n`,
      "utf8",
    );
    await prepared.credentialHandle.sync();
    return credentials;
  } finally {
    await prepared.credentialHandle.close();
  }
}

async function main() {
  const target = validateClassroomTarget({
    databaseUrl: process.env.CLASSROOM_DATABASE_URL,
    allowedHost: process.env.CLASSROOM_ALLOWED_HOST,
    databaseName: process.env.CLASSROOM_DATABASE_NAME,
  });
  const origin = validateOrigin(process.env.CLASSROOM_ORIGIN);
  if (!process.env.CLASSROOM_CREDENTIAL_FILE) {
    throw new Error("CLASSROOM_CREDENTIAL_FILE is required");
  }
  const client = new Client({ connectionString: target.databaseUrl });
  try {
    await client.connect();
    const result = await seedClassroom({
      client,
      origin,
      credentialFile: process.env.CLASSROOM_CREDENTIAL_FILE,
    });
    console.log(
      JSON.stringify({
        accountIds: {
          mentor: result.accounts.mentor.id,
          mentee: result.accounts.mentee.id,
        },
        fixtures: result.fixtures,
      }),
    );
  } finally {
    await client.end();
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(`classroom seed rejected: ${error.message}`);
    process.exitCode = 1;
  });
}
