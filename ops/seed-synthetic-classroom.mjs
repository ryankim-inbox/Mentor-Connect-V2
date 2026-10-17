import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateAppliedMigrations } from "../lib/db/tools/migration-ledger.mjs";
import { verifySchemaAssets } from "../lib/db/tools/schema-assets.mjs";
import { classroomConnection } from "./classroom-snapshot.mjs";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const SYNTHETIC_BATCH = "mc-synthetic-v1-983-782";
export const SYNTHETIC_PASSWORD_LOCK = `!mentor-connect-synthetic:v1:${SYNTHETIC_BATCH}`;
const marker = `[Synthetic ${SYNTHETIC_BATCH}]`;
const DAY = 86_400_000;
const slots = [
  "Mon 16:00",
  "Tue 17:00",
  "Wed 18:00",
  "Thu 16:00",
  "Fri 17:00",
  "Sat 10:00",
  "Sun 14:00",
];
const tables = [
  "users",
  "questions",
  "requests",
  "schedules",
  "request_tags",
  "request_applications",
  "request_comments",
  "request_events",
];

export function syntheticSeedConnection(options) {
  const connection = classroomConnection(options);
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(
    connection.target.hostname,
  );
  if (!local && connection.env.PGSSLMODE !== "verify-full")
    throw new Error(
      "synthetic seed requires certificate-verified TLS outside loopback",
    );
  return connection;
}

