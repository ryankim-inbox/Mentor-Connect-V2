// Operator-only local rehearsal. Never called at application startup or request time.
import { open } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { classroomConnection } from "./classroom-snapshot.mjs";
import { assertAccountTrustRoleSafe } from "./account-trust-grants.mjs";
import { verifySchemaAssets } from "../lib/db/tools/schema-assets.mjs";
import { validateAppliedMigrations } from "../lib/db/tools/migration-ledger.mjs";
import { runMigrationTransaction } from "../lib/db/tools/migration-runner.mjs";

const rootDir = path.resolve(import.meta.dirname, "..");
const check = (condition) => {
  if (!condition) throw new Error("notifications upgrade precondition");
};
const identifier = (value) => '"' + value.replaceAll('"', '""') + '"';

function validateTarget(target) {
  check(target && ["127.0.0.1", "localhost", "[::1]"].includes(target.host));
  check(
    Number.isInteger(target.port) && target.port > 0 && target.port <= 65535,
  );
  check(/^notifications_upgrade_[a-z0-9_]+$/.test(target.database ?? ""));
  check(/^[a-z][a-z0-9_]*$/.test(target.appRole ?? ""));
}

export function notificationsConnection(databaseUrl, target) {
  validateTarget(target);
  const connection = classroomConnection({
    databaseUrl,
    allowedHost: target.host,
    databaseName: target.database,
  });
  check(Number(connection.env.PGPORT) === target.port);
  return connection;
}

async function verifyRuntimeAuthority(client, role) {
  await assertAccountTrustRoleSafe(client, role);
  const authority = (
    await client.query(
      `SELECT
    has_column_privilege($1,'public.users','is_admin','INSERT') AS admin_insert,
    has_column_privilege($1,'public.users','is_admin','UPDATE') AS admin_update`,
      [role],
    )
  ).rows[0];
  check(authority.admin_insert === false && authority.admin_update === false);
}

async function verifyNotificationGrants(client, role) {
  await verifyRuntimeAuthority(client, role);
  const privileges = (
    await client.query(
      `SELECT p,
    has_table_privilege($1,'public.notifications',p) AS allowed,
    has_table_privilege($1,'public.notifications',p||' WITH GRANT OPTION') AS grant_option
    FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS p`,
      [role],
    )
  ).rows;
  for (const right of privileges)
    check(
      right.allowed === ["SELECT", "INSERT"].includes(right.p) &&
        right.grant_option === false,
    );
  const columns = (
    await client.query(
      `SELECT attname,
    has_column_privilege($1,attrelid,attnum,'UPDATE') AS allowed,
    has_column_privilege($1,attrelid,attnum,'UPDATE WITH GRANT OPTION') AS grant_option
    FROM pg_attribute WHERE attrelid='public.notifications'::regclass AND attnum>0 AND NOT attisdropped`,
      [role],
    )
  ).rows;
  check(columns.length === 7);
  for (const column of columns)
    check(
      column.allowed === (column.attname === "read_at") &&
        column.grant_option === false,
    );
  const sequence = (
    await client.query(
      `SELECT p,
    has_sequence_privilege($1,'public.notifications_id_seq',p) AS allowed,
    has_sequence_privilege($1,'public.notifications_id_seq',p||' WITH GRANT OPTION') AS grant_option
    FROM unnest(ARRAY['USAGE','SELECT','UPDATE']) AS p`,
      [role],
    )
  ).rows;
  for (const right of sequence)
    check(
      right.allowed === (right.p === "USAGE") && right.grant_option === false,
    );
  const unsafePublic = (
    await client.query(`SELECT EXISTS(
    SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
      WHERE c.oid IN ('public.notifications'::regclass,'public.notifications_id_seq'::regclass) AND a.grantee=0
    UNION ALL SELECT 1 FROM pg_attribute c CROSS JOIN LATERAL aclexplode(c.attacl) a
      WHERE c.attrelid='public.notifications'::regclass AND a.grantee=0
    ) AS found`)
  ).rows[0].found;
  check(unsafePublic === false);
}

