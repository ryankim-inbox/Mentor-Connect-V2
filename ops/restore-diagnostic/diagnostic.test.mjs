import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, chmod, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { classifyFailure, classifyNativeLine, compareProofs, analyzeRelationDifferences, runDiagnostic, runNative, cleanEnvironment } from './diagnostic.mjs';

const relation=(name,extra={})=>({relname:name,relkind:'r',owner:'fixture_owner',relacl:null,reloptions:null,relrowsecurity:false,relforcerowsecurity:false,...extra});
test('relation diagnostics distinguish ordering, identity and structural changes without emitting identifiers',async()=>{
  const client={query:()=>{throw new Error('unexpected SQL');}};
  const source=[relation('fixture_a'),relation('fixture_b')];
  const order=await analyzeRelationDifferences(client,source,[source[1],source[0]]);
  assert.equal(order.status,'complete');assert.equal(order.orderChanged,true);assert.equal(order.changedCount,0);assert.deepEqual(order.changedFields,[]);
  const changed=[relation('fixture_a',{owner:canary,relrowsecurity:true,reloptions:['fillfactor=70']}),relation(canary)];
  const detail=await analyzeRelationDifferences(client,source,changed);
  assert.equal(detail.status,'complete');assert.equal(detail.changedCount,1);assert.equal(detail.missingCount,1);assert.equal(detail.addedCount,1);
  assert.deepEqual(detail.changedFields,['owner','relname','reloptions','relrowsecurity']);assert.equal(JSON.stringify(detail).includes(canary),false);
  assert.deepEqual(compareProofs({schema:{relations:source}},{schema:{relations:changed}}),['schema.relations']);
});
test('relation ACLs with changed owner or kind remain unclassified and never gain a match',async()=>{
  const client={query:()=>{throw new Error('must not compare ACLs under a different owner or kind');}};
  for(const extra of [{owner:'other_owner'},{relkind:'S'}]){
    const source=[relation('fixture_a',{relacl:['fixture_owner=arwdDxtm/fixture_owner']})],restored=[relation('fixture_a',extra)];
    const detail=await analyzeRelationDifferences(client,source,restored);
    assert.equal(detail.aclUnclassifiedCount,1);assert.equal(detail.aclDefaultEquivalentCount,0);
    assert.deepEqual(compareProofs({schema:{relations:source}},{schema:{relations:restored}}),['schema.relations']);
  }
});
test('relation detail shape errors and SQL failures expose no raw values and keep strict mismatch',async()=>{
  const client={query:()=>{throw Object.assign(new Error(canary),{detail:canary});}};
  const source=[relation('fixture_a',{relacl:['fixture_owner=arwdDxtm/fixture_owner']})],restored=[relation('fixture_a')];
  assert.deepEqual(await analyzeRelationDifferences(client,source,restored),{status:'unavailable'});
  for(const malformed of [[{...source[0],unknown:canary}],[source[0],source[0]],[{...source[0],relacl:canary}]])assert.deepEqual(await analyzeRelationDifferences(client,malformed,restored),{status:'unavailable'});
  assert.deepEqual(compareProofs({schema:{relations:source}},{schema:{relations:restored}}),['schema.relations']);
});

const canary='PRIVATE_FAKE_PASSWORD_HASH_AND_ROW_CANARY';
test('failure reports discard raw error values and retain only allowlisted SQLSTATE',()=>{
  assert.deepEqual(classifyFailure({message:canary,stack:canary,detail:canary,code:'42501'}),{category:'SQL_PERMISSION_DENIED',sqlstate:'42501'});
  assert.deepEqual(classifyFailure({message:canary,code:canary}),{category:'LOCAL_OPERATION_FAILED'});
  assert.equal(JSON.stringify(classifyFailure({message:canary,stack:canary})).includes(canary),false);
});
test('native error classification does not emit SQL, identifiers or data',()=>{
  assert.equal(classifyNativeLine(`pg_restore: error: could not execute query: ERROR: permission denied for table ${canary}`),'NATIVE_PERMISSION_DENIED');
  assert.equal(classifyNativeLine(`ERROR: role "${canary}" does not exist`),'NATIVE_ROLE_MISSING');
  assert.equal(classifyNativeLine(`ERROR: unrecognized configuration parameter "${canary}"`),'NATIVE_UNKNOWN_SETTING');
  assert.equal(classifyNativeLine(canary),null);
});
test('a real failed native child returns a safe category without its stderr canary',async()=>{
  await assert.rejects(runNative(process.execPath,['-e',`process.stderr.write('ERROR: permission denied for table ${canary}\\n');process.exit(1);`],cleanEnvironment()),error=>error.message==='NATIVE_PERMISSION_DENIED'&&!String(error.stack).includes(canary));
});
test('a hung native child is bounded and classified as timeout',async()=>{
  await assert.rejects(runNative(process.execPath,['-e','setInterval(()=>{},1000)'],cleanEnvironment(),{timeoutMs:25}),/NATIVE_TIMEOUT/);
});
test('proof differences contain fixed field names and never values',()=>{
  const a={schema:{catalog:{},grants:[],triggers:[]},ledger:[],rows:{},passwordDigest:'a',sequences:{},settings:{},databaseGrants:[],triggerStructure:[]};
  const b=structuredClone(a);b.schema.grants=[{secret:canary}];b.passwordDigest=canary;
  assert.deepEqual(compareProofs(a,b),['schema.grants','passwordDigest']);
  const c=structuredClone(a);c.schema[canary]=[];
  assert.throws(()=>compareProofs(c,a),/PROOF_SHAPE_REJECTED/);
});
test('an invalid archive checksum stops before cluster creation and preserves inputs',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'restore-diagnostic-unit-'));await chmod(root,0o700);
  const input=path.join(root,'input');const work=path.join(root,'work');
  const {mkdir}=await import('node:fs/promises');await mkdir(input,{mode:0o700});await mkdir(work,{mode:0o700});
  const dump=path.join(input,'fake.dump'),evidence=path.join(input,'evidence.json');
  await writeFile(dump,canary,{mode:0o600});
  await writeFile(evidence,JSON.stringify({schemaVersion:'0008',sha256:'0'.repeat(64),proof:{}}),{mode:0o600});
  try {
    const result=await runDiagnostic({dumpPath:dump,evidencePath:evidence,expectedDumpSha256:'0'.repeat(64),expectedEvidenceSha256:null,workDirectory:work,pgBin:'/unusable',assetsRoot:'/unusable'});
    assert.equal(result.status,'LOCAL_RESTORE_FAILED');assert.equal(result.failedStage,'input-verification');assert.equal(result.category,'ARCHIVE_CHECKSUM_MISMATCH');
    assert.equal(await readFile(dump,'utf8'),canary);
    assert.equal(JSON.stringify(result).includes(canary),false);
  }finally{await rm(root,{recursive:true,force:true});}
});
