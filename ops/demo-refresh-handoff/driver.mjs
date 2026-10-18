// No application or dependency imports before frozen files are verified.
import { createHash } from 'node:crypto';
import { createReadStream, constants } from 'node:fs';
import { lstat, open, readFile, realpath } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const check=value=>{if(!value)throw new Error('FROZEN_HANDOFF_REJECTED');};
const sha=value=>createHash('sha256').update(value).digest('hex');
const exec=promisify(execFile);
async function checksum(file) {const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
export async function verifyFrozen(manifestPath,expectedHash) {
  const raw=await readFile(manifestPath);check(sha(raw)===expectedHash);
  const manifest=JSON.parse(raw);manifest.manifestSha256=expectedHash;
  check(manifest.formatVersion===1&&/^[a-f0-9]{40}$/.test(manifest.releaseSha)&&process.versions.node.startsWith('24.'));
  check(path.resolve(manifest.codeRoot,'ops/demo-refresh-handoff/driver.mjs')===fileURLToPath(import.meta.url));
  check(await realpath(process.execPath)===await realpath(manifest.node));
  for(const [name,expected] of Object.entries(manifest.files))check(await checksum(name)===expected);
  for(const [name,expected] of Object.entries(manifest.links))check(await realpath(name)===expected);
  const opts={cwd:manifest.codeRoot,env:{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'}};
  const head=await exec('/usr/bin/git',['rev-parse','HEAD'],opts),status=await exec('/usr/bin/git',['status','--porcelain','--untracked-files=all'],opts);
  check(head.stdout.trim()===manifest.releaseSha&&status.stdout==='');
  return manifest;
}
async function readInput() {
  let body='';for await(const chunk of process.stdin){body+=chunk;check(body.length<16_384);}
  const input=JSON.parse(body);body='';check(Object.keys(input).sort().join() === 'claimToken,password');
  check(typeof input.password==='string'&&input.password.length>0&&input.password.length<4096&&!input.password.includes('\0')&&/^[a-f0-9]{64}$/.test(input.claimToken));return input;
}
export function outcomeFor(state) {
  return state.commitAcknowledged?'REVISION_COMMITTED_FOLLOWUP_NOT_CONFIRMED':state.commitSent?'REVISION_COMMIT_UNCONFIRMED':state.applyStarted?'REVISION_NOT_COMMITTED_RECHECK_SOURCE':'STOPPED_BEFORE_REVISION';
}
export function observedClient(client,state,audit,beforeCommit=async()=>{}) {
  return {async query(sql,params) {
    if(sql==='COMMIT') {await beforeCommit();await audit('COMMIT_SUBMISSION_STARTING');state.commitSent=true;const result=await client.query(sql,params);state.commitAcknowledged=true;return result;}
    return client.query(sql,params);
  }};
}
export async function confirmCommittedReadOnly({observer,expectedTarget,receipt,expectedProof,readBaseline,noOtherClients,same}) {
  try {
    await observer.connect();await observer.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await observer.query("SET LOCAL search_path TO public,pg_catalog; SET LOCAL timezone='UTC'");
    const target=(await observer.query('SELECT current_database() AS database,current_user AS user,inet_server_addr()::text AS "serverAddress",inet_server_port() AS "serverPort"')).rows[0];
    check(same(target,expectedTarget));await noOtherClients(observer);
    const proof=await readBaseline({client:observer,receipt});check(same(proof,expectedProof));
    await observer.query('ROLLBACK');return proof;
  }finally{await observer.end();}
}
async function main() {
  check(process.argv.length===5&&['--preflight','--execute'].includes(process.argv[2]));
  const manifest=await verifyFrozen(process.argv[3],process.argv[4]);
  const protocol=await import('./protocol.mjs');
  const {TARGET,APPROVAL,RECEIPT_SHA256,requireThat,durableCreate,privateRead,validateDeployment,writerEvidenceProvider,consumeClaim}=protocol;
  requireThat(protocol.same(manifest.target,TARGET)&&manifest.approval===APPROVAL&&manifest.receiptSha256===RECEIPT_SHA256);
  requireThat(await checksum(manifest.receiptPath)===RECEIPT_SHA256);
  validateDeployment(JSON.parse(await privateRead(path.join(manifest.directory,'release-gate.json'))),manifest);
  for(const basename of ['absent-client-certificate','absent-client-key','absent-revocation-list']) {
    try{await lstat(path.join(manifest.directory,basename));throw new Error('UNEXPECTED_CREDENTIAL_FILE');}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  const {reviseSyntheticClassroom,readSyntheticRevisionBaseline}=await import('../revise-synthetic-classroom.mjs');
  const {REVISION_ID}=await import('../demo-refresh-plan.mjs');
  const {Client}=await import('../classroom-snapshot.mjs');
  const {backupAndRestore,remoteDumpEnvironment,noOtherClients}=await import('./backup.mjs');
  requireThat(manifest.revisionId===REVISION_ID);
  if(process.argv[2]==='--preflight') {
    try {await lstat(path.join(manifest.directory,'attempt.json'));throw new Error('ATTEMPT_ALREADY_CLAIMED');}catch(error){if(error.code!=='ENOENT')throw error;}
    return;
  }
  const input=await readInput();
  const claim=await consumeClaim({directory:manifest.directory,manifest,claimToken:input.claimToken,revisionId:REVISION_ID});input.claimToken=undefined;
  const state={applyStarted:false,commitSent:false,commitAcknowledged:false};
  let client,outcome;
  const audit=async status=>durableCreate(path.join(manifest.directory,`audit-${status}.json`),{status,attemptId:claim.attemptId,releaseSha:manifest.releaseSha,at:new Date().toISOString()});
  try {
    // Only this deliberate env contains the user-supplied password. It is passed
    // to pg_dump, never argv/disk/logs, and no inherited environment is forwarded.
    const env=remoteDumpEnvironment(input.password,manifest.directory);
    const connection={host:TARGET.host,port:TARGET.port,database:TARGET.database,user:TARGET.user,password:input.password,ssl:{rejectUnauthorized:true,ca:await readFile('/private/etc/ssl/cert.pem')},connectionTimeoutMillis:15_000,query_timeout:90_000,application_name:'mentor-refresh-user-handoff'};
    client=new Client(connection);
    client.connectionParameters.options='';client.connectionParameters.replication=undefined;client.on('error',()=>{});input.password=undefined;
    await client.connect();
    await client.query("SET timezone TO 'UTC'");
    const target=(await client.query('SELECT current_database() AS database,current_user AS user,inet_server_addr()::text AS "serverAddress",inet_server_port() AS "serverPort"')).rows[0];
    requireThat(target.database===TARGET.database&&target.user===TARGET.user&&target.serverPort===TARGET.port&&typeof target.serverAddress==='string');
    await noOtherClients(client);
    const receipt=JSON.parse(await privateRead(manifest.receiptPath));
    const common={client,receipt,expectedTarget:target,releaseSha:manifest.releaseSha};
    const preview=await reviseSyntheticClassroom(common);
    // Contains only approved synthetic content, IDs and hashes, never real rows.
    await durableCreate(path.join(manifest.directory,'revision-preview.json'),preview);
    const evidenceProvider=writerEvidenceProvider({directory:manifest.directory,attemptId:claim.attemptId,revisionId:REVISION_ID,manifestSha256:manifest.manifestSha256,status:value=>process.stdout.write(value+'\n')});
    let latestWriters,commitProof;
    const refreshWriterEvidence=async args=>{latestWriters=await evidenceProvider(args);return latestWriters;};
    const writers=await refreshWriterEvidence({phase:'initial',previewDigest:preview.previewDigest,targetDigest:preview.evidence.targetDigest,releaseSha:manifest.releaseSha});
    const backup=await backupAndRestore({client,connectionEnv:env,receipt,preview,manifest});env.PGPASSWORD=undefined;
    process.stdout.write('BACKUP_RESTORE_VERIFIED\n');
    await audit('BACKUP_RESTORE_VERIFIED');
    // Recheck all pinned files and deployment evidence immediately before apply.
    await verifyFrozen(process.argv[3],process.argv[4]);
    validateDeployment(JSON.parse(await privateRead(path.join(manifest.directory,'release-gate.json'))),manifest);
    const current=await reviseSyntheticClassroom(common);requireThat(current.previewDigest===preview.previewDigest);
    state.applyStarted=true;
    const applied=await reviseSyntheticClassroom({...common,client:observedClient(client,state,audit,async()=>{
      commitProof=await readSyntheticRevisionBaseline({client,receipt});
      await noOtherClients(client);
      requireThat(Date.now()-Date.parse(latestWriters.verifiedAt)<=30_000);
    }),apply:true,expectedPreviewDigest:preview.previewDigest,prerequisites:{...preview.evidence,...backup,writers},claim:{revisionId:REVISION_ID,attemptId:claim.attemptId,previewDigest:preview.previewDigest,releaseSha:manifest.releaseSha,state:'claimed'},refreshWriterEvidence});
    await durableCreate(path.join(manifest.directory,'revision-receipt.json'),applied);
    // The writer connection is closed before a fresh read-only connection checks
    // all rows, schema, role authority, and sequences against the commit proof.
    await client.end();client=undefined;
    const observer=new Client({...connection,options:'-c default_transaction_read_only=on',application_name:'mentor-refresh-read-only-confirmation'});observer.on('error',()=>{});
    try {
      const after=await confirmCommittedReadOnly({observer,expectedTarget:target,receipt,expectedProof:commitProof,readBaseline:readSyntheticRevisionBaseline,noOtherClients,same:protocol.same});
      await durableCreate(path.join(manifest.directory,'postcommit-read-only-proof.json'),{attemptId:claim.attemptId,releaseSha:manifest.releaseSha,previewDigest:preview.previewDigest,verifiedAt:new Date().toISOString(),proof:after});
    } finally {connection.password=undefined;}
    await audit('REVISION_COMMITTED');outcome='REVISION_COMMITTED';
  } catch {outcome=outcomeFor(state);await audit(outcome).catch(()=>{});}
  finally {try{await client?.end();}catch{outcome=outcomeFor(state);}}
  process.stdout.write(outcome+'\n');if(outcome!=='REVISION_COMMITTED')process.exitCode=1;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().catch(()=>{process.stdout.write('STOPPED_BEFORE_REVISION\n');process.exitCode=1;});
