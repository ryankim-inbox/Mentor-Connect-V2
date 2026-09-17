import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { userInfo } from "node:os";
import { validateClassroomTarget } from "./bootstrap-classroom.mjs";
import { validateAppliedMigrations } from "../lib/db/tools/migration-ledger.mjs";

export const { Client } = createRequire(
  new URL("../lib/db/package.json", import.meta.url),
)("pg");

export function classroomConnection(options, environment = process.env) {
  const target = validateClassroomTarget(options);
  // --dbname also accepts conninfo; permit only a literal database identifier.
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(target.databaseName)) {
    throw new Error("classroom database name must be a simple identifier");
  }
  const url = new URL(target.databaseUrl);
  const env = Object.fromEntries(
    Object.entries(environment).filter(
      ([key]) => !key.startsWith("PG") && !/DATABASE_URL$/.test(key),
    ),
  );
  Object.assign(env, {
    PGHOST: url.hostname.replace(/^\[|\]$/g, ""),
    PGPORT: url.port || "5432",
    PGDATABASE: target.databaseName,
    PGUSER: decodeURIComponent(url.username) || userInfo().username,
    PGPASSWORD: decodeURIComponent(url.password),
  });
  for (const name of ["sslmode", "sslcert", "sslkey", "sslrootcert"]) {
    if (url.searchParams.has(name))
      env[`PG${name.toUpperCase()}`] = url.searchParams.get(name);
  }
  const certificates = ["sslcert", "sslkey", "sslrootcert"].some((name) =>
    url.searchParams.has(name),
  );
  const ssl = url.searchParams.get("ssl");
  if (ssl !== null) {
    if (
      !["true", "1", "false", "0"].includes(ssl) ||
      env.PGSSLMODE ||
      (certificates && ["false", "0"].includes(ssl))
    ) {
      throw new Error("ambiguous classroom TLS options");
    }
    env.PGSSLMODE = ["true", "1"].includes(ssl) ? "verify-full" : "disable";
  }
  env.PGSSLMODE ??= certificates ? "verify-full" : "disable";
  if (!["disable", "verify-full"].includes(env.PGSSLMODE)) {
    throw new Error("classroom TLS mode must be disable or verify-full");
  }
  if (certificates && env.PGSSLMODE === "disable") {
    throw new Error("ambiguous classroom TLS options");
  }
  return {
    target,
    env,
    createClient() {
      const tls =
        env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: true };
      if (tls) {
        for (const [field, variable] of [
          ["ca", "PGSSLROOTCERT"],
          ["cert", "PGSSLCERT"],
          ["key", "PGSSLKEY"],
        ]) {
          if (env[variable]) tls[field] = readFileSync(env[variable]);
        }
      }
      const client = new Client({
        host: env.PGHOST,
        port: Number(env.PGPORT),
        database: env.PGDATABASE,
        user: env.PGUSER,
        password: env.PGPASSWORD,
        ssl: tls,
      });
      // pg uses process.env for absent/empty values; enforce the validated fields.
      client.connectionParameters.password = env.PGPASSWORD;
      client.password = env.PGPASSWORD;
      client.connectionParameters.options = "";
      client.connectionParameters.replication = undefined;
      return client;
    },
  };
}

export function nativeCommand(command, args, env) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { env, maxBuffer: 1024 * 1024 }, (error) => {
      // Native errors can echo passwords, URLs and provider details. Never retain raw output.
      if (error)
        reject(
          new Error(
            `${command} failed (exit ${Number.isInteger(error.code) ? error.code : "unavailable"}); check connection and native tool configuration`,
          ),
        );
      else resolve();
    });
  });
}

export async function fileChecksum(filename) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest("hex");
}

export async function snapshotEvidence(client, assets) {
  const { rows } =
    await client.query(`SELECT ordinal, migration_id AS "migrationId", checksum,
    applied_at AS "appliedAt", app_sha AS "appSha"
    FROM public.mentor_connect_schema_migrations ORDER BY ordinal`);
  if (validateAppliedMigrations(assets.ledger.migrations, rows).length) {
    throw new Error("classroom schema has unapplied migrations");
  }
  const counts = {};
  for (const table of assets.catalog.tables) {
    counts[table] = (
      await client.query(
        `SELECT count(*)::text AS count FROM public."${table}"`,
      )
    ).rows[0].count;
  }
  return {
    schemaVersion: assets.version.schemaVersion,
    ledgerChecksum: createHash("sha256")
      .update(JSON.stringify(rows))
      .digest("hex"),
    counts,
  };
}
