import { createHash } from "node:crypto";

import { validateAppliedMigrations } from "./migration-ledger.mjs";
import { assertMigrationSqlIsAtomic } from "./sql-safety.mjs";

const APP_SHA = /^[a-f0-9]{7,64}$/;
const LEDGER_TABLE = "mentor_connect_schema_migrations";

function validateInputs(ledger, appSha) {
  if (ledger?.ledgerTable !== LEDGER_TABLE) {
    throw new Error(
      `migration runner only supports ledger table ${LEDGER_TABLE}`,
    );
  }
  if (!/^-?\d+$/.test(ledger.advisoryLockKey ?? "")) {
    throw new Error(
      "migration runner requires a decimal bigint advisory lock key",
    );
  }
  if (!Array.isArray(ledger.migrations) || ledger.migrations.length === 0) {
    throw new Error("migration runner requires a non-empty migration ledger");
  }
  let previousSequence = -1;
  for (const [index, migration] of ledger.migrations.entries()) {
    const match = /^(\d{4,})_[a-z0-9_]+$/.exec(migration.id ?? "");
    if (
      !match ||
      migration.ordinal !== index + 1 ||
      migration.sequence !== Number(match[1]) ||
      migration.sequence <= previousSequence
    ) {
      throw new Error(
        `migration runner requires strictly increasing migrations at ordinal ${index + 1}`,
      );
    }
    if (typeof migration.sql !== "string") {
      throw new Error(`migration runner requires SQL for ${migration.id}`);
    }
    const actualChecksum = createHash("sha256")
      .update(migration.sql)
      .digest("hex");
    if (actualChecksum !== migration.sha256) {
      throw new Error(`migration runner checksum mismatch for ${migration.id}`);
    }
    assertMigrationSqlIsAtomic(migration.sql);
    previousSequence = migration.sequence;
  }
  if (!APP_SHA.test(appSha ?? "")) {
    throw new Error(
      "migration runner requires a 7-64 character lowercase hexadecimal app SHA",
    );
  }
}

export async function runMigrationTransaction({
  client,
  ledger,
  appSha,
  beforeApply = async () => {},
}) {
  validateInputs(ledger, appSha);
  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query("SET LOCAL search_path TO public, pg_catalog");
    await client.query("SET LOCAL standard_conforming_strings TO on");
    await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [
      ledger.advisoryLockKey,
    ]);
    await beforeApply(client);
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.mentor_connect_schema_migrations (
        ordinal INTEGER PRIMARY KEY CHECK (ordinal > 0),
        migration_id TEXT NOT NULL UNIQUE,
        checksum TEXT NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        app_sha TEXT NOT NULL CHECK (app_sha ~ '^[a-f0-9]{7,64}$')
      )
    `);
    const appliedResult = await client.query(`
      SELECT
        ordinal,
        migration_id AS "migrationId",
        checksum,
        applied_at AS "appliedAt",
        app_sha AS "appSha"
      FROM public.mentor_connect_schema_migrations
      ORDER BY ordinal
    `);
    const pending = validateAppliedMigrations(
      ledger.migrations,
      appliedResult.rows,
    );

    for (const migration of pending) {
      await client.query(migration.sql);
      await client.query(
        `INSERT INTO public.mentor_connect_schema_migrations
          (ordinal, migration_id, checksum, app_sha)
         VALUES ($1, $2, $3, $4)`,
        [migration.ordinal, migration.id, migration.sha256, appSha],
      );
    }
    await client.query("COMMIT");
    transactionStarted = false;
    return {
      applied: pending.map((migration) => migration.id),
      alreadyApplied: appliedResult.rows.map((row) => row.migrationId),
    };
  } catch (error) {
    if (transactionStarted) await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}
