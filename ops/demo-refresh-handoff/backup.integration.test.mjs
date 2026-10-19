import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, chmod, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { localCluster,backupAndRestore,fullRowProof,compareRestoreProof,noOtherClients } from './backup.mjs';
import { observedClient,confirmCommittedReadOnly } from './driver.mjs';
import { verifySchemaAssets } from '../../lib/db/tools/schema-assets.mjs';
import { runMigrationTransaction } from '../../lib/db/tools/migration-runner.mjs';
import { seedSyntheticClassroom } from '../seed-synthetic-classroom.mjs';
import { reviseSyntheticClassroom, readSyntheticRevisionBaseline } from '../revise-synthetic-classroom.mjs';
import { same,digest } from './protocol.mjs';

const integration=process.env.RUN_REFRESH_BACKUP_LOCAL_TEST==='1'?test:test.skip;
const pgBin=process.env.TEST_REFRESH_PG_BIN??'/opt/homebrew/opt/postgresql@18/bin';
const codeRoot=fileURLToPath(new URL('../../',import.meta.url));

integration('fresh schema8 backup restores all rows/passwords/current QA, catalog, ledger, sequences and grants locally',async()=>{
  const cluster=await localCluster({pgBin});
  const directory=await mkdtemp(path.join(os.tmpdir(),'refresh-backup-proof-test-'));await chmod(directory,0o700);
  let client;
  try {
    const admin=cluster.client('postgres');await admin.connect();
    try {
      await admin.query('CREATE ROLE neondb_owner LOGIN');
      await admin.query('CREATE ROLE mentor_connect_app NOLOGIN');
      await admin.query('CREATE ROLE mentor_connect_readiness NOLOGIN');
      await admin.query("CREATE DATABASE neondb TEMPLATE template0 OWNER neondb_owner ENCODING 'UTF8' LOCALE_PROVIDER libc LC_COLLATE 'C' LC_CTYPE 'C'");
    }finally{await admin.end();}
    client=cluster.client('neondb','neondb_owner');await client.connect();
    await client.query("SET timezone TO 'UTC'");
    const assets=await verifySchemaAssets({rootDir:codeRoot});
    await runMigrationTransaction({client,ledger:assets.ledger,appSha:'a'.repeat(40)});
    await client.query(await readFile(new URL('../../database/fixtures/classroom.sql',import.meta.url),'utf8'));
    await client.query("INSERT INTO users(email,name,password_hash,role,district_id) VALUES ('real@fixture.invalid','Real fixture','fake-password-hash-preserved','mentor',1)");
    const asOf=new Date(Date.now()-60_000).toISOString();
    await client.query("UPDATE request_events SET occurred_at=$1::timestamptz-interval '90 days' WHERE kind='tracking_started'",[asOf]);
    const receipt=await seedSyntheticClassroom({client,asOf,apply:true});
    await client.query("INSERT INTO requests(author_id,district_id,title,description,role) VALUES(1,1,'Newest real QA','Preserve after old seed','mentor')");
    await client.query('GRANT USAGE ON SCHEMA public TO mentor_connect_app,mentor_connect_readiness');
    await client.query('GRANT SELECT ON ALL TABLES IN SCHEMA public TO mentor_connect_readiness');
    await client.query('GRANT SELECT,INSERT ON public.requests TO mentor_connect_app');
    await client.query('GRANT UPDATE(title) ON public.requests TO mentor_connect_app');
    await client.query('GRANT USAGE ON SEQUENCE public.requests_id_seq TO mentor_connect_app');
    await client.query('GRANT CONNECT ON DATABASE neondb TO mentor_connect_app');
    const expectedTarget=(await client.query('SELECT current_database() AS database,current_user AS user,inet_server_addr()::text AS "serverAddress",inet_server_port() AS "serverPort"')).rows[0];
    const preview=await reviseSyntheticClassroom({client,receipt,expectedTarget,releaseSha:'a'.repeat(40)});
    const before=await fullRowProof(client,assets);
    assert.equal(before.settings.provider,'c');
    assert.equal(before.settings.collate,'C');
    assert.equal(before.settings.ctype,'C');
    assert.equal(before.settings.locale,null);
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await client.query("SET LOCAL search_path TO public,pg_catalog; SET LOCAL timezone='UTC'");
    const binding=await readSyntheticRevisionBaseline({client,receipt});await client.query('ROLLBACK');
    assert.deepEqual(Object.fromEntries(Object.keys(preview.before).map(key=>[key,same(preview.before[key],binding.before[key])])),Object.fromEntries(Object.keys(preview.before).map(key=>[key,true])));
    assert.equal(digest({before:preview.before,batchDigest:binding.batchDigest}),preview.evidence.baselineDigest);
    const evidence=await backupAndRestore({client,connectionEnv:{...cluster.env,PGDATABASE:'neondb',PGUSER:'neondb_owner'},receipt,preview,manifest:{directory,pgBin,codeRoot}});
    assert.equal(evidence.backup.baselineDigest,preview.evidence.baselineDigest);
    assert.equal(evidence.restore.backupSha256,evidence.backup.sha256);
    assert.equal((await stat(path.join(directory,'before-revision-schema8.dump'))).mode&0o777,0o600);
    compareRestoreProof(before,await fullRowProof(client,assets));
    assert.equal(before.rows.users.count,984);
    assert.equal(before.rows.requests.count,783);
    const drift=structuredClone(preview);drift.evidence.baselineDigest='f'.repeat(64);
    const other=await mkdtemp(path.join(os.tmpdir(),'refresh-backup-drift-test-'));await chmod(other,0o700);
    try{await assert.rejects(backupAndRestore({client,connectionEnv:cluster.env,receipt,preview:drift,manifest:{directory:other,pgBin,codeRoot}}));}finally{await rm(other,{recursive:true,force:true});}
    let commitProof;
    const state={applyStarted:true,commitSent:false,commitAcknowledged:false};
    const writer=()=>({verifiedAt:new Date().toISOString(),releaseSha:'a'.repeat(40),targetDigest:preview.evidence.targetDigest,evidenceDigest:'b'.repeat(64)});
    await reviseSyntheticClassroom({client:observedClient(client,state,async()=>{},async()=>{commitProof=await readSyntheticRevisionBaseline({client,receipt});}),receipt,expectedTarget,releaseSha:'a'.repeat(40),apply:true,expectedPreviewDigest:preview.previewDigest,prerequisites:{...preview.evidence,...evidence,writers:writer()},claim:{revisionId:preview.revisionId,attemptId:'fixture-attempt',previewDigest:preview.previewDigest,releaseSha:'a'.repeat(40),state:'claimed'},refreshWriterEvidence:async()=>writer()});
    assert.equal(state.commitAcknowledged,true);
    await client.end();client=undefined;
    const confirmed=await confirmCommittedReadOnly({observer:cluster.client('neondb','neondb_owner'),expectedTarget,receipt,expectedProof:commitProof,readBaseline:readSyntheticRevisionBaseline,noOtherClients,same});
    assert.deepEqual(confirmed,commitProof);
    const corrupted=structuredClone(commitProof);corrupted.fullRowDigests.users.digest='f'.repeat(64);
    await assert.rejects(confirmCommittedReadOnly({observer:cluster.client('neondb','neondb_owner'),expectedTarget,receipt,expectedProof:corrupted,readBaseline:readSyntheticRevisionBaseline,noOtherClients,same}));
  }finally{await client?.end();await cluster.close();await rm(directory,{recursive:true,force:true});}
});
