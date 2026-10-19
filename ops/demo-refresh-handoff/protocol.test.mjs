import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, chmod, readdir, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { APPROVAL,TARGET,digest,hashBytes,validateWriterResponse,writerEvidenceProvider,durableCreate,consumeClaim,validateDeployment } from './protocol.mjs';
import { compareRestoreProof,cleanEnvironment,command,remoteDumpEnvironment } from './backup.mjs';
import { outcomeFor,observedClient } from './driver.mjs';

const now=Date.parse('2026-10-18T20:00:00Z');
const manifest={releaseSha:'a'.repeat(40),manifestSha256:'b'.repeat(64)};
const request={formatVersion:1,attemptId:'attempt123',revisionId:'revision1',phase:'precommit',previewDigest:'c'.repeat(64),targetDigest:'d'.repeat(64),...manifest,approval:APPROVAL,target:TARGET,nonce:'e'.repeat(48),createdAt:new Date(now-1000).toISOString()};
const response=()=>({...request,requestDigest:digest(request),source:'actual-render-control-plane-ui',suspended:true,deployedReleaseSha:manifest.releaseSha,activeDeploy:false,sourceUrl:`https://dashboard.render.com/web/${TARGET.renderService}`,verifiedAt:new Date(now).toISOString()});
async function privateTemp(fn) {const directory=await mkdtemp(path.join(os.tmpdir(),'refresh-protocol-test-'));await chmod(directory,0o700);try{await fn(directory);}finally{await rm(directory,{recursive:true,force:true});}}