export async function upgradeNotifications({
  client,
  assets,
  target,
  appSha,
  audit,
  acknowledged,
}) {
  check(acknowledged === true && typeof audit === "function");
  validateTarget(target);
  const ledger = {
    ...assets.ledger,
    migrations: assets.ledger.migrations.filter((m) => m.sequence <= 7),
  };
  check(ledger.migrations.at(-1)?.id === "0007_notifications");
  await client.query(
    "SET statement_timeout='60s'; SET lock_timeout='5s'; SET idle_in_transaction_session_timeout='30s'",
  );
  return runMigrationTransaction({
    client,
    ledger,
    appSha,
    async beforeApply(locked) {
      const identity = (
        await locked.query(
          "SELECT current_database() AS name,host(inet_server_addr()) AS address,inet_server_port() AS port,current_user AS operator",
        )
      ).rows[0];
      check(
        identity.name === target.database &&
          ["127.0.0.1", "::1"].includes(identity.address) &&
          identity.port === target.port &&
          identity.operator !== target.appRole,
      );
      const applied = (
        await locked.query(
          'SELECT ordinal,migration_id AS "migrationId",checksum FROM mentor_connect_schema_migrations ORDER BY ordinal',
        )
      ).rows;
      check(
        applied.length === 6 &&
          applied.at(-1).migrationId === "0006_account_trust",
      );
      check(
        JSON.stringify(
          validateAppliedMigrations(ledger.migrations, applied).map(
            (m) => m.id,
          ),
        ) === JSON.stringify(["0007_notifications"]),
      );
      const existing = (
        await locked.query(
          "SELECT to_regclass('public.notifications') AS table_name,to_regclass('public.notifications_id_seq') AS sequence_name,to_regclass('public.idx_notifications_user_created') AS index_name",
        )
      ).rows[0];
      check(Object.values(existing).every((value) => value === null));
      await verifyRuntimeAuthority(locked, target.appRole);
      await audit({
        result: "verified-before-apply",
        migration: "0007_notifications",
      });
    },
    async afterApply(locked) {
      const role = identifier(target.appRole);
      await locked.query(`GRANT SELECT,INSERT ON public.notifications TO ${role};
        GRANT UPDATE(read_at) ON public.notifications TO ${role};
        GRANT USAGE ON SEQUENCE public.notifications_id_seq TO ${role}`);
      await verifyNotificationGrants(locked, target.appRole);
      check(
        (
          await locked.query(
            "SELECT count(*)::int AS n FROM public.notifications",
          )
        ).rows[0].n === 0,
      );
      await audit({
        result: "verified-before-commit",
        migration: "0007_notifications",
      });
    },
  });
}

async function main() {
  check(process.argv.slice(2).length === 1 && process.argv[2] === "--apply");
  const target = JSON.parse(process.env.NOTIFICATIONS_TARGET ?? "null");
  const connection = notificationsConnection(
    process.env.NOTIFICATIONS_DATABASE_URL,
    target,
  );
  const appSha = process.env.NOTIFICATIONS_APP_SHA;
  check(/^[a-f0-9]{40}$/.test(appSha ?? ""));
  check(/^[a-f0-9]{64}$/.test(process.env.NOTIFICATIONS_BACKUP_SHA ?? ""));
  check(
    /^[A-Za-z0-9_-]{1,100}$/.test(process.env.NOTIFICATIONS_APPROVAL_ID ?? ""),
  );
  check(path.isAbsolute(process.env.NOTIFICATIONS_AUDIT_PATH ?? ""));
  const assets = await verifySchemaAssets({ rootDir });
  const handle = await open(process.env.NOTIFICATIONS_AUDIT_PATH, "wx", 0o600);
  const audit = async (record) => {
    await handle.writeFile(
      JSON.stringify({
        at: new Date().toISOString(),
        appSha,
        backupSha: process.env.NOTIFICATIONS_BACKUP_SHA,
        approvalId: process.env.NOTIFICATIONS_APPROVAL_ID,
        ...record,
      }) + "\n",
    );
    await handle.sync();
  };
  const client = connection.createClient({
    connectionTimeoutMillis: 10000,
    query_timeout: 65000,
  });
  const deadline = setTimeout(() => {
    void client.end().catch(() => {});
  }, 120000);
  try {
    await client.connect();
    const result = await upgradeNotifications({
      client,
      assets,
      target,
      appSha,
      audit,
      acknowledged: true,
    });
    await audit({ result: "committed", migrations: result.applied });
    console.log(JSON.stringify(result));
  } catch (error) {
    await audit({ result: "failed-or-unconfirmed" }).catch(() => {});
    throw error;
  } finally {
    clearTimeout(deadline);
    await client.end().catch(() => {});
    await handle.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => {
    console.error("notifications upgrade rejected or unconfirmed");
    process.exitCode = 1;
  });
