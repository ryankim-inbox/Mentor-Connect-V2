// LOCAL ONLY. This module has no remote target, URL parser, credential prompt,
// seed/migration runner, revision operator, or path for changing the source DB.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { userInfo } from 'node:os';
import pg from '../../lib/db/node_modules/pg/lib/index.js';
import { verifySchemaAssets } from '../../lib/db/tools/schema-assets.mjs';
import { fullRowProof, same } from './proof.mjs';
import { prepareRestoreComparison } from '../restore-relation-acls.mjs';

export const STAGES=['input-verification','initdb','server-start','database-prepare','archive-restore','proof-read','proof-compare','server-stop','cleanup'];
export const SCHEMA_FIELDS=['catalog','relations','columns','sequences','constraints','policies','functions','grants','defaultGrants','schemas','views','ownership','database'];
export const PROOF_FIELDS=['ledger','rows','passwordDigest','sequences','settings','databaseGrants','triggerStructure'];
export const CATEGORIES=['LOCAL_OPERATION_FAILED','INPUT_REJECTED','ARCHIVE_CHECKSUM_MISMATCH','EVIDENCE_CHECKSUM_MISMATCH','PROOF_SHAPE_REJECTED','PROOF_PRECONDITION_REJECTED','UNSUPPORTED_DATABASE_SETTINGS','NATIVE_FAILED','NATIVE_TIMEOUT','NATIVE_PERMISSION_DENIED','NATIVE_ROLE_MISSING','NATIVE_OBJECT_EXISTS','NATIVE_UNKNOWN_SETTING','NATIVE_ARCHIVE_INVALID','SQL_PERMISSION_DENIED','SQL_OBJECT_MISSING','SQL_OBJECT_EXISTS','SQL_FEATURE_UNSUPPORTED','SQL_INTERNAL_ERROR','SQL_CONNECTION_FAILED','PROOF_DIFFERENCE','MATCH'];
const sqlCodes={'42501':'SQL_PERMISSION_DENIED','42704':'SQL_OBJECT_MISSING','42P04':'SQL_OBJECT_EXISTS','42P07':'SQL_OBJECT_EXISTS','3D000':'SQL_OBJECT_MISSING','0A000':'SQL_FEATURE_UNSUPPORTED','XX000':'SQL_INTERNAL_ERROR','08006':'SQL_CONNECTION_FAILED'};
const requireThat=(condition,code='INPUT_REJECTED')=>{if(!condition)throw new Error(code);};
const quote=value=>'"'+String(value).replaceAll('"','""')+'"';
export const cleanEnvironment=()=>({PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',PGPASSFILE:'/dev/null',PGCONNECT_TIMEOUT:'5'});

export function classifyFailure(error) {
  if(Object.hasOwn(sqlCodes,error?.code??''))return {category:sqlCodes[error.code],sqlstate:error.code};
  return {category:CATEGORIES.includes(error?.message)?error.message:'LOCAL_OPERATION_FAILED'};
}
export function classifyNativeLine(line) {
  if(/(?:ERROR:|FATAL:).*permission denied|must be (?:owner|member)|must be a member|must have .* privilege/i.test(line))return 'NATIVE_PERMISSION_DENIED';
  if(/(?:ERROR:|FATAL:).*role .* does not exist/i.test(line))return 'NATIVE_ROLE_MISSING';
  if(/(?:ERROR:|FATAL:).*already exists/i.test(line))return 'NATIVE_OBJECT_EXISTS';
  if(/(?:ERROR:|FATAL:).*unrecognized configuration parameter/i.test(line))return 'NATIVE_UNKNOWN_SETTING';
  if(/pg_restore: error:.*(?:unsupported version|input file does not appear|could not read|invalid archive)/i.test(line))return 'NATIVE_ARCHIVE_INVALID';
  return null;
}
export async function runNative(executable,args,env,{timeoutMs=120_000}={}) {
  // stdout is discarded. A bounded stderr line is inspected only for fixed
  // categories; raw text is never returned, logged, or written to evidence.
  return new Promise((resolve,reject)=>{
    let pending='',category=null,timedOut=false;
    const child=spawn(executable,args,{env,stdio:['ignore','ignore','pipe']});
    const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},timeoutMs);
    child.stderr.on('data',chunk=>{
      pending=(pending+chunk.toString('utf8')).slice(-16_384);
      const lines=pending.split('\n');pending=lines.pop();
      for(const line of lines)category??=classifyNativeLine(line);
    });
    child.once('error',()=>{clearTimeout(timer);reject(new Error('NATIVE_FAILED'));});
    child.once('close',code=>{
      clearTimeout(timer);category??=classifyNativeLine(pending);pending='';
      if(code===0&&!timedOut)resolve();else reject(new Error(timedOut?'NATIVE_TIMEOUT':category??'NATIVE_FAILED'));
    });
  });
}
async function privateDirectory(directory) {
  const stat=await lstat(directory);requireThat(stat.isDirectory()&&!stat.isSymbolicLink()&&stat.uid===process.getuid()&&(stat.mode&0o077)===0);
}
async function privateFile(filename,limit) {
  await privateDirectory(path.dirname(filename));
  const file=await open(filename,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const stat=await file.stat();requireThat(stat.isFile()&&stat.uid===process.getuid()&&(stat.mode&0o077)===0&&stat.nlink===1&&stat.size<=limit);return file;}catch(error){await file.close();throw error;}
}
async function checksum(filename) {
  const file=await privateFile(filename,16*1024*1024);
  try{const hash=createHash('sha256');for await(const chunk of file.createReadStream({autoClose:false}))hash.update(chunk);return hash.digest('hex');}finally{await file.close();}
}
function portableAcl(value) {
  if(Array.isArray(value))return value.map(portableAcl);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,['relacl','attacl','proacl','nspacl','defaclacl','datacl'].includes(key)&&Array.isArray(item)?[...item].sort():portableAcl(item)]));
  return value;
}
export function compareProofs(source,restored) {
  requireThat(source?.schema&&restored?.schema,'PROOF_SHAPE_REJECTED');
  for(const proof of [source,restored])requireThat(Object.keys(proof.schema).every(key=>key==='triggers'||SCHEMA_FIELDS.includes(key)),'PROOF_SHAPE_REJECTED');
  const differences=[];
  for(const field of SCHEMA_FIELDS)if(!same(portableAcl((source.portableSchema??source.schema)[field]),portableAcl((restored.portableSchema??restored.schema)[field])))differences.push('schema.'+field);
  for(const field of PROOF_FIELDS)if(!same(source[field],restored[field]))differences.push(field);
  return differences;
}
const RELATION_FIELDS=['relname','relkind','owner','relacl','reloptions','relrowsecurity','relforcerowsecurity'];
export async function analyzeRelationDifferences(client,source,restored) {
  // Additional evidence only: this never changes compareProofs or its failure.
  // No relation names, owners, ACL text or database values leave this function.
  try {
    for(const rows of [source,restored]) {
      requireThat(Array.isArray(rows)&&rows.length<=1024);
      requireThat(new Set(rows.map(row=>row?.relname)).size===rows.length);
      for(const row of rows) {
        requireThat(row&&same(Object.keys(row).sort(),[...RELATION_FIELDS].sort()));
        requireThat(['relname','relkind','owner'].every(key=>typeof row[key]==='string'&&row[key].length>0&&row[key].length<=128));
        requireThat(typeof row.relrowsecurity==='boolean'&&typeof row.relforcerowsecurity==='boolean');
        requireThat(['relacl','reloptions'].every(key=>row[key]===null||(Array.isArray(row[key])&&row[key].length<=256&&row[key].every(value=>typeof value==='string'&&value.length<=1024))));
      }
    }
    const left=new Map(source.map(row=>[row.relname,row])),right=new Map(restored.map(row=>[row.relname,row]));
    const detail={status:'complete',sourceCount:source.length,restoredCount:restored.length,missingCount:0,addedCount:0,changedCount:0,changedFields:[],orderChanged:false,aclDefaultEquivalentCount:0,aclEncodingEquivalentCount:0,aclPrivilegeDifferenceCount:0,aclUnclassifiedCount:0,sourceExplicitToNullCount:0,sourceNullToExplicitCount:0};
    const fields=new Set(),aclInputs=[];
    for(const [name,row] of left) {
      const other=right.get(name);
      if(!other){detail.missingCount++;fields.add('relname');continue;}
      const changed=RELATION_FIELDS.filter(key=>!same(portableAcl({[key]:row[key]}),portableAcl({[key]:other[key]})));
      if(!changed.length)continue;
      detail.changedCount++;changed.forEach(field=>fields.add(field));
      if(changed.includes('relacl')) {
        if(row.relkind!==other.relkind||row.owner!==other.owner||!['r','S'].includes(row.relkind)){detail.aclUnclassifiedCount++;continue;}
        const id=aclInputs.length;
        aclInputs.push({id,kind:row.relkind==='S'?'s':'r',owner:row.owner,source_acl:row.relacl,restored_acl:other.relacl});
      }
    }
    for(const name of right.keys())if(!left.has(name)){detail.addedCount++;fields.add('relname');}
    detail.orderChanged=!same(source.filter(row=>right.has(row.relname)).map(row=>row.relname),restored.filter(row=>left.has(row.relname)).map(row=>row.relname));
    detail.changedFields=[...fields].sort();
    if(aclInputs.length) {
      // PostgreSQL itself parses ACLs and expands NULL defaults. Compare every
      // grantor, grantee, privilege and grant option; [] remains an empty ACL.
      // aclexplode rejects zero-dimensional {}. An explicit [] means zero
      // privileges, so handle that exact value without expanding defaults.
      const privileges=column=>`(CASE WHEN input.${column}='[]'::jsonb THEN '[]'::jsonb ELSE (SELECT coalesce(jsonb_agg(jsonb_build_array(a.grantor,a.grantee,a.privilege_type,a.is_grantable) ORDER BY a.grantor,a.grantee,a.privilege_type,a.is_grantable),'[]'::jsonb) FROM aclexplode(CASE WHEN jsonb_typeof(input.${column})='array' THEN ARRAY(SELECT jsonb_array_elements_text(input.${column}))::aclitem[] ELSE acldefault(input.kind::"char",input.owner::regrole) END) a) END)`;
      const comparisons=(await client.query(`SELECT input.id,${privileges('source_acl')}=${privileges('restored_acl')} AS equivalent FROM jsonb_to_recordset($1::jsonb) AS input(id integer,kind text,owner text,source_acl jsonb,restored_acl jsonb) ORDER BY input.id`,[JSON.stringify(aclInputs)])).rows;
      requireThat(comparisons.length===aclInputs.length);
      for(const [index,row] of comparisons.entries()) {
        requireThat(row.id===index&&typeof row.equivalent==='boolean');
        const input=aclInputs[index];
        if(!row.equivalent){detail.aclPrivilegeDifferenceCount++;continue;}
        if(input.source_acl===null||input.restored_acl===null) {
          detail.aclDefaultEquivalentCount++;
          if(input.source_acl===null)detail.sourceNullToExplicitCount++;else detail.sourceExplicitToNullCount++;
        }else detail.aclEncodingEquivalentCount++;
      }
    }
    return detail;
  }catch{return {status:'unavailable'};}
}
export function localClient(socket,database,user) {
  requireThat(path.isAbsolute(socket)&&socket.length<100&&['postgres','neondb'].includes(database));
  requireThat(/^[A-Za-z_][A-Za-z0-9_-]{0,62}$/.test(user));
  const client=new pg.Client({host:socket,port:5432,database,user,password:'',ssl:false,connectionTimeoutMillis:5_000,query_timeout:30_000,options:''});
  client.password='';client.connectionParameters.password='';client.connectionParameters.options='';client.connectionParameters.replication=undefined;
  client.on('error',()=>{});return client;
}
async function prepareDatabase(admin,proof) {
  const db=proof.schema.database[0];requireThat(proof.schema.database.length===1&&db.datname==='neondb'&&db.owner==='neondb_owner');
  for(const role of proof.roles) {
    requireThat(/^[A-Za-z_][A-Za-z0-9_-]{0,62}$/.test(role));
    if(!(await admin.query('SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=$1) AS found',[role])).rows[0].found)await admin.query(`CREATE ROLE ${quote(role)} ${role===db.owner?'LOGIN':'NOLOGIN'}`);
  }
  const s=proof.settings;requireThat(s.version==='180006'&&s.encoding==='UTF8'&&s.rules===null,'UNSUPPORTED_DATABASE_SETTINGS');
  let locale;
  if(s.provider==='b'&&s.locale==='C.UTF-8'&&s.collate==='C.UTF-8'&&s.ctype==='C.UTF-8'&&s.collationVersion==='1')locale="LOCALE_PROVIDER builtin LOCALE 'C.UTF-8' BUILTIN_LOCALE 'C.UTF-8'";
  else{requireThat(s.provider==='c'&&s.locale===null&&s.collate==='C'&&s.ctype==='C'&&s.collationVersion===null,'UNSUPPORTED_DATABASE_SETTINGS');locale="LOCALE_PROVIDER libc LC_COLLATE 'C' LC_CTYPE 'C'";}
  await admin.query(`CREATE DATABASE neondb TEMPLATE template0 OWNER neondb_owner ENCODING 'UTF8' ${locale}`);
  if(db.datacl!==null) {
    await admin.query('SET ROLE neondb_owner');
    try {
      await admin.query('REVOKE ALL ON DATABASE neondb FROM PUBLIC,neondb_owner');
      for(const grant of proof.databaseGrants){requireThat(['CREATE','CONNECT','TEMPORARY'].includes(grant.privilege)&&grant.grantor===db.owner);await admin.query(`GRANT ${grant.privilege} ON DATABASE neondb TO ${grant.role==='PUBLIC'?'PUBLIC':quote(grant.role)}${grant.is_grantable?' WITH GRANT OPTION':''}`);}
    }finally{await admin.query('RESET ROLE');}
  }
}

