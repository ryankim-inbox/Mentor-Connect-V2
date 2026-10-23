// All relations, grants, data and archives in this file are generated fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,chmod,rm,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {spawnSync,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {localCluster,fullRowProof} from '../demo-refresh-handoff/backup.mjs';
import {readRevisionSchemaState} from '../synthetic-revision-evidence.mjs';
import {runNative,compareProofs,cleanEnvironment} from './diagnostic.mjs';
import * as diagnostic from './diagnostic.mjs';
import {verifySchemaAssets} from '../../lib/db/tools/schema-assets.mjs';
import {runMigrationTransaction} from '../../lib/db/tools/migration-runner.mjs';
import {historicalSchemaFixture} from '../../lib/db/test/historical-schema-fixture.mjs';

const integration=process.env.RUN_LOCAL_RESTORE_DIAGNOSTIC_TEST==='1'?test:test.skip;
const pgBin='/opt/homebrew/opt/postgresql@18/bin';
const python='/Users/rinny/Library/Application Support/uv/python/cpython-3.12.13-macos-aarch64-none/bin/python3.12';
const effectiveAcl=`SELECT c.relname,array_to_json(coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 's' ELSE 'r' END::"char",c.relowner))) AS acl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname`;

integration('pg_dump restores explicit default table/sequence ACLs as NULL while retaining every privilege',async()=>{
  const cluster=await localCluster({pgBin});
  const directory=await mkdtemp('/private/tmp/restore-relations-fixture-');await chmod(directory,0o700);
  let source,restored;
  try{
    const admin=cluster.client('postgres');await admin.connect();
    try{
      await admin.query('CREATE ROLE neondb_owner LOGIN; CREATE ROLE fixture_app NOLOGIN');
      for(const db of ['neondb','restored_fixture'])await admin.query(`CREATE DATABASE ${db} TEMPLATE template0 OWNER neondb_owner ENCODING 'UTF8' LOCALE_PROVIDER builtin LOCALE 'C.UTF-8' BUILTIN_LOCALE 'C.UTF-8'`);
    }finally{await admin.end();}
    source=cluster.client('neondb','neondb_owner');await source.connect();
    await source.query('CREATE TABLE public.fixture_table(id integer); CREATE SEQUENCE public.fixture_sequence_a; CREATE SEQUENCE public.fixture_sequence_b');
    await source.query('REVOKE ALL ON TABLE public.fixture_table FROM fixture_app; REVOKE ALL ON SEQUENCE public.fixture_sequence_a,public.fixture_sequence_b FROM fixture_app');
    const before=(await readRevisionSchemaState(source)).relations;
    assert.equal(before.length,3);assert.ok(before.every(row=>row.relacl!==null));
    const beforeEffective=(await source.query(effectiveAcl)).rows;
    const dump=path.join(directory,'fake.dump');await writeFile(dump,'',{mode:0o600});
    await runNative(pgBin+'/pg_dump',['--no-password','--format=custom','--file',dump],{...cluster.env,PGDATABASE:'neondb',PGUSER:'neondb_owner'});
    await runNative(pgBin+'/pg_restore',['--no-password','--exit-on-error','--single-transaction','--dbname','restored_fixture',dump],cluster.env);
    restored=cluster.client('restored_fixture','neondb_owner');await restored.connect();
    const after=(await readRevisionSchemaState(restored)).relations;
    assert.ok(after.every(row=>row.relacl===null));
    assert.deepEqual(before.map(({relacl,...row})=>row),after.map(({relacl,...row})=>row));
    assert.deepEqual((await restored.query(effectiveAcl)).rows,beforeEffective);
    assert.deepEqual(compareProofs({schema:{relations:before}},{schema:{relations:after}}),['schema.relations']);
    assert.deepEqual((await readRevisionSchemaState(source)).relations,before);
    // A strict mismatch must remain a failure, while a separate safe report
    // distinguishes proven equivalent defaults from real privilege changes.
    assert.equal(typeof diagnostic.analyzeRelationDifferences,'function');
    const portableBefore=before.map(row=>({...row,relacl:beforeEffective.find(item=>item.relname===row.relname).acl}));
    const detail=await diagnostic.analyzeRelationDifferences(restored,portableBefore,after);
    assert.deepEqual(detail,{status:'complete',sourceCount:3,restoredCount:3,missingCount:0,addedCount:0,changedCount:3,changedFields:['relacl'],orderChanged:false,aclDefaultEquivalentCount:3,aclEncodingEquivalentCount:0,aclPrivilegeDifferenceCount:0,aclUnclassifiedCount:0,sourceExplicitToNullCount:3,sourceNullToExplicitCount:0});
    assert.deepEqual(compareProofs({schema:{relations:portableBefore}},{schema:{relations:after}}),['schema.relations']);
    await restored.query('GRANT SELECT ON public.fixture_table TO fixture_app');
    const altered=(await readRevisionSchemaState(restored)).relations;
    const aclRows=(await restored.query("SELECT relname,array_to_json(relacl) AS acl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'")).rows;
    const portableAltered=altered.map(row=>({...row,relacl:aclRows.find(item=>item.relname===row.relname).acl}));
    const realDifference=await diagnostic.analyzeRelationDifferences(restored,portableBefore,portableAltered);
    assert.equal(realDifference.aclDefaultEquivalentCount,2);assert.equal(realDifference.aclPrivilegeDifferenceCount,1);
    const emptyAcl=structuredClone(portableBefore);emptyAcl[0].relacl=[];
    const emptyDifference=await diagnostic.analyzeRelationDifferences(restored,portableBefore,emptyAcl);
    assert.equal(emptyDifference.aclPrivilegeDifferenceCount,1);assert.equal(emptyDifference.aclDefaultEquivalentCount,0);
    const withGrant=structuredClone(portableBefore),tableIndex=withGrant.findIndex(row=>row.relkind==='r');
    withGrant[tableIndex].relacl.push('fixture_app=r/neondb_owner');
    for(const alteredGrant of ['fixture_app=r*/neondb_owner','fixture_app=r/fixture_app']){
      const changed=structuredClone(withGrant);changed[tableIndex].relacl[1]=alteredGrant;
      const analysis=await diagnostic.analyzeRelationDifferences(restored,withGrant,changed);
      assert.equal(analysis.aclPrivilegeDifferenceCount,1);assert.equal(analysis.aclDefaultEquivalentCount,0);
    }
    const encodingA=structuredClone(withGrant),encodingB=structuredClone(withGrant);
    encodingA[tableIndex].relacl[1]='fixture_app=rw/neondb_owner';encodingB[tableIndex].relacl[1]='fixture_app=wr/neondb_owner';
    assert.equal((await diagnostic.analyzeRelationDifferences(restored,encodingA,encodingB)).aclEncodingEquivalentCount,1);
    const invalidAcl=structuredClone(portableBefore);invalidAcl[0].relacl=['INVALID_FIXTURE_ACL_CANARY'];
    await restored.query('BEGIN READ ONLY');
    assert.deepEqual(await diagnostic.analyzeRelationDifferences(restored,invalidAcl,after),{status:'unavailable'});
    await restored.query('ROLLBACK');
    assert.deepEqual(compareProofs({schema:{relations:invalidAcl}},{schema:{relations:after}}),['schema.relations']);
    assert.equal((await restored.query('SELECT true AS usable')).rows[0].usable,true);
  }finally{await source?.end();await restored?.end();await cluster.close();await rm(directory,{recursive:true,force:true});}
});