test('writer evidence binds every phase, nonce, scope and release, and is at most 30 seconds old',()=>{
  assert.equal(validateWriterResponse(response(),request,now).targetDigest,request.targetDigest);
  for(const change of [{nonce:'other'},{phase:'initial'},{approval:'other'},{target:{...TARGET,branch:'other'}},{source:'claimed-user-phrase'},{suspended:false},{activeDeploy:true},{releaseSha:'f'.repeat(40)},{deployedReleaseSha:'f'.repeat(40)},{requestDigest:'f'.repeat(64)},{sourceUrl:'https://example.invalid'},{verifiedAt:new Date(now-31_000).toISOString()},{verifiedAt:new Date(now+1).toISOString()},{verifiedAt:new Date(now-1001).toISOString()}])assert.throws(()=>validateWriterResponse({...response(),...change},request,now));
});
test('fresh handshake consumes each phase once and leaves immutable evidence',()=>privateTemp(async directory=>{
  let clock=now,responded=false;
  const provider=writerEvidenceProvider({directory,attemptId:'attempt123',revisionId:'revision1',manifestSha256:manifest.manifestSha256,now:()=>clock,pause:async()=>{
    clock+=5;const name=(await readdir(directory)).find(name=>name.endsWith('.request.json'));
    const req=JSON.parse(await readFile(path.join(directory,name)));
    assert.equal(responded,false);responded=true;
    await durableCreate(path.join(directory,name.replace('.request.','.response.')),{...response(),...req,requestDigest:digest(req),verifiedAt:new Date(clock).toISOString()});
  }});
  const args={phase:'precommit',previewDigest:request.previewDigest,targetDigest:request.targetDigest,releaseSha:manifest.releaseSha};
  assert.match((await provider(args)).evidenceDigest,/^[a-f0-9]{64}$/);
  await assert.rejects(provider(args));
  assert.equal((await readdir(directory)).filter(name=>name.endsWith('.consumed.json')).length,1);
}));
test('bounded handshake fails closed with no response and never replaces request',()=>privateTemp(async directory=>{
  let clock=now;
  const provider=writerEvidenceProvider({directory,attemptId:'attempt123',revisionId:'revision1',manifestSha256:manifest.manifestSha256,timeoutMs:50,now:()=>clock,pause:async ms=>{clock+=ms;}});
  await assert.rejects(provider({...request,phase:'initial'}),/TIMEOUT/);
  assert.equal((await readdir(directory)).length,1);
}));
test('attempt is private, exact-bound, exclusively consumed and never erased on failure',()=>privateTemp(async directory=>{
  const token='a'.repeat(64),claim={formatVersion:1,state:'claimed-no-retry',attemptId:'attempt123',revisionId:'revision1',...manifest,claimTokenDigest:hashBytes(token),target:TARGET,approval:APPROVAL};
  await durableCreate(path.join(directory,'attempt.json'),claim);
  assert.equal((await stat(path.join(directory,'attempt.json'))).mode&0o777,0o600);
  await assert.rejects(consumeClaim({directory,manifest,claimToken:'wrong',revisionId:'revision1'}));
  await consumeClaim({directory,manifest,claimToken:token,revisionId:'revision1'});
  await assert.rejects(consumeClaim({directory,manifest,claimToken:token,revisionId:'revision1'}));
  assert.deepEqual(JSON.parse(await readFile(path.join(directory,'attempt.json'))),claim);
}));
test('deployment gate requires current reviewed release and exact target',()=>{
  const gate={formatVersion:1,target:TARGET,approval:APPROVAL,...manifest,reviewed:true,deployed:true,deploymentUrl:`https://dashboard.render.com/web/${TARGET.renderService}/deploys/dep-test`,verifiedAt:new Date(now).toISOString()};
  validateDeployment(gate,manifest,now);
  for(const change of [{reviewed:false},{target:{...TARGET,host:'other'}},{manifestSha256:'c'.repeat(64)},{verifiedAt:new Date(now-31*60_000).toISOString()}])assert.throws(()=>validateDeployment({...gate,...change},manifest,now));
});
test('restore proof rejects same-count row, password, ledger, sequence, catalog and grant drift',()=>{
  const proof={schema:{catalog:['table'],grants:['select']},ledger:[8],rows:{users:{count:990,digest:'a'}},passwordDigest:'b',sequences:{id:984},settings:{version:'180006'},databaseGrants:['connect'],triggerStructure:[]};
  compareRestoreProof(proof,structuredClone(proof));
  for(const key of Object.keys(proof)){const changed=structuredClone(proof);changed[key]={drift:true};assert.throws(()=>compareRestoreProof(proof,changed));}
});
test('environment does not carry inherited credentials and native errors never echo details',async()=>{
  process.env.TEST_REFRESH_SECRET='FAKE_SECRET_SENTINEL';
  assert.equal(cleanEnvironment().TEST_REFRESH_SECRET,undefined);
  assert.equal(cleanEnvironment().PGPASSFILE,'/dev/null');
  const env=remoteDumpEnvironment('FAKE_SECRET_SENTINEL','/private/fixture');
  assert.equal(env.PGSSLCERTMODE,'disable');assert.equal(env.PGGSSENCMODE,'disable');assert.equal(env.PGREQUIREAUTH,'scram-sha-256');
  assert.equal(env.PGSSLKEY,'/private/fixture/absent-client-key');assert.equal(env.PGSSLMODE,'verify-full');
  await assert.rejects(command('/bin/sh',['-c','echo FAKE_SECRET_SENTINEL >&2; exit 2'],cleanEnvironment()),error=>error.message==='NATIVE_COMMAND_FAILED');
  delete process.env.TEST_REFRESH_SECRET;
});
test('lost COMMIT acknowledgement has a permanent uncertain outcome and no retry',async()=>{
  const state={applyStarted:true,commitSent:false,commitAcknowledged:false};let calls=0;
  const wrapped=observedClient({query:async()=>{calls++;throw new Error('FAKE_SECRET_SENTINEL');}},state,async()=>{});
  await assert.rejects(wrapped.query('COMMIT'));
  assert.equal(calls,1);assert.equal(outcomeFor(state),'REVISION_COMMIT_UNCONFIRMED');
  state.commitAcknowledged=true;assert.equal(outcomeFor(state),'REVISION_COMMITTED_FOLLOWUP_NOT_CONFIRMED');
});