export async function runDiagnostic({dumpPath,evidencePath,expectedDumpSha256,expectedEvidenceSha256,workDirectory,pgBin,assetsRoot}) {
  let stage='input-verification',started=false,clusterTouched=false,proof,assets,result;
  const cluster=path.join(workDirectory,'cluster'),socket=path.join(workDirectory,'s'),log=path.join(workDirectory,'server.log');
  const env={...cleanEnvironment(),PGHOST:socket,PGPORT:'5432',PGUSER:userInfo().username,PGDATABASE:'postgres'};
  let journal;
  const progress=async next=>{stage=next;if(journal){await journal.write(JSON.stringify({stage:next})+'\n');await journal.sync();}};
  try {
    await privateDirectory(workDirectory);requireThat((await readdir(workDirectory)).length===0);
    requireThat(path.isAbsolute(dumpPath)&&path.isAbsolute(evidencePath)&&path.isAbsolute(pgBin)&&path.isAbsolute(assetsRoot)&&socket.length<100);
    requireThat(/^[a-f0-9]{64}$/.test(expectedDumpSha256));
    journal=await open(path.join(workDirectory,'progress.jsonl'),'wx',0o600);await progress(stage);
    requireThat(await checksum(dumpPath)===expectedDumpSha256,'ARCHIVE_CHECKSUM_MISMATCH');
    if(expectedEvidenceSha256!==null)requireThat(await checksum(evidencePath)===expectedEvidenceSha256,'EVIDENCE_CHECKSUM_MISMATCH');
    const evidenceFile=await privateFile(evidencePath,4*1024*1024);
    let evidence;try{evidence=JSON.parse(await evidenceFile.readFile('utf8'));}finally{await evidenceFile.close();}
    requireThat(evidence.schemaVersion==='0008'&&evidence.sha256===expectedDumpSha256);proof=evidence.proof;
    assets=await verifySchemaAssets({rootDir:assetsRoot});requireThat(assets.version.schemaVersion==='0008');
    await mkdir(socket,{mode:0o700});clusterTouched=true;
    await progress('initdb');await runNative(path.join(pgBin,'initdb'),['-D',cluster,'--no-locale','--encoding=UTF8','--auth-local=trust','--auth-host=reject'],env);
    await progress('server-start');
    // TCP is disabled here AND denied by the launcher OS sandbox.
    await runNative(path.join(pgBin,'pg_ctl'),['-D',cluster,'-l',log,'-o',`-F -h '' -p 5432 -k ${socket} -c log_min_messages=fatal -c log_statement=none`,'-w','start'],env);started=true;
    await progress('database-prepare');
    const admin=localClient(socket,'postgres',userInfo().username);await admin.connect();
    try{await prepareDatabase(admin,proof);}finally{await admin.end();}
    await progress('archive-restore');
    requireThat(await checksum(dumpPath)===expectedDumpSha256,'ARCHIVE_CHECKSUM_MISMATCH');
    await runNative(path.join(pgBin,'pg_restore'),['--no-password','--exit-on-error','--single-transaction','--dbname','neondb',dumpPath],env);
    await progress('proof-read');
    const restored=localClient(socket,'neondb','neondb_owner');await restored.connect();
    let mismatchFields,relationAnalysis;
    try{
      await restored.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await restored.query("SET LOCAL search_path TO public,pg_catalog; SET LOCAL timezone='UTC'; SET LOCAL statement_timeout='30s'");
      const actual=await fullRowProof(restored,assets);
      await progress('proof-compare');
      mismatchFields=compareProofs(await prepareRestoreComparison(restored,proof),await prepareRestoreComparison(restored,actual));
      if(mismatchFields.includes('schema.relations'))relationAnalysis=await analyzeRelationDifferences(restored,(proof.portableSchema??proof.schema).relations,(actual.portableSchema??actual.schema).relations);
      await restored.query('ROLLBACK');
    }finally{await restored.end();}
    result={status:mismatchFields.length?'LOCAL_RESTORE_DIFFERENCE':'LOCAL_RESTORE_MATCH',failedStage:mismatchFields.length?stage:null,category:mismatchFields.length?'PROOF_DIFFERENCE':'MATCH',mismatchFields,...(relationAnalysis?{relationAnalysis}:{})};
  }catch(error){result={status:'LOCAL_RESTORE_FAILED',failedStage:stage,...classifyFailure(error),mismatchFields:[]};}
  // Cleanup failures are reported separately; never replace the primary result.
  let cleanup='ok';
  if(clusterTouched) {
    if(started) {
      try{await progress('server-stop');await runNative(path.join(pgBin,'pg_ctl'),['-D',cluster,'-m','immediate','-w','stop'],env);}catch{cleanup='failed';}
    }else{
      // pg_ctl may have started a postmaster before reporting failure.
      try{await runNative(path.join(pgBin,'pg_ctl'),['-D',cluster,'-m','immediate','-w','stop'],env);}catch{
        try{await lstat(path.join(cluster,'postmaster.pid'));cleanup='failed';}catch(error){if(error.code!=='ENOENT')cleanup='failed';}
      }
    }
    if(cleanup==='ok')try{await progress('cleanup');await rm(cluster,{recursive:true,force:true});await rm(socket,{recursive:true,force:true});await rm(log,{force:true});}catch{cleanup='failed';}
  }
  try{await journal?.close();}catch{cleanup='failed';}return {...result,cleanup};
}
