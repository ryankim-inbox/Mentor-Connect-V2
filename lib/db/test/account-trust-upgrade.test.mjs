import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Client } from '../../../ops/classroom-snapshot.mjs';
import { verifySchemaAssets } from '../tools/schema-assets.mjs';
import { runMigrationTransaction } from '../tools/migration-runner.mjs';

const rootDir=path.resolve(import.meta.dirname,'../../..');
const {ledger}=await verifySchemaAssets({rootDir});
const scratch=await mkdtemp(path.join(tmpdir(),'trust-upgrade-'));
let sequence=0;
async function fixture() {
  const name='account_trust_upgrade_'+(++sequence), role='trust_app_'+sequence;
  const admin=new Client({connectionString:process.env.TEST_DATABASE_URL});await admin.connect();
  await admin.query('CREATE DATABASE '+name);
  const url=new URL(process.env.TEST_DATABASE_URL);url.pathname='/'+name;
  const client=new Client({connectionString:url.href});await client.connect();
  await runMigrationTransaction({client,ledger:{...ledger,migrations:ledger.migrations.slice(0,5)},appSha:'a'.repeat(40)});
  await client.query(await readFile(path.join(rootDir,'tests/fixtures/chat-canonical.sql'),'utf8'));
  await client.query('CREATE ROLE '+role+' NOLOGIN');
  const env={...process.env,ACCOUNT_TRUST_DATABASE_URL:url.href,ACCOUNT_TRUST_TARGET:JSON.stringify({host:url.hostname,port:Number(url.port),database:name,appRole:role}),ACCOUNT_TRUST_APP_SHA:'b'.repeat(40),ACCOUNT_TRUST_APPROVAL_ID:'local-only',ACCOUNT_TRUST_BACKUP_SHA:'c'.repeat(64),ACCOUNT_TRUST_AUDIT_PATH:path.join(scratch,'audit-'+sequence+'.jsonl')};
  return {client,role,env,async close(){await client.end();await admin.query('DROP DATABASE '+name+' WITH (FORCE)');await admin.query('DROP ROLE '+role);await admin.end();}};
}
function run(env,ack=true){return spawnSync(process.execPath,['ops/upgrade-account-trust.mjs','--apply',...(ack?['--acknowledge-email-ownership-reset']:[])],{cwd:rootDir,env,encoding:'utf8',timeout:20000});}

test('ownership reset requires its own explicit acknowledgement before writes',async()=>{
  const f=await fixture();try {
    assert.notEqual(run(f.env,false).status,0);
    assert.equal((await f.client.query('SELECT count(*)::int AS n FROM mentor_connect_schema_migrations')).rows[0].n,5);
    assert.equal((await f.client.query('SELECT bool_and(is_verified) AS verified FROM users')).rows[0].verified,true);
  }finally{await f.close();}
});
test('explicit local upgrade preserves content, resets legacy trust, adds narrow grants and does not promote admins',async()=>{
  const f=await fixture();try {
    const before=(await f.client.query('SELECT * FROM chat_messages ORDER BY id')).rows;
    const result=run(f.env);assert.equal(result.status,0,result.stderr);
    assert.deepEqual((await f.client.query('SELECT * FROM chat_messages ORDER BY id')).rows,before);
    assert.equal((await f.client.query('SELECT count(*)::int AS n FROM users WHERE is_verified OR email_verified_at IS NOT NULL OR is_admin')).rows[0].n,0);
    assert.equal((await f.client.query('SELECT count(*)::int AS n FROM mentor_connect_schema_migrations')).rows[0].n,6);
    const grants=(await f.client.query("SELECT has_table_privilege($1,'request_comments','UPDATE') AS update,has_table_privilege($1,'request_comments','DELETE') AS delete,has_table_privilege($1,'email_verification_tokens','DELETE') AS tokens,has_table_privilege($1,'reports','UPDATE') AS moderate",[f.role])).rows[0];
    assert.deepEqual(grants,{update:true,delete:false,tokens:true,moderate:true});
    const audit=(await readFile(f.env.ACCOUNT_TRUST_AUDIT_PATH,'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(audit.at(-1).result,'committed');
    assert.notEqual(run({...f.env,ACCOUNT_TRUST_AUDIT_PATH:f.env.ACCOUNT_TRUST_AUDIT_PATH+'.retry'}).status,0);
  }finally{await f.close();}
});
test('account trust upgrade refuses non-loopback or mismatched database targets',async()=>{
  const f=await fixture();try {
    const target=JSON.parse(f.env.ACCOUNT_TRUST_TARGET);
    assert.notEqual(run({...f.env,ACCOUNT_TRUST_TARGET:JSON.stringify({...target,host:'remote.example'})}).status,0);
    assert.notEqual(run({...f.env,ACCOUNT_TRUST_TARGET:JSON.stringify({...target,database:'other'})}).status,0);
    assert.equal((await f.client.query('SELECT count(*)::int AS n FROM mentor_connect_schema_migrations')).rows[0].n,5);
  }finally{await f.close();}
});
