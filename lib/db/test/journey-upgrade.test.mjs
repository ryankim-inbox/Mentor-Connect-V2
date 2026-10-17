import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Client } from '../../../ops/classroom-snapshot.mjs';
import { verifySchemaAssets } from '../tools/schema-assets.mjs';
import { runMigrationTransaction } from '../tools/migration-runner.mjs';
import { upgradeConnection } from '../../../ops/upgrade-journey.mjs';

const rootDir = path.resolve(import.meta.dirname, '../../..');
const { ledger } = await verifySchemaAssets({ rootDir });
const scratch = await mkdtemp(path.join(tmpdir(), 'journey-upgrade-test-'));
let sequence = 0;

test('a nonboolean local flag cannot bypass remote certificate verification', () => {
  const target = { host: 'ep-crimson-night-b552ar17.c-7.us-east-2.aws.neon.tech', port: 5432, database: 'neondb', appRole: 'mentor_connect_app', projectId: 'purple-pond-78194407' };
  for (const local of ['false', 'true', 0, 1, null, [], {}]) {
    assert.throws(() => upgradeConnection(`postgresql://${target.host}/neondb?sslmode=disable`, { ...target, local }));
  }
  assert.throws(() => upgradeConnection(`postgresql://${target.host}/neondb?sslmode=disable`, target));
  assert.equal(upgradeConnection(`postgresql://${target.host}/neondb?sslmode=verify-full`, target).env.PGSSLMODE, 'verify-full');
});

async function fixture() {
  const name = `journey_upgrade_${++sequence}`;
  const admin = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  const url = new URL(process.env.TEST_DATABASE_URL); url.pathname = '/' + name;
  const client = new Client({ connectionString: url.href }); await client.connect();
  await runMigrationTransaction({ client, ledger: { ...ledger, migrations: ledger.migrations.slice(0, 3) }, appSha: 'a'.repeat(40) });
  await client.query(await readFile(path.join(rootDir, 'tests/fixtures/chat-canonical.sql'), 'utf8'));
  await client.query(`CREATE ROLE journey_app_${sequence} NOLOGIN`);
  const target = { host: url.hostname, port: Number(url.port || 5432), database: name, appRole: `journey_app_${sequence}`, local: true };
  const env = { ...process.env, JOURNEY_DATABASE_URL: url.href, JOURNEY_TARGET: JSON.stringify(target), JOURNEY_APP_SHA: 'b'.repeat(40), JOURNEY_APPROVAL_ID: 'local-rehearsal', JOURNEY_BACKUP_SHA: 'c'.repeat(64), JOURNEY_AUDIT_PATH: path.join(scratch, `audit-${sequence}.jsonl`) };
  return { client, env, async close() { await client.end(); await admin.query(`DROP DATABASE ${name} WITH (FORCE)`); await admin.query(`DROP ROLE ${target.appRole}`); await admin.end(); } };
}
function run(env, mode = '--dry-run') {
  return spawnSync(process.execPath, ['ops/upgrade-journey.mjs', mode], { cwd: rootDir, env, encoding: 'utf8', timeout: 20000 });
}
async function state(client) {
  return (await client.query("SELECT migration_id FROM mentor_connect_schema_migrations ORDER BY ordinal")).rows.map(r => r.migration_id);
}

test('dry run validates the populated baseline without changing ledger or creating tables', async () => {
  const f = await fixture(); try {
    const result = run(f.env);
    assert.equal(result.status, 0, result.stderr);
    assert.equal((await state(f.client)).length, 3);
    assert.equal((await f.client.query("SELECT to_regclass('request_comments') AS table")).rows[0].table, null);
    assert.equal(JSON.parse(result.stdout).mode, 'dry-run');
  } finally { await f.close(); }
});
test('apply preserves legacy rows and grants only the required new privileges', async () => {
  const f = await fixture(); try {
    const before = (await f.client.query('SELECT id,body FROM chat_messages ORDER BY id')).rows;
    const result = run(f.env, '--apply');
    assert.equal(result.status, 0, result.stderr);
    assert.equal((await state(f.client)).length, 5);
    assert.deepEqual((await f.client.query('SELECT id,body FROM chat_messages ORDER BY id')).rows, before);
    const role = JSON.parse(f.env.JOURNEY_TARGET).appRole;
    const grants = (await f.client.query("SELECT has_table_privilege($1,'request_applications','UPDATE') AS update, has_table_privilege($1,'request_comments','DELETE') AS delete, has_table_privilege($1,'request_comments','INSERT') AS insert, has_sequence_privilege($1,'request_comments_id_seq','USAGE') AS sequence", [role])).rows[0];
    assert.deepEqual(grants, { update: true, delete: false, insert: true, sequence: true });
    const audit = (await readFile(f.env.JOURNEY_AUDIT_PATH, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(audit.at(-1).result, 'committed');
    assert.ok(audit.some(row => row.result === 'verified-before-commit'));
  } finally { await f.close(); }
});
test('a different target is rejected before any database mutation', async () => {
  const f = await fixture(); try {
    const result = run({ ...f.env, JOURNEY_TARGET: JSON.stringify({ ...JSON.parse(f.env.JOURNEY_TARGET), database: 'other_database' }) }, '--apply');
    assert.notEqual(result.status, 0);
    assert.equal((await state(f.client)).length, 3);
    assert.match(result.stderr, /journey upgrade rejected/);
  } finally { await f.close(); }
});
test('wrong baseline and an existing audit file reject retries without writes', async () => {
  const f = await fixture(); try {
    assert.equal(run(f.env, '--apply').status, 0);
    assert.notEqual(run(f.env, '--apply').status, 0);
    assert.notEqual(run({ ...f.env, JOURNEY_AUDIT_PATH: f.env.JOURNEY_AUDIT_PATH + '.second' }, '--apply').status, 0);
    assert.equal((await state(f.client)).length, 5);
  } finally { await f.close(); }
});
test('a conflicting table rolls back earlier migration DDL and ledger writes', async () => {
  const f = await fixture(); try {
    await f.client.query('CREATE TABLE request_comments (marker text)');
    assert.notEqual(run(f.env, '--apply').status, 0);
    assert.equal((await state(f.client)).length, 3);
    assert.equal((await f.client.query("SELECT count(*)::int AS count FROM information_schema.columns WHERE table_name='chat_messages' AND column_name='client_message_id'")).rows[0].count, 0);
  } finally { await f.close(); }
});
test('the migration lock has a finite deadline and leaves the old schema intact', async () => {
  const f = await fixture(); try {
    await f.client.query('BEGIN');
    await f.client.query('SELECT pg_advisory_xact_lock($1)', [ledger.advisoryLockKey]);
    const start = Date.now(); const result = run(f.env, '--apply');
    assert.notEqual(result.status, 0);
    assert.ok(Date.now() - start < 15000);
    await f.client.query('ROLLBACK');
    assert.equal((await state(f.client)).length, 3);
  } finally { await f.close(); }
});
