// Local rehearsal only. An ownership reset needs a separate explicit acknowledgement.
import { open } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { classroomConnection } from './classroom-snapshot.mjs';
import { verifySchemaAssets } from '../lib/db/tools/schema-assets.mjs';
import { validateAppliedMigrations } from '../lib/db/tools/migration-ledger.mjs';
import { runMigrationTransaction } from '../lib/db/tools/migration-runner.mjs';
const rootDir=path.resolve(import.meta.dirname,'..');
const check=condition=>{if(!condition)throw new Error('account trust upgrade precondition');};
const identifier=value=>'"'+value.replaceAll('"','""')+'"';

export function accountTrustConnection(databaseUrl,target){
  check(target && ['127.0.0.1','localhost','[::1]'].includes(target.host));
  check(/^account_trust_upgrade_[a-z0-9_]+$/.test(target.database??''));
  check(/^[a-z][a-z0-9_]*$/.test(target.appRole??''));
  const connection=classroomConnection({databaseUrl,allowedHost:target.host,databaseName:target.database});
  check(Number(connection.env.PGPORT)===target.port);
  return connection;
}

export async function upgradeAccountTrust({client,assets,target,appSha,audit,acknowledged}){
  check(acknowledged===true);
  const ledger={...assets.ledger,migrations:assets.ledger.migrations.filter(m=>m.sequence<=6)};
  check(ledger.migrations.at(-1).id==='0006_account_trust');
  await client.query("SET statement_timeout='60s'; SET lock_timeout='5s'; SET idle_in_transaction_session_timeout='30s'");
  return runMigrationTransaction({client,ledger,appSha,
    async beforeApply(locked){
      const rows=(await locked.query('SELECT ordinal,migration_id AS "migrationId",checksum,app_sha AS "appSha" FROM mentor_connect_schema_migrations ORDER BY ordinal')).rows;
      check(rows.length===5 && rows.at(-1).migrationId==='0005_request_interactions');
      check(JSON.stringify(validateAppliedMigrations(ledger.migrations,rows).map(m=>m.id))===JSON.stringify(['0006_account_trust']));
      check((await locked.query('SELECT current_database() AS name')).rows[0].name===target.database);
      const roles=(await locked.query('SELECT rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=$1',[target.appRole])).rows;
      check(roles.length===1 && Object.values(roles[0]).every(value=>value===false));
      await audit({result:'ownership-reset-acknowledged',migration:'0006_account_trust'});
    },
    async afterApply(locked){
      const role=identifier(target.appRole);
      await locked.query(`GRANT SELECT,INSERT,DELETE ON email_verification_tokens,email_verification_requests TO ${role}; GRANT USAGE ON SEQUENCE email_verification_requests_id_seq TO ${role}; GRANT UPDATE ON request_comments,reports TO ${role}`);
      // No privilege grant or synthetic ownership proof is part of the migration.
      check((await locked.query('SELECT count(*)::int AS n FROM users WHERE is_verified OR email_verified_at IS NOT NULL OR is_admin')).rows[0].n===0);
      await audit({result:'verified-before-commit',migration:'0006_account_trust'});
    }
  });
}

async function main(){
  const args=process.argv.slice(2);
  check(args.length===2 && args[0]==='--apply' && args[1]==='--acknowledge-email-ownership-reset');
  const target=JSON.parse(process.env.ACCOUNT_TRUST_TARGET??'null');
  const connection=accountTrustConnection(process.env.ACCOUNT_TRUST_DATABASE_URL,target);
  const appSha=process.env.ACCOUNT_TRUST_APP_SHA;
  check(/^[a-f0-9]{40}$/.test(appSha??''));
  check(/^[a-f0-9]{64}$/.test(process.env.ACCOUNT_TRUST_BACKUP_SHA??''));
  check(/^[a-zA-Z0-9_-]{1,100}$/.test(process.env.ACCOUNT_TRUST_APPROVAL_ID??''));
  check(path.isAbsolute(process.env.ACCOUNT_TRUST_AUDIT_PATH??''));
  const assets=await verifySchemaAssets({rootDir});
  const handle=await open(process.env.ACCOUNT_TRUST_AUDIT_PATH,'wx',0o600);
  const audit=async data=>{await handle.writeFile(JSON.stringify({at:new Date().toISOString(),appSha,approvalId:process.env.ACCOUNT_TRUST_APPROVAL_ID,backupSha:process.env.ACCOUNT_TRUST_BACKUP_SHA,...data})+'\n');await handle.sync();};
  const client=connection.createClient({connectionTimeoutMillis:10000,query_timeout:65000});
  const deadline=setTimeout(()=>{void client.end().catch(()=>{});},120000);
  try{
    await client.connect();
    const result=await upgradeAccountTrust({client,assets,target,appSha,audit,acknowledged:true});
    await audit({result:'committed',migrations:result.applied});
    console.log(JSON.stringify(result));
  }catch(error){await audit({result:'failed-or-unconfirmed'}).catch(()=>{});throw error;}
  finally{clearTimeout(deadline);await client.end().catch(()=>{});await handle.close();}
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  main().catch(()=>{console.error('account trust upgrade rejected or unconfirmed');process.exitCode=1;});
}
