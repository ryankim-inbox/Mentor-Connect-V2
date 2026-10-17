// Explicit operator-only 0003 -> 0005 upgrade. Never invoked at service startup.
import { open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classroomConnection } from './classroom-snapshot.mjs';
import { verifySchemaAssets } from '../lib/db/tools/schema-assets.mjs';
import { validateAppliedMigrations } from '../lib/db/tools/migration-ledger.mjs';
import { runMigrationTransaction } from '../lib/db/tools/migration-runner.mjs';

const rootDir = path.resolve(import.meta.dirname, '..');
const expected = ['0004_chat_operation_keys', '0005_request_interactions'];
const identifier = value => '"' + value.replaceAll('"', '""') + '"';
function check(condition) { if (!condition) throw new Error('operator precondition'); }

export function upgradeConnection(databaseUrl, target) {
  check(target && /^[a-z][a-z0-9_]*$/.test(target.appRole ?? ''));
  check(target.local === undefined || typeof target.local === 'boolean');
  const isLocal = target.local === true;
  if (isLocal) {
    check(['127.0.0.1', 'localhost', '[::1]'].includes(target.host));
    check(/^journey_upgrade_[a-z0-9_]+$/.test(target.database));
  } else {
    check(target.projectId === 'purple-pond-78194407');
    check(target.host === 'ep-crimson-night-b552ar17.c-7.us-east-2.aws.neon.tech');
    check(target.database === 'neondb' && target.appRole === 'mentor_connect_app' && target.port === 5432);
  }
  const connection = classroomConnection({ databaseUrl, allowedHost: target.host, databaseName: target.database });
  check(Number(connection.env.PGPORT) === target.port);
  if (!isLocal) check(connection.env.PGSSLMODE === 'verify-full');
  return connection;
}

async function baseline(client, ledger, target) {
  const rows = (await client.query('SELECT ordinal, migration_id AS "migrationId", checksum, app_sha AS "appSha" FROM public.mentor_connect_schema_migrations ORDER BY ordinal')).rows;
  const pending = validateAppliedMigrations(ledger.migrations, rows);
  check(rows.length === 3 && rows[2].migrationId === '0003_request_events');
  check(JSON.stringify(pending.map(m => m.id)) === JSON.stringify(expected));
  check((await client.query('SELECT current_database() AS name')).rows[0].name === target.database);
  const roles = (await client.query('SELECT rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls FROM pg_roles WHERE rolname=$1', [target.appRole])).rows;
  check(roles.length === 1 && Object.values(roles[0]).every(value => value === false));
  return pending;
}

async function fingerprint(client, tables, columns) {
  const result = {};
  for (const table of tables) {
    const projection = columns[table].map(identifier).join(',');
    result[table] = (await client.query(`SELECT count(*)::text AS count, md5(coalesce(string_agg(row_to_json(t)::text, E'\\n' ORDER BY row_to_json(t)::text),'')) AS digest FROM (SELECT ${projection} FROM public.${identifier(table)}) t`)).rows[0];
  }
  return result;
}

export async function upgradeJourney({ client, assets, target, appSha, audit, mode }) {
  await client.query("SET statement_timeout='60s'; SET lock_timeout='5s'; SET idle_in_transaction_session_timeout='30s'");
  const { ledger } = assets;
  if (mode === 'dry-run') {
    await client.query('BEGIN READ ONLY');
    try {
      await baseline(client, ledger, target);
      await client.query('COMMIT');
      await audit({ result: 'dry-run-validated', migrations: expected });
      return { mode, migrations: expected };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
  }
  check(mode === 'apply');
  const tables = assets.catalog.tables.filter(t => !['request_applications', 'request_comments'].includes(t)).sort();
  const columns = {}; let before;
  const result = await runMigrationTransaction({
    client, ledger, appSha,
    async beforeApply(locked) {
      await baseline(locked, ledger, target);
      await locked.query(`LOCK TABLE ${tables.map(t => 'public.' + identifier(t)).join(',')} IN SHARE MODE`);
      for (const table of tables) {
        columns[table] = (await locked.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position", [table])).rows.map(r => r.column_name);
        check(columns[table].length > 0);
      }
      before = await fingerprint(locked, tables, columns);
      await audit({ result: 'baseline-locked', tables: before });
    },
    async afterApply(locked) {
      const role = identifier(target.appRole);
      await locked.query(`GRANT SELECT, INSERT, UPDATE ON public.request_applications TO ${role}; GRANT SELECT, INSERT ON public.request_comments TO ${role}; GRANT USAGE ON SEQUENCE public.request_applications_id_seq, public.request_comments_id_seq TO ${role}`);
      check(JSON.stringify(before) === JSON.stringify(await fingerprint(locked, tables, columns)));
      await audit({ result: 'verified-before-commit', migrations: expected, preservedTables: tables.length });
    },
  });
  await audit({ result: 'committed', migrations: result.applied });
  return { mode, ...result, preservedTables: tables.length };
}

async function main() {
  const [flag, ...extra] = process.argv.slice(2);
  check(['--apply', '--dry-run'].includes(flag) && extra.length === 0);
  const target = JSON.parse(process.env.JOURNEY_TARGET ?? 'null');
  const connection = upgradeConnection(process.env.JOURNEY_DATABASE_URL, target);
  const appSha = process.env.JOURNEY_APP_SHA;
  check(/^[a-f0-9]{40}$/.test(appSha ?? ''));
  check(/^[a-f0-9]{64}$/.test(process.env.JOURNEY_BACKUP_SHA ?? ''));
  check(/^[a-zA-Z0-9_-]{1,100}$/.test(process.env.JOURNEY_APPROVAL_ID ?? ''));
  check(path.isAbsolute(process.env.JOURNEY_AUDIT_PATH ?? ''));
  const assets = await verifySchemaAssets({ rootDir });
  const handle = await open(process.env.JOURNEY_AUDIT_PATH, 'wx', 0o600);
  const audit = async data => {
    await handle.writeFile(JSON.stringify({ at: new Date().toISOString(), appSha, target, approvalId: process.env.JOURNEY_APPROVAL_ID, backupSha: process.env.JOURNEY_BACKUP_SHA, ...data }) + '\n');
    await handle.sync();
  };
  const client = connection.createClient({ connectionTimeoutMillis: 10000, query_timeout: 65000 });
  // End the connection on an overall deadline; PostgreSQL rolls back an open
  // transaction. A lost COMMIT acknowledgement remains explicitly unconfirmed.
  const deadline = setTimeout(() => { void client.end().catch(() => {}); }, 120000);
  try {
    await audit({ result: 'started', mode: flag.slice(2) });
    await client.connect();
    console.log(JSON.stringify(await upgradeJourney({ client, assets, target, appSha, audit, mode: flag.slice(2) })));
  } catch (error) {
    await audit({ result: 'failed-or-unconfirmed', sqlstate: /^[A-Z0-9]{5}$/.test(error.code ?? '') ? error.code : undefined }).catch(() => {});
    throw error;
  } finally { clearTimeout(deadline); await client.end().catch(() => {}); await handle.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('journey upgrade rejected; inspect protected audit and database state before retrying'); process.exitCode = 1; });
}
