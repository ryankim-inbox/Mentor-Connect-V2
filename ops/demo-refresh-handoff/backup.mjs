import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, chmod, open, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir, userInfo } from 'node:os';
import { Client, fileChecksum } from '../classroom-snapshot.mjs';
import { readRevisionSchemaState } from '../synthetic-revision-evidence.mjs';
import { readSyntheticRevisionBaseline } from '../revise-synthetic-classroom.mjs';
import { verifySchemaAssets } from '../../lib/db/tools/schema-assets.mjs';
import { validateAppliedMigrations } from '../../lib/db/tools/migration-ledger.mjs';
import { diffCatalog } from '../../lib/db/tools/catalog.mjs';
import { prepareRestoreComparison } from '../restore-relation-acls.mjs';
import { TARGET,digest, same, requireThat, durableCreate, privateDirectory } from './protocol.mjs';

const quote=value=>'"'+String(value).replaceAll('"','""')+'"';
export const cleanEnvironment=()=>({PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',PGPASSFILE:'/dev/null',PGCONNECT_TIMEOUT:'15'});
export function remoteDumpEnvironment(password,directory) {
  return {...cleanEnvironment(),PGHOST:TARGET.host,PGPORT:String(TARGET.port),PGDATABASE:TARGET.database,PGUSER:TARGET.user,PGPASSWORD:password,PGSSLMODE:'verify-full',PGSSLROOTCERT:'/private/etc/ssl/cert.pem',PGSSLCERTMODE:'disable',PGSSLCERT:path.join(directory,'absent-client-certificate'),PGSSLKEY:path.join(directory,'absent-client-key'),PGSSLCRL:path.join(directory,'absent-revocation-list'),PGGSSENCMODE:'disable',PGREQUIREAUTH:'scram-sha-256'};
}
/** Never retain or surface native stdout/stderr, which can contain data or secrets. */
export function command(executable,args,env) {
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,args,{env,stdio:['ignore','ignore','ignore']});
    const timer=setTimeout(()=>child.kill('SIGKILL'),120_000);
    child.once('error',()=>{clearTimeout(timer);reject(new Error('NATIVE_COMMAND_FAILED'));});
    child.once('close',code=>{clearTimeout(timer);code===0?resolve():reject(new Error('NATIVE_COMMAND_FAILED'));});
  });
}
export async function noOtherClients(client) {
  await client.query('SELECT pg_stat_clear_snapshot()');
  requireThat((await client.query('SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()')).rows[0].n===0);
}
export async function fullRowProof(client,assets) {
  const schema=await readRevisionSchemaState(client);
  const aclFields=new Set(['relacl','attacl','proacl','nspacl','defaclacl','datacl']);
  const aclStrings=new Set();
  const visit=value=>{if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')for(const [key,item] of Object.entries(value)){if(aclFields.has(key)&&typeof item==='string')aclStrings.add(item);else visit(item);}};
  visit(schema);
  // pg treats aclitem[] as an unknown type and may return its text encoding.
  // Let PostgreSQL decode that encoding; never parse ACL strings heuristically.
  const decoded=new Map((await client.query('SELECT value AS raw,array_to_json(value::aclitem[]) AS acl FROM unnest($1::text[]) AS value',[[...aclStrings]])).rows.map(row=>[row.raw,row.acl]));
  const normalize=value=>Array.isArray(value)?value.map(normalize):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,aclFields.has(key)&&typeof item==='string'?[...decoded.get(item)].sort():normalize(item)])):value;
  const portableSchema=normalize(schema);
  requireThat(diffCatalog(assets.catalog,schema.catalog).length===0);
  const ledger=(await client.query('SELECT ordinal,migration_id AS "migrationId",checksum,applied_at AS "appliedAt",app_sha AS "appSha" FROM public.mentor_connect_schema_migrations ORDER BY ordinal')).rows;
  requireThat(validateAppliedMigrations(assets.ledger.migrations,ledger).length===0&&assets.version.schemaVersion==='0008');
  const rows={};
  for(const table of [...assets.catalog.tables,'mentor_connect_schema_migrations'].sort()) {
    const hashes=(await client.query(`SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS hash FROM public.${quote(table)} t ORDER BY hash`)).rows.map(row=>row.hash);
    rows[table]={count:hashes.length,digest:digest(hashes)};
  }
  // Includes complete password hashes inside a server-side hash only.
  const passwords=(await client.query("SELECT encode(sha256(convert_to(jsonb_build_array(id,password_hash)::text,'UTF8')),'hex') AS hash FROM public.users ORDER BY hash")).rows.map(row=>row.hash);
  const sequences={};
  for(const name of schema.sequences.map(row=>row.relname))sequences[name]=(await client.query(`SELECT last_value::text,is_called FROM public.${quote(name)}`)).rows[0];
  const settings=(await client.query("SELECT current_setting('server_version_num') AS version,pg_encoding_to_char(d.encoding) AS encoding,d.datlocprovider::text AS provider,d.datcollate AS collate,d.datctype AS ctype,to_jsonb(d)->>'datlocale' AS locale,to_jsonb(d)->>'daticurules' AS rules,to_jsonb(d)->>'datcollversion' AS \"collationVersion\" FROM pg_database d WHERE datname=current_database()")).rows[0];
  const roles=(await client.query("SELECT rolname FROM pg_roles WHERE rolname !~ '^pg_' ORDER BY rolname")).rows.map(row=>row.rolname);
  const databaseGrants=(await client.query("SELECT coalesce(r.rolname,'PUBLIC') AS role,a.privilege_type AS privilege,a.is_grantable,pg_get_userbyid(a.grantor) AS grantor FROM pg_database d CROSS JOIN LATERAL aclexplode(d.datacl) a LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE d.datname=current_database() ORDER BY role,privilege")).rows;
  // Internal RI trigger names contain cluster-local catalog OIDs. Compare their
  // complete portable structure; retain the original names in source schema.
  const triggerStructure=(await client.query("SELECT r.relname,t.tgisinternal,CASE WHEN t.tgisinternal THEN NULL ELSE t.tgname END AS name,t.tgenabled,t.tgtype,t.tgdeferrable,t.tginitdeferred,c.conname,cr.relname AS constraint_table,n.nspname AS function_schema,p.proname,encode(t.tgargs,'hex') AS arguments,t.tgattr::text AS attributes,t.tgoldtable,t.tgnewtable,CASE WHEN NOT t.tgisinternal THEN pg_get_triggerdef(t.oid) END AS user_definition,pg_get_expr(t.tgqual,t.tgrelid) AS condition FROM pg_trigger t JOIN pg_class r ON r.oid=t.tgrelid JOIN pg_namespace rn ON rn.oid=r.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=p.pronamespace LEFT JOIN pg_constraint c ON c.oid=t.tgconstraint LEFT JOIN pg_class cr ON cr.oid=t.tgconstrrelid WHERE rn.nspname='public' ORDER BY r.relname,c.conname,p.proname,t.tgtype,name")).rows;
  return {schema,portableSchema,ledger,rows,passwordDigest:digest(passwords),sequences,settings,roles,databaseGrants,triggerStructure};
}
function portableAcl(value) {
  if(Array.isArray(value))return value.map(portableAcl);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,['relacl','attacl','proacl','nspacl','defaclacl','datacl'].includes(key)&&Array.isArray(item)?[...item].sort():portableAcl(item)]));
  return value;
}
export function compareRestoreProof(source,restored) {
  // Role definitions/passwords are deliberately not copied. All database object
  // owners/ACLs and database name are preserved in the disposable cluster.
  for(const key of ['schema','ledger','rows','passwordDigest','sequences','settings','databaseGrants','triggerStructure']) {
    if(key==='schema') {for(const field of Object.keys(source.schema))if(field!=='triggers'&&!same(portableAcl((source.portableSchema??source.schema)[field]),portableAcl((restored.portableSchema??restored.schema)[field])))throw new Error('RESTORE_SCHEMA_MISMATCH_'+field);}
    else if(!same(source[key],restored[key]))throw new Error('RESTORE_PROOF_MISMATCH_'+key);
  }
}
export async function localCluster({pgBin,run=command}) {
  const directory=await mkdtemp(path.join(tmpdir(),'mentor-refresh-restore-'));await chmod(directory,0o700);
  const socket=path.join(directory,'s');await mkdir(socket,{mode:0o700});
  const env={...cleanEnvironment(),PGHOST:socket,PGPORT:'5432',PGUSER:userInfo().username,PGDATABASE:'postgres'};
  let started=false;
  try {
    await run(path.join(pgBin,'initdb'),['-D',path.join(directory,'cluster'),'--no-locale','--encoding=UTF8','--auth-local=trust','--auth-host=reject'],env);
    await run(path.join(pgBin,'pg_ctl'),['-D',path.join(directory,'cluster'),'-l',path.join(directory,'server.log'),'-o',`-F -h '' -p 5432 -k ${socket}`,'-w','start'],env);started=true;
  } catch(error) {if(started)await run(path.join(pgBin,'pg_ctl'),['-D',path.join(directory,'cluster'),'-m','immediate','-w','stop'],env).catch(()=>{});await rm(directory,{recursive:true,force:true});throw error;}
  return {env,client(database,user=userInfo().username) {const client=new Client({host:socket,port:5432,database,user,password:'',ssl:false});client.password='';client.connectionParameters.password='';return client;},async close(){await run(path.join(pgBin,'pg_ctl'),['-D',path.join(directory,'cluster'),'-m','immediate','-w','stop'],env);await rm(directory,{recursive:true,force:true});}};
}
async function prepareRestoreDatabase(admin,proof) {
  const db=proof.schema.database[0];requireThat(proof.schema.database.length===1&&db.datname==='neondb'&&db.owner==='neondb_owner');
  for(const role of proof.roles) {
    requireThat(/^[A-Za-z_][A-Za-z0-9_-]{0,62}$/.test(role));
    if((await admin.query('SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=$1) AS found',[role])).rows[0].found)continue;
    await admin.query(`CREATE ROLE ${quote(role)} ${role===db.owner?'LOGIN':'NOLOGIN'}`);
  }
  const s=proof.settings;requireThat(/^1[68][0-9]{4}$/.test(s.version)&&s.encoding==='UTF8'&&s.rules===null);
  let locale;
  if(s.provider==='b'&&s.locale==='C.UTF-8'&&s.collate==='C.UTF-8'&&s.ctype==='C.UTF-8'&&s.collationVersion==='1')locale="LOCALE_PROVIDER builtin LOCALE 'C.UTF-8' BUILTIN_LOCALE 'C.UTF-8'";
  else {requireThat(s.provider==='c'&&s.locale===null&&s.collate==='C'&&s.ctype==='C'&&s.collationVersion===null);locale="LOCALE_PROVIDER libc LC_COLLATE 'C' LC_CTYPE 'C'";}
  await admin.query(`CREATE DATABASE ${quote(db.datname)} TEMPLATE template0 OWNER ${quote(db.owner)} ENCODING 'UTF8' ${locale}`);
  if(db.datacl!==null) {
    await admin.query(`SET ROLE ${quote(db.owner)}`);
    try {
      await admin.query(`REVOKE ALL ON DATABASE ${quote(db.datname)} FROM PUBLIC,${quote(db.owner)}`);
      for(const grant of proof.databaseGrants) {requireThat(['CREATE','CONNECT','TEMPORARY'].includes(grant.privilege)&&grant.grantor===db.owner);await admin.query(`GRANT ${grant.privilege} ON DATABASE ${quote(db.datname)} TO ${grant.role==='PUBLIC'?'PUBLIC':quote(grant.role)}${grant.is_grantable?' WITH GRANT OPTION':''}`);}
    } finally {await admin.query('RESET ROLE');}
  }
}
export async function backupAndRestore({client,connectionEnv,receipt,preview,manifest,run=command,clusterFactory=localCluster}) {
  await privateDirectory(manifest.directory);
  const assets=await verifySchemaAssets({rootDir:manifest.codeRoot});requireThat(assets.version.schemaVersion==='0008');
  const dumpPath=path.join(manifest.directory,'before-revision-schema8.dump');
  const reserved=await open(dumpPath,'wx',0o600);await reserved.close();
  let proof,createdAt;
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  try {
    await client.query("SET LOCAL search_path TO public,pg_catalog; SET LOCAL timezone='UTC'; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s'; SET LOCAL idle_in_transaction_session_timeout='180s'");
    await client.query(`LOCK TABLE ${[...assets.catalog.tables,'mentor_connect_schema_migrations'].sort().map(t=>'public.'+quote(t)).join(',')} IN SHARE MODE NOWAIT`);
    await noOtherClients(client);
    requireThat(!(await client.query("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname<>'plpgsql' UNION ALL SELECT 1 FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname NOT IN ('public','information_schema')) AS found")).rows[0].found);
    const baseline=await readSyntheticRevisionBaseline({client,receipt});requireThat(baseline.baselineDigest===preview.evidence.baselineDigest);
    proof=await fullRowProof(client,assets);
    const exported=(await client.query('SELECT pg_export_snapshot() AS snapshot,clock_timestamp() AS at')).rows[0];createdAt=exported.at.toISOString();
    await run(path.join(manifest.pgBin,'pg_dump'),['--no-password','--format=custom','--snapshot',exported.snapshot,'--file',dumpPath],{...connectionEnv,PGOPTIONS:'-c default_transaction_read_only=on -c statement_timeout=120000'});
    requireThat(same(proof,await fullRowProof(client,assets)));await noOtherClients(client);await client.query('ROLLBACK');
  } catch(error) {await client.query('ROLLBACK').catch(()=>{});throw error;}
  const handle=await open(dumpPath,'r');try{await handle.sync();}finally{await handle.close();}
  const sha256=await fileChecksum(dumpPath);
  await durableCreate(path.join(manifest.directory,'backup-evidence.json'),{schemaVersion:'0008',sha256,createdAt,targetDigest:preview.evidence.targetDigest,baselineDigest:preview.evidence.baselineDigest,proof});
  const cluster=await clusterFactory({pgBin:manifest.pgBin,run});
  try {
    const admin=cluster.client('postgres');await admin.connect();try{await prepareRestoreDatabase(admin,proof);}finally{await admin.end();}
    requireThat(await fileChecksum(dumpPath)===sha256);
    await run(path.join(manifest.pgBin,'pg_restore'),['--no-password','--exit-on-error','--single-transaction','--dbname','neondb',dumpPath],cluster.env);
    const restored=cluster.client('neondb','neondb_owner');await restored.connect();
    try{
      await restored.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await restored.query("SET LOCAL search_path TO public,pg_catalog; SET LOCAL timezone='UTC'");
      const actual=await fullRowProof(restored,assets);
      compareRestoreProof(await prepareRestoreComparison(restored,proof),await prepareRestoreComparison(restored,actual));
      await restored.query('ROLLBACK');
    }finally{await restored.end();}
  }finally{await cluster.close();}
  const result={backup:{sha256,createdAt,targetDigest:preview.evidence.targetDigest,baselineDigest:preview.evidence.baselineDigest},restore:{backupSha256:sha256,verifiedAt:new Date().toISOString(),baselineDigest:preview.evidence.baselineDigest}};
  await durableCreate(path.join(manifest.directory,'restore-evidence.json'),{...result.restore,verified:['full-rows','password-hashes','ledger','sequences','catalog','owners','grants','database-locale']});
  return result;
}
