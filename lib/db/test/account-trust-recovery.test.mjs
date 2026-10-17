import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '../../../ops/classroom-snapshot.mjs';
import { backupClassroom } from '../../../ops/backup-classroom.mjs';
import { restoreClassroom } from '../../../ops/restore-classroom.mjs';
import { upgradeAccountTrust } from '../../../ops/upgrade-account-trust.mjs';
import { verifySchemaAssets } from '../tools/schema-assets.mjs';
import { snapshotSchemaAssets } from '../../../ops/snapshot-schema.mjs';
const rootDir=path.resolve(import.meta.dirname,'../../..');

function legacyGrants(role) {
  return `GRANT USAGE ON SCHEMA public TO ${role};
    GRANT SELECT ON districts,tags,questions,chat_rooms TO ${role};
    GRANT SELECT,INSERT,UPDATE ON users,dm_messages,request_applications TO ${role};
    GRANT SELECT,INSERT,UPDATE,DELETE ON requests TO ${role};
    GRANT SELECT,INSERT,DELETE ON request_tags,blocks TO ${role};
    GRANT SELECT,INSERT ON chat_messages,dm_conversations,request_events,request_comments,reports TO ${role};
    GRANT USAGE ON users_id_seq,blocks_id_seq,chat_messages_id_seq,dm_conversations_id_seq,dm_messages_id_seq,
      reports_id_seq,request_applications_id_seq,request_comments_id_seq,request_events_id_seq,request_tags_id_seq,requests_id_seq TO ${role}`;
}
async function content(client,tables) {
  const rows={};
  for(const table of tables)rows[table]=(await client.query(`SELECT row_to_json(t) AS item FROM public."${table}" t ORDER BY row_to_json(t)::text`)).rows;
  return rows;
}
const sequences=client=>client.query("SELECT sequencename,last_value FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename").then(result=>result.rows);