function canonical(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
const serialize = (value) => JSON.stringify(canonical(value));
const iso = (millis) => new Date(millis).toISOString();
const pad = (value) => String(value).padStart(4, "0");

/** Pure plan: no random names, login credentials, provider calls, or inferred ownership. */
export function buildSyntheticPlan({
  asOf,
  trackingStartedAt,
  districts,
  tags,
}) {
  if (
    typeof asOf !== "string" ||
    !Number.isFinite(Date.parse(asOf)) ||
    iso(Date.parse(asOf)) !== asOf
  ) {
    throw new Error(
      "SYNTHETIC_AS_OF must be an exact UTC ISO timestamp with milliseconds",
    );
  }
  const anchor = Date.parse(asOf);
  const started =
    trackingStartedAt instanceof Date
      ? trackingStartedAt.getTime()
      : Date.parse(trackingStartedAt);
  if (!Number.isFinite(started) || started > anchor)
    throw new Error(
      "synthetic anchor must be at or after match tracking started",
    );
  if (!districts?.length || !tags?.length)
    throw new Error("synthetic seed requires existing districts and tags");
  const districtIds = districts
    .map((d) => d.id)
    .sort((a, b) => a - b)
    .slice(0, 2);
  const subjects = [...tags].sort((a, b) => a.id - b.id).slice(0, 6);
  const plan = Object.fromEntries(tables.map((table) => [table, []]));
  for (let i = 0; i < 983; i++) {
    const available = [slots[i % slots.length], slots[(i + 2) % slots.length]];
    const created = iso(
      anchor - (i < 900 ? 60 + (i % 300) : (i - 900) % 28) * DAY,
    );
    plan.users.push({
      email: `student-${pad(i + 1)}@${SYNTHETIC_BATCH}.invalid`,
      name: `[Synthetic] Student ${pad(i + 1)}`,
      password_hash: SYNTHETIC_PASSWORD_LOCK,
      role: i < 600 ? "mentee" : i < 850 ? "mentor" : "both",
      district_id: districtIds[i % districtIds.length],
      bio: `${marker} Fictional classroom profile. No login or email delivery.`,
      subjects: [subjects[i % subjects.length].name],
      is_verified: false,
      email_verified_at: null,
      is_admin: false,
      created_at: created,
      updated_at: created,
      location: "Synthetic classroom",
      available_times: available,
      languages: ["English"],
      grade_level: String(9 + (i % 4)),
      teaching_style: ["Examples", "Step by step", "Practice"][i % 3],
    });
    for (const slot of available)
      plan.schedules.push({ user_id: i, slot, created_at: created });
  }
  for (let i = 0; i < 782; i++) {
    const student = i % 600;
    const subject = subjects[i % subjects.length];
    const author = plan.users[student];
    const mentor = plan.users.findIndex(
      (u, index) =>
        index >= 600 &&
        index < 850 &&
        u.district_id === author.district_id &&
        u.subjects.includes(subject.name),
    );
    if (mentor < 0)
      throw new Error(
        "synthetic seed could not form a subject/district peer pair",
      );
    const created = iso(anchor - (1 + (i % 56)) * DAY);
    const floor = Math.max(started, Date.parse(created) + 3_600_000);
    const matchedAt = iso(
      Math.floor(floor + (anchor - floor) * (((i % 97) + 1) / 98)),
    );
    const status = i % 10 < 6 ? "open" : i % 10 < 9 ? "matched" : "closed";
    const title = `[Synthetic] ${subject.name} study question ${pad(i + 1)}`;
    const message = `${marker} Question ${pad(i + 1)}: Can a peer explain a ${subject.name} example and help me check my practice work?`;
    const times = author.available_times;
    plan.questions.push({
      student_id: student,
      subject: subject.name,
      topic: `Practice ${1 + (i % 12)}`,
      preferred_time: times[0],
      preferred_times: times,
      preferred_language: "English",
      preferred_teaching_style: author.teaching_style,
      message,
      created_at: created,
    });
    plan.requests.push({
      author_id: student,
      district_id: author.district_id,
      title,
      description: message,
      role: "mentee",
      status,
      matched_user_id: status === "open" ? null : mentor,
      created_at: created,
      updated_at: status === "open" ? created : matchedAt,
      request: `${SYNTHETIC_BATCH}:question:${pad(i + 1)}`,
      preferred_times: times,
    });
    plan.request_tags.push({ request_id: i, tag_id: subject.id });
    plan.request_applications.push({
      request_id: i,
      applicant_id: mentor,
      status: status === "open" ? "pending" : "accepted",
      created_at: created,
      updated_at: status === "open" ? created : matchedAt,
    });
    if (i % 2 === 0)
      plan.request_comments.push({
        request_id: i,
        author_id: mentor,
        parent_id: null,
        body: `${marker} Fictional peer discussion for question ${pad(i + 1)}. We can work through one example together.`,
        client_comment_id: `98300782-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
        created_at: created,
        updated_at: null,
        deleted_at: null,
      });
    if (status !== "open")
      plan.request_events.push({
        kind: "matched",
        occurred_at: matchedAt,
        request_id: i,
        mentor_id: mentor,
        request_created_at: created,
      });
  }
  return plan;
}

function materialize(table, rows, ids) {
  const userFields = new Set([
    "student_id",
    "author_id",
    "user_id",
    "applicant_id",
    "matched_user_id",
    "mentor_id",
  ]);
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        value === null
          ? null
          : userFields.has(key)
            ? ids.users[value]
            : key === "request_id"
              ? ids.requests[value]
              : value,
      ]),
    ),
  );
}

async function insertRows(client, table, rows) {
  if (!rows.length) return [];
  const columns = Object.keys(rows[0]);
  const values = [];
  const tuples = rows.map(
    (row) =>
      "(" +
      columns
        .map((column) => {
          values.push(row[column]);
          return "$" + values.length;
        })
        .join(",") +
      ")",
  );
  return (
    await client.query(
      `INSERT INTO ${table} (${columns.join(",")}) VALUES ${tuples.join(",")} RETURNING id`,
      values,
    )
  ).rows.map((row) => row.id);
}

function compareRows(table, expected, actual) {
  const columns = Object.keys(expected[0] ?? {});
  const normalize = (rows) =>
    rows
      .map((row) =>
        serialize(Object.fromEntries(columns.map((key) => [key, row[key]]))),
      )
      .sort();
  if (serialize(normalize(expected)) !== serialize(normalize(actual)))
    throw new Error(
      `synthetic batch conflict: ${table} differs from the exact plan`,
    );
}

async function readBatch(client) {
  const users = (
    await client.query(
      "SELECT * FROM users WHERE email LIKE $1 OR password_hash=$2 OR bio LIKE $3 ORDER BY email",
      [`%@${SYNTHETIC_BATCH}.invalid`, SYNTHETIC_PASSWORD_LOCK, `${marker}%`],
    )
  ).rows;
  const userIds = users.map((row) => row.id);
  const requests = (
    await client.query(
      "SELECT * FROM requests WHERE author_id=ANY($1::int[]) OR request LIKE $2 ORDER BY request",
      [userIds, `${SYNTHETIC_BATCH}:%`],
    )
  ).rows;
  const requestIds = requests.map((row) => row.id);
  const batch = { users, requests };
  for (const [table, predicate, params] of [
    [
      "questions",
      "student_id=ANY($1::int[]) OR message LIKE $2",
      [userIds, `${marker}%`],
    ],
    ["schedules", "user_id=ANY($1::int[])", [userIds]],
    ["request_tags", "request_id=ANY($1::int[])", [requestIds]],
    [
      "request_applications",
      "request_id=ANY($1::int[]) OR applicant_id=ANY($2::int[])",
      [requestIds, userIds],
    ],
    [
      "request_comments",
      "request_id=ANY($1::int[]) OR author_id=ANY($2::int[]) OR body LIKE $3",
      [requestIds, userIds, `${marker}%`],
    ],
    [
      "request_events",
      "request_id=ANY($1::int[]) OR mentor_id=ANY($2::int[])",
      [requestIds, userIds],
    ],
  ])
    batch[table] = (
      await client.query(
        `SELECT * FROM ${table} WHERE ${predicate} ORDER BY id`,
        params,
      )
    ).rows;
  return batch;
}

async function validateBatch(client, plan, batch) {
  const ids = {
    users: batch.users.map((row) => row.id),
    requests: batch.requests.map((row) => row.id),
  };
  for (const table of tables) {
    compareRows(
      table,
      table === "users" ? plan.users : materialize(table, plan[table], ids),
      batch[table],
    );
    if (!ids[table]) ids[table] = batch[table].map((row) => row.id);
  }
  const unsafe = await client.query(
    `SELECT EXISTS(
    SELECT 1 FROM email_verification_tokens WHERE user_id=ANY($1::int[])
    UNION ALL SELECT 1 FROM email_verification_requests WHERE user_id=ANY($1::int[])
  ) AS found`,
    [ids.users],
  );
  if (unsafe.rows[0].found)
    throw new Error("synthetic batch conflict: verification activity exists");
  return ids;
}

/** Only --apply inserts, in one locked transaction. Never updates or deletes data. */
export async function seedSyntheticClassroom({ client, asOf, apply = false }) {
  const { ledger } = await verifySchemaAssets({ rootDir });
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL search_path TO public, pg_catalog");
    await client.query("SET LOCAL lock_timeout TO '10s'");
    await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [
      ledger.advisoryLockKey,
    ]);
    const applied = await client.query(
      'SELECT ordinal,migration_id AS "migrationId",checksum,applied_at AS "appliedAt",app_sha AS "appSha" FROM mentor_connect_schema_migrations ORDER BY ordinal',
    );
    if (validateAppliedMigrations(ledger.migrations, applied.rows).length)
      throw new Error(
        `synthetic seed requires migration ${ledger.migrations.at(-1).id}`,
      );
    // Both event references use ON DELETE SET NULL. After partial cleanup there
    // is no safe way to distinguish prior synthetic history from other history.
    const orphaned = await client.query(
      "SELECT EXISTS(SELECT 1 FROM request_events WHERE kind='matched' AND request_id IS NULL AND mentor_id IS NULL) AS found",
    );
    if (orphaned.rows[0].found)
      throw new Error(
        "synthetic seed rejected: unidentifiable match history requires review",
      );
    // PostgreSQL timestamps have microseconds; generated dates have milliseconds.
    // Round the lower bound upward so no generated event predates real coverage.
    const tracking = (
      await client.query(
        "SELECT to_timestamp(ceil(extract(epoch FROM occurred_at)*1000)/1000) AS occurred_at FROM request_events WHERE kind='tracking_started'",
      )
    ).rows[0]?.occurred_at;
    const now = (await client.query("SELECT transaction_timestamp() AS now"))
      .rows[0].now;
    if (Date.parse(asOf) > now.getTime())
      throw new Error("synthetic anchor must not be in the future");
    const districts = (
      await client.query("SELECT id FROM districts ORDER BY id")
    ).rows;
    const tags = (await client.query("SELECT id,name FROM tags ORDER BY id"))
      .rows;
    const plan = buildSyntheticPlan({
      asOf,
      trackingStartedAt: tracking,
      districts,
      tags,
    });
    const counts = Object.fromEntries(
      tables.map((table) => [table, plan[table].length]),
    );
    const planDigest = createHash("sha256")
      .update(serialize(plan))
      .digest("hex");
    const receipt = { batchId: SYNTHETIC_BATCH, asOf, planDigest, counts };
    const existing = await readBatch(client);
    if (tables.some((table) => existing[table].length)) {
      const ids = await validateBatch(client, plan, existing);
      await client.query("COMMIT");
      return { ...receipt, operation: "already-present", ids };
    }
    if (!apply) {
      await client.query("COMMIT");
      return { ...receipt, operation: "planned", ids: {} };
    }
    const ids = {};
    for (const table of tables)
      ids[table] = await insertRows(
        client,
        table,
        table === "users" ? plan.users : materialize(table, plan[table], ids),
      );
    const verifiedIds = await validateBatch(
      client,
      plan,
      await readBatch(client),
    );
    await client.query("COMMIT");
    return { ...receipt, operation: "inserted", ids: verifiedIds };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (
    args.some((arg) => !["--apply", "--preview"].includes(arg)) ||
    args.length > 1
  )
    throw new Error(
      "usage: node ops/seed-synthetic-classroom.mjs [--preview|--apply]",
    );
  const apply = args[0] === "--apply";
  if (apply && process.env.SYNTHETIC_CONFIRM_BATCH !== SYNTHETIC_BATCH)
    throw new Error(`SYNTHETIC_CONFIRM_BATCH must equal ${SYNTHETIC_BATCH}`);
  const connection = syntheticSeedConnection({
    databaseUrl: process.env.CLASSROOM_DATABASE_URL,
    allowedHost: process.env.CLASSROOM_ALLOWED_HOST,
    databaseName: process.env.CLASSROOM_DATABASE_NAME,
  });
  const client = connection.createClient();
  try {
    await client.connect();
    console.log(
      JSON.stringify(
        await seedSyntheticClassroom({
          client,
          asOf: process.env.SYNTHETIC_AS_OF,
          apply,
        }),
      ),
    );
  } finally {
    await client.end();
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch(() => {
    // Database errors can contain row contents or connection details. Keep CLI output safe.
    console.error(
      "synthetic seed did not confirm completion. Check target, current schema ledger, UTC anchor, and batch conflicts; inspect or rerun the same batch before retrying a different plan.",
    );
    process.exitCode = 1;
  });