integration('full frozen wrapper accepts only semantically identical default ACLs and keeps source proof unchanged',async(t)=>{
  const fixture=await historicalSchemaFixture('0008');
  t.after(fixture.close);
  const root=fixture.rootDir;
  const cluster=await localCluster({pgBin});
  const directory=await mkdtemp('/private/tmp/restore-relation-report-fixture-');await chmod(directory,0o700);
  const output='/private/tmp/mentor-restore-diagnostic-run-relations-test-'+path.basename(directory).split('-').at(-1).toLowerCase();
  let source;
  try{
    const admin=cluster.client('postgres');await admin.connect();
    try{
      await admin.query('CREATE ROLE neondb_owner LOGIN; CREATE ROLE fixture_app NOLOGIN');
      await admin.query("CREATE DATABASE neondb TEMPLATE template0 OWNER neondb_owner ENCODING 'UTF8' LOCALE_PROVIDER builtin LOCALE 'C.UTF-8' BUILTIN_LOCALE 'C.UTF-8'");
    }finally{await admin.end();}
    source=cluster.client('neondb','neondb_owner');await source.connect();await source.query("SET timezone='UTC'");
    const assets=await verifySchemaAssets({rootDir:root});await runMigrationTransaction({client:source,ledger:assets.ledger,appSha:'a'.repeat(40)});
    await source.query('REVOKE ALL ON TABLE public.mentor_connect_schema_migrations FROM fixture_app; REVOKE ALL ON SEQUENCE public.users_id_seq,public.requests_id_seq FROM fixture_app');
    const proof=await fullRowProof(source,assets);
    const input=path.join(directory,'input');await mkdir(input,{mode:0o700});
    const dump=path.join(input,'fake.dump'),evidence=path.join(input,'evidence.json');await writeFile(dump,'',{mode:0o600});
    await runNative(pgBin+'/pg_dump',['--no-password','--format=custom','--file',dump],{...cluster.env,PGDATABASE:'neondb',PGUSER:'neondb_owner'});
    const checksum=createHash('sha256').update(await readFile(dump)).digest('hex');
    await writeFile(evidence,JSON.stringify({schemaVersion:'0008',sha256:checksum,proof}),{mode:0o600});
    const built=spawnSync(python,['-I','-B',path.join(root,'ops/restore-diagnostic/build_bundle.py'),'--bundle',path.join(directory,'bundle'),'--output',output,'--dump',dump,'--evidence',evidence],{encoding:'utf8',env:cleanEnvironment()});
    assert.equal(built.status,0,built.stdout);const frozen=JSON.parse(built.stdout);
    const launched=spawnSync('/usr/bin/env',['-i','/bin/sh',frozen.wrapper],{encoding:'utf8'});
    assert.equal(launched.status,0,launched.stdout);assert.equal(launched.stderr,'');
    const result=JSON.parse(launched.stdout.split('\n').find(line=>line.startsWith('{')));
    assert.equal(result.status,'LOCAL_RESTORE_MATCH');assert.deepEqual(result.mismatchFields,[]);
    assert.equal(result.cleanup,'ok');assert.equal(result.reportWrite,'saved');
    assert.ok(launched.stdout.includes('LOCAL_DIAGNOSTIC_WRAPPER_EXIT=0'));
    const saved=JSON.parse(await readFile(path.join(output,'supervisor-result.json'),'utf8'));
    assert.deepEqual(saved,{result,exitCode:0});assert.equal(launched.stdout.includes('neondb_owner'),false);
    assert.deepEqual(await fullRowProof(source,assets),proof);
  }finally{
    await source?.end();await cluster.close();await rm(output,{recursive:true,force:true});
    execFileSync('/bin/chmod',['-R','u+w',directory]);await rm(directory,{recursive:true,force:true});
  }
});
