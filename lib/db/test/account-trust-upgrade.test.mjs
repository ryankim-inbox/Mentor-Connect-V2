import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Client } from '../../../ops/classroom-snapshot.mjs';
import { verifySchemaAssets } from '../tools/schema-assets.mjs';
import { runMigrationTransaction } from '../tools/migration-runner.mjs';
import { upgradeAccountTrust } from '../../../ops/upgrade-account-trust.mjs';

const rootDir=path.resolve(import.meta.dirname,'../../..');
const assets=await verifySchemaAssets({rootDir});
const {ledger}=assets;
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
  await client.query(`GRANT USAGE ON SCHEMA public TO ${role}; GRANT SELECT,INSERT,UPDATE ON users TO ${role}; GRANT USAGE ON SEQUENCE users_id_seq TO ${role}`);
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

test('upgrade removes inherited table writes while runtime user flows retain exact column rights',async()=>{
  const f=await fixture();try {
    assert.equal((await f.client.query("SELECT has_table_privilege($1,'users','UPDATE') AS allowed",[f.role])).rows[0].allowed,true);
    const result=run(f.env);assert.equal(result.status,0,result.stderr);
    const rights=(await f.client.query("SELECT has_table_privilege($1,'users','INSERT') AS table_insert,has_table_privilege($1,'users','UPDATE') AS table_update,has_column_privilege($1,'users','is_admin','INSERT') AS admin_insert,has_column_privilege($1,'users','is_admin','UPDATE') AS admin_update",[f.role])).rows[0];
    assert.deepEqual(rights,{table_insert:false,table_update:false,admin_insert:false,admin_update:false});
    await f.client.query('SET ROLE '+f.role);
    const user=(await f.client.query("INSERT INTO users(email,name,password_hash,role,district_id,is_verified,subjects) VALUES ('grant-test@example.edu','Grant test','synthetic-hash','mentee',1,false,'{}') RETURNING *")).rows[0];
    assert.equal(user.is_admin,false);assert.equal(user.is_verified,false);
    await f.client.query("UPDATE users SET name='Changed',bio='Local only',role='both',subjects=ARRAY['Math'] WHERE id=$1 RETURNING *",[user.id]);
    await f.client.query('BEGIN');
    await f.client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[user.id]);
    const verified=(await f.client.query('UPDATE users SET email_verified_at=now(),is_verified=true WHERE id=$1 RETURNING *',[user.id])).rows[0];
    assert.equal(verified.is_verified,true);assert.equal(verified.is_admin,false);
    await f.client.query('COMMIT');
    for(const value of ['true','false','DEFAULT']) {
      await assert.rejects(f.client.query(`UPDATE users SET is_admin=${value} WHERE id=$1`,[user.id]),{code:'42501'});
      await assert.rejects(f.client.query(`INSERT INTO users(email,name,password_hash,role,district_id,is_admin) VALUES ('forged@example.edu','Forgery','hash','mentor',1,${value})`),{code:'42501'});
    }
    await assert.rejects(f.client.query("UPDATE users SET email='other@example.edu' WHERE id=$1",[user.id]),{code:'42501'});
    await f.client.query('RESET ROLE');
  }finally{await f.close();}
});

for(const unsafe of ['owner','membership','public-write','public-table-write','schema-create','missing-sequence','definer-function','external-definer-function']) {
  test(`upgrade rolls back for unsafe app authority: ${unsafe}`,async()=>{
    const f=await fixture();let group;
    try {
      if(unsafe==='owner')await f.client.query('ALTER TABLE users OWNER TO '+f.role);
      if(unsafe==='membership') {
        group=f.role+'_group';await f.client.query('CREATE ROLE '+group+' NOLOGIN');
        await f.client.query('ALTER ROLE '+f.role+' NOINHERIT');
        await f.client.query(`GRANT UPDATE ON users TO ${group}; GRANT ${group} TO ${f.role}`);
      }
      if(unsafe==='public-write')await f.client.query('GRANT UPDATE(email) ON users TO PUBLIC');
      if(unsafe==='public-table-write')await f.client.query('GRANT UPDATE ON users TO PUBLIC');
      if(unsafe==='schema-create')await f.client.query('GRANT CREATE ON SCHEMA public TO '+f.role);
      if(unsafe==='missing-sequence')await f.client.query('REVOKE USAGE ON users_id_seq FROM '+f.role);
      if(unsafe==='definer-function')await f.client.query('CREATE FUNCTION unsafe_fixture() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$');
      if(unsafe==='external-definer-function')await f.client.query(`CREATE SCHEMA maintenance;
        GRANT USAGE ON SCHEMA maintenance TO ${f.role};
        CREATE FUNCTION maintenance.elevate() RETURNS void LANGUAGE plpgsql SECURITY DEFINER
        AS $$ BEGIN EXECUTE 'UPDATE public.users SET is_admin=true'; END $$`);
      const beforeUsers=(await f.client.query('SELECT * FROM users ORDER BY id')).rows;
      assert.notEqual(run(f.env).status,0);
      assert.deepEqual((await f.client.query('SELECT * FROM users ORDER BY id')).rows,beforeUsers);
      assert.deepEqual((await f.client.query("SELECT has_table_privilege($1,'users','INSERT') AS insert,has_table_privilege($1,'users','UPDATE') AS update",[f.role])).rows[0],{insert:true,update:true});
      assert.equal((await f.client.query('SELECT count(*)::int AS n FROM mentor_connect_schema_migrations')).rows[0].n,5);
      assert.equal((await f.client.query('SELECT bool_and(is_verified) AS verified FROM users')).rows[0].verified,true);
      assert.equal((await f.client.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name='users' AND column_name='is_admin'")).rows[0].n,0);
    }finally{
      if(group){await f.client.query('DROP OWNED BY '+group);await f.client.query('DROP ROLE '+group);}
      await f.close();
    }
  });
}

test('failure after grant verification rolls back schema, ledger, ownership reset and original grants',async()=>{
  const f=await fixture();try {
    const before=(await f.client.query('SELECT * FROM users ORDER BY id')).rows;
    await assert.rejects(upgradeAccountTrust({client:f.client,assets,target:JSON.parse(f.env.ACCOUNT_TRUST_TARGET),appSha:'d'.repeat(40),acknowledged:true,
      audit:async data=>{if(data.result==='verified-before-commit')throw new Error('injected audit failure');}}),/injected audit failure/);
    assert.deepEqual((await f.client.query('SELECT * FROM users ORDER BY id')).rows,before);
    assert.equal((await f.client.query('SELECT count(*)::int AS n FROM mentor_connect_schema_migrations')).rows[0].n,5);
    assert.equal((await f.client.query("SELECT has_table_privilege($1,'users','UPDATE') AS allowed",[f.role])).rows[0].allowed,true);
    assert.equal((await f.client.query("SELECT to_regclass('email_verification_tokens') AS name")).rows[0].name,null);
  }finally{await f.close();}
});