test('0005 snapshot survives 0006 upgrade and restores old data, catalog and runtime rights in an isolated target',async()=>{
  const scratch=await mkdtemp(path.join(tmpdir(),'trust-recovery-'));
  const admin=new Client({connectionString:process.env.TEST_DATABASE_URL});await admin.connect();
  const sourceName='account_trust_upgrade_recovery',targetName='account_trust_restore_recovery',role='trust_recovery_app';
  const clients=[];
  try {
    await admin.query(`CREATE DATABASE ${sourceName}`);await admin.query(`CREATE DATABASE ${targetName}`);
    await admin.query(`CREATE ROLE ${role} NOLOGIN`);
    const sourceUrl=new URL(process.env.TEST_DATABASE_URL);sourceUrl.pathname='/'+sourceName;
    const targetUrl=new URL(sourceUrl);targetUrl.pathname='/'+targetName;
    const source=new Client({connectionString:sourceUrl.href}),target=new Client({connectionString:targetUrl.href});
    clients.push(source,target);await source.connect();await target.connect();
    const assets=await verifySchemaAssets({rootDir});
    const {runMigrationTransaction}=await import('../tools/migration-runner.mjs');
    await runMigrationTransaction({client:source,ledger:{...assets.ledger,migrations:assets.ledger.migrations.slice(0,5)},appSha:'a'.repeat(40)});
    await source.query(await readFile(path.join(rootDir,'tests/fixtures/chat-canonical.sql'),'utf8'));
    await source.query(legacyGrants(role));
    const historical=await snapshotSchemaAssets({rootDir,schemaVersion:'0005'});
    const beforeAll=await content(source,historical.catalog.tables),beforeSequences=await sequences(source);
    const beforeUsers=(await source.query('SELECT * FROM users ORDER BY id')).rows;
    const beforeMessages=(await source.query('SELECT * FROM chat_messages ORDER BY id')).rows;
    const beforeLedger=(await source.query('SELECT * FROM mentor_connect_schema_migrations ORDER BY ordinal')).rows;
    const dump=await backupClassroom({databaseUrl:sourceUrl.href,allowedHost:'127.0.0.1',databaseName:sourceName,outputDir:scratch,schemaVersion:'0005'});
    assert.equal(dump.schemaVersion,'0005');
    assert.equal((await stat(dump.dumpPath)).mode&0o777,0o600);
    await assert.rejects(restoreClassroom({databaseUrl:targetUrl.href,allowedHost:'127.0.0.1',databaseName:targetName,dumpPath:dump.dumpPath}),/schema version mismatch/);
    await upgradeAccountTrust({client:source,assets,target:{database:sourceName,appRole:role},appSha:'b'.repeat(40),acknowledged:true,audit:async()=>{}});
    assert.equal((await source.query('SELECT count(*)::int AS n FROM users WHERE is_verified OR is_admin')).rows[0].n,0);
    const restored=await restoreClassroom({databaseUrl:targetUrl.href,allowedHost:'127.0.0.1',databaseName:targetName,dumpPath:dump.dumpPath,schemaVersion:'0005'});
    assert.equal(restored.verified,true);assert.equal(restored.schemaVersion,'0005');
    assert.deepEqual((await target.query('SELECT * FROM users ORDER BY id')).rows,beforeUsers);
    assert.deepEqual((await target.query('SELECT * FROM chat_messages ORDER BY id')).rows,beforeMessages);
    assert.deepEqual((await target.query('SELECT * FROM mentor_connect_schema_migrations ORDER BY ordinal')).rows,beforeLedger);
    assert.deepEqual(await content(target,historical.catalog.tables),beforeAll);
    assert.deepEqual(await sequences(target),beforeSequences);
    assert.equal((await target.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name='users' AND column_name='is_admin'")).rows[0].n,0);
    // --no-acl is deliberate: recovery must explicitly reinstate the old runtime policy.
    assert.equal((await target.query("SELECT has_table_privilege($1,'users','UPDATE') AS allowed",[role])).rows[0].allowed,false);
    await target.query(legacyGrants(role));await target.query(`SET ROLE ${role}`);
    assert.equal((await target.query('SELECT * FROM chat_messages')).rows.length,beforeMessages.length);
    const registered=(await target.query("INSERT INTO users(email,name,password_hash,role,district_id,is_verified,subjects) VALUES ('recovered@test.edu','Recovered','synthetic-hash','mentor',1,true,'{}') RETURNING *")).rows[0];
    assert.equal(registered.is_verified,true);
    await target.query('RESET ROLE');
    // A 0006 source cannot be mislabeled 0005, and the same source/target restore guard remains.
    await assert.rejects(backupClassroom({databaseUrl:sourceUrl.href,allowedHost:'127.0.0.1',databaseName:sourceName,outputDir:scratch,schemaVersion:'0005'}),/catalog/);
    await assert.rejects(restoreClassroom({databaseUrl:sourceUrl.href,allowedHost:'127.0.0.1',databaseName:sourceName,dumpPath:dump.dumpPath,schemaVersion:'0005'}),/different source/);
  }finally{
    await Promise.all(clients.map(client=>client.end()));
    for(const name of [sourceName,targetName])await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`DROP ROLE IF EXISTS ${role}`);await admin.end();await rm(scratch,{recursive:true,force:true});
  }
});

test('snapshot version selection is explicit and does not change current schema assets',async()=>{
  await assert.rejects(snapshotSchemaAssets({rootDir,schemaVersion:'0004'}),/unsupported/);
  await assert.rejects(snapshotSchemaAssets({rootDir,schemaVersion:'../0005'}),/unsupported/);
  assert.equal((await snapshotSchemaAssets({rootDir})).version.schemaVersion,'0006');
  const historical=await snapshotSchemaAssets({rootDir,schemaVersion:'0005'});
  assert.equal(historical.ledger.migrations.length,5);
  assert.equal(historical.catalog.tables.includes('email_verification_tokens'),false);
});
