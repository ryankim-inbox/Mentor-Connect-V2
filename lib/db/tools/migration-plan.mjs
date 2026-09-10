import { createHash } from "node:crypto";

import pg from "pg";

import { validateAppliedMigrations } from "./migration-ledger.mjs";

const { Client } = pg;

function planningError(message, failureCode, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.failureCode = failureCode;
  return error;
}

function hashPlan(migrations) {
  const payload = migrations
    .map(
      (migration) => `${migration.ordinal}:${migration.id}:${migration.sha256}`,
    )
    .join("\n");
  return createHash("sha256").update(payload).digest("hex");
}

async function readAppliedMigrations(client) {
  await client.query(
    "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
  );
  try {
    await client.query("SET LOCAL search_path TO public, pg_catalog");
    await client.query("SET LOCAL statement_timeout = '15s'");
    await client.query("SET LOCAL lock_timeout = '2s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '15s'");
    const mode = await client.query("SHOW transaction_read_only");
    if (mode.rows[0]?.transaction_read_only !== "on") {
      throw planningError(
        "migration planning requires a read-only transaction",
        "read_only_validation_failed",
      );
    }
    const relation = await client.query(
      "SELECT to_regclass('public.mentor_connect_schema_migrations') AS name",
    );
    let rows = [];
    if (relation.rows[0]?.name) {
      const applied = await client.query(`
        SELECT ordinal, migration_id AS "migrationId", checksum,
               applied_at AS "appliedAt", app_sha AS "appSha"
        FROM public.mentor_connect_schema_migrations
        ORDER BY ordinal
      `);
      rows = applied.rows;
    }
    await client.query("COMMIT");
    return rows;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

export async function planMigrationDryRun({
  databaseUrl,
  ledger,
  migrationId,
  createClient = (connectionString) =>
    new Client({ connectionString, connectionTimeoutMillis: 2_000 }),
}) {
  const target = ledger.migrations.find(
    (migration) => migration.id === migrationId,
  );
  if (!target) {
    throw planningError(
      "migration is not present in the immutable ledger",
      "migration_not_in_ledger",
    );
  }

  const client = createClient(databaseUrl);
  try {
    await client.connect();
  } catch (error) {
    throw planningError(
      "read-only migration planning could not connect to the approved target",
      "database_connection_failed",
      error,
    );
  }

  try {
    let appliedRows;
    try {
      appliedRows = await readAppliedMigrations(client);
    } catch (error) {
      if (error.failureCode) throw error;
      throw planningError(
        "read-only migration planning could not validate target history",
        "target_history_validation_failed",
        error,
      );
    }

    let pending;
    try {
      pending = validateAppliedMigrations(ledger.migrations, appliedRows);
    } catch (error) {
      throw planningError(
        "target migration history does not match the immutable ledger",
        "target_history_mismatch",
        error,
      );
    }

    const targetIndex = pending.findIndex(
      (migration) => migration.id === migrationId,
    );
    if (targetIndex === -1) {
      throw planningError(
        "requested migration is already applied or not pending in ledger order",
        "migration_not_pending",
      );
    }
    const plannedMigrations = pending.slice(0, targetIndex + 1);

    return {
      appliedTail: appliedRows.at(-1)?.migrationId ?? "none",
      repositoryTail: ledger.migrations.at(-1).id,
      targetMigrationId: target.id,
      targetChecksum: target.sha256,
      plannedMigrationCount: plannedMigrations.length,
      planSha256: hashPlan(plannedMigrations),
      readOnly: true,
    };
  } finally {
    await client.end().catch(() => {});
  }
}
