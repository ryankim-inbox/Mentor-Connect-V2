import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,chmod,readFile,writeFile,rm,cp,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {localCluster,fullRowProof} from '../demo-refresh-handoff/backup.mjs';
import {runMigrationTransaction} from '../../lib/db/tools/migration-runner.mjs';
import {verifySchemaAssets} from '../../lib/db/tools/schema-assets.mjs';
import {runDiagnostic,runNative} from './diagnostic.mjs';
import {historicalSchemaFixture} from '../../lib/db/test/historical-schema-fixture.mjs';

const integration=process.env.RUN_LOCAL_RESTORE_DIAGNOSTIC_TEST==='1'?test:test.skip;
const pgBin='/opt/homebrew/opt/postgresql@18/bin';
const python='/Users/rinny/Library/Application Support/uv/python/cpython-3.12.13-macos-aarch64-none/bin/python3.12';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const canary='FAKE_PRIVATE_CONTENT_MUST_NEVER_APPEAR_IN_DIAGNOSTIC_OUTPUT';

integration('actual local restore detects membership-only grant view differences and keeps source untouched',async(t)=>{
  const fixture=await historicalSchemaFixture('0008');
  t.after(fixture.close);
  const root=fixture.rootDir;
  const cluster=await localCluster({pgBin});
  const directory=await mkdtemp('/private/tmp/restore-diagnostic-fixture-');await chmod(directory,0o700);
  let client;
  try{
    const admin=cluster.client('postgres');await admin.connect();
    try{
      for(const role of ['neondb_owner','third_party','mentor_connect_app','mentor_connect_readiness'])await admin.query(`CREATE ROLE ${role} LOGIN`);
      await admin.query("CREATE DATABASE neondb TEMPLATE template0 OWNER neondb_owner ENCODING 'UTF8' LOCALE_PROVIDER builtin LOCALE 'C.UTF-8' BUILTIN_LOCALE 'C.UTF-8'");
    }finally{await admin.end();}
    client=cluster.client('neondb','neondb_owner');await client.connect();await client.query("SET timezone='UTC'");
    const assets=await verifySchemaAssets({rootDir:root});await runMigrationTransaction({client,ledger:assets.ledger,appSha:'a'.repeat(40)});
    await client.query(await readFile(path.join(root,'database/fixtures/classroom.sql'),'utf8'));
    await client.query("INSERT INTO users(email,name,password_hash,role,district_id) VALUES ('fake@fixture.invalid',$1,$1,'mentor',1)",[canary]);
    await client.query('GRANT SELECT ON public.users TO third_party; GRANT UPDATE(name) ON public.users TO mentor_connect_app; GRANT USAGE ON SCHEMA public TO mentor_connect_readiness; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO third_party');
    for(const membership of [false,true]){
      if(membership){const admin=cluster.client('postgres');await admin.connect();try{await admin.query('GRANT neondb_owner TO third_party');}finally{await admin.end();}}
      const before=await fullRowProof(client,assets);
      const input=path.join(directory,membership?'member':'control');await mkdir(input,{mode:0o700});
      const dump=path.join(input,'fake.dump'),evidence=path.join(input,'evidence.json');
      await writeFile(dump,'',{mode:0o600});
      await runNative(pgBin+'/pg_dump',['--no-password','--format=custom','--file',dump],{...cluster.env,PGDATABASE:'neondb',PGUSER:'neondb_owner'});
      const dumpBefore=await readFile(dump);const sha=hash(dumpBefore);
      const evidenceBytes=JSON.stringify({schemaVersion:'0008',sha256:sha,proof:before});await writeFile(evidence,evidenceBytes,{mode:0o600});
      const work=path.join(directory,membership?'member-work':'control-work');await mkdir(work,{mode:0o700});
      const result=await runDiagnostic({dumpPath:dump,evidencePath:evidence,expectedDumpSha256:sha,expectedEvidenceSha256:hash(evidenceBytes),workDirectory:work,pgBin,assetsRoot:root});
      assert.equal(result.status,membership?'LOCAL_RESTORE_DIFFERENCE':'LOCAL_RESTORE_MATCH',JSON.stringify(result));
      assert.deepEqual(result.mismatchFields,membership?['schema.grants']:[]);
      assert.equal(result.cleanup,'ok');assert.equal(JSON.stringify(result).includes(canary),false);
      assert.deepEqual(await fullRowProof(client,assets),before);assert.deepEqual(await readFile(dump),dumpBefore);assert.equal(await readFile(evidence,'utf8'),evidenceBytes);
      if(!membership){
        const bundle=path.join(directory,'bundle');const output='/private/tmp/mentor-restore-diagnostic-run-test-'+path.basename(directory).split('-').at(-1).toLowerCase();
        const built=spawnSync(python,['-I','-B',path.join(root,'ops/restore-diagnostic/build_bundle.py'),'--bundle',bundle,'--output',output,'--dump',dump,'--evidence',evidence],{encoding:'utf8'});
        assert.equal(built.status,0,built.stdout);const frozen=JSON.parse(built.stdout);
        const args=['-I','-B',path.join(bundle,'launcher.py'),'--manifest',frozen.manifest,'--manifest-sha256',frozen.manifestSha256];
        try{
          const check=spawnSync(python,[...args,'--check'],{encoding:'utf8',env:{PRIVATE_CANARY:canary,NODE_OPTIONS:'--invalid-option',PGPASSWORD:canary}});assert.equal(check.status,0,check.stdout);
          await chmod(path.join(bundle,'assets'),0o700);await writeFile(path.join(bundle,'assets/manifest.json'),'{}',{mode:0o400});await chmod(path.join(bundle,'assets'),0o500);
          const unpinned=spawnSync(python,[...args,'--check'],{encoding:'utf8'});assert.notEqual(unpinned.status,0);
          await chmod(path.join(bundle,'assets'),0o700);await rm(path.join(bundle,'assets/manifest.json'));await chmod(path.join(bundle,'assets'),0o500);
          const launched=spawnSync('/usr/bin/env',['-i','/bin/sh',frozen.wrapper],{encoding:'utf8',env:{PRIVATE_CANARY:canary,NODE_OPTIONS:'--invalid-option',PGPASSWORD:canary}});
          assert.equal(launched.status,0,launched.stdout);assert.equal(launched.stderr,'');
          const lines=launched.stdout.trim().split('\n');
          assert.equal(lines[0],'LOCAL_DIAGNOSTIC_WRAPPER_STARTED');assert.ok(lines.includes('LOCAL_DIAGNOSTIC_STARTED'));assert.ok(lines.includes('LOCAL_DIAGNOSTIC_STAGE=archive-restore'));assert.equal(lines.at(-1),'LOCAL_DIAGNOSTIC_WRAPPER_EXIT=0');
          const safe=JSON.parse(lines.find(line=>line.startsWith('{')));assert.equal(safe.status,'LOCAL_RESTORE_MATCH');assert.equal(safe.cleanup,'ok');assert.equal(launched.stdout.includes(canary),false);
          const again=spawnSync('/usr/bin/env',['-i','/bin/sh',frozen.wrapper],{encoding:'utf8'});assert.notEqual(again.status,0);assert.ok(again.stdout.includes('LOCAL_DIAGNOSTIC_STOPPED_NO_REMOTE_ACCESS'));assert.equal(again.stdout.trim().split('\n').at(-1),'LOCAL_DIAGNOSTIC_WRAPPER_EXIT=2');
        }finally{await rm(output,{recursive:true,force:true});}

        if(process.env.RUN_HISTORICAL_DIAGNOSTIC_ENTRY_TEST==='1') {
        // Optional historical reproduction; normal native tests are standalone.
        // Re-run the EXACT saved v1 command structure and public frozen code,
        // substituting only isolated fake input bindings. No real dump is read.
        const originalBundle='/private/tmp/mentor-restore-diagnostic-bundle-45741cce-v1';
        const copiedBundle=path.join(directory,'exact-v1-bundle');await cp(originalBundle,copiedBundle,{recursive:true});
        const {execFileSync}=await import('node:child_process');execFileSync('/bin/chmod',['-R','u+w',copiedBundle]);
        const copiedManifestPath=path.join(copiedBundle,'manifest.json');const copiedManifest=JSON.parse(await readFile(copiedManifestPath));
        const exactOutput=output+'-exact-v1';copiedManifest.bundleRoot=copiedBundle;
        copiedManifest.bundleFiles=Object.fromEntries(Object.entries(copiedManifest.bundleFiles).map(([filename,digest])=>[filename.replace(originalBundle,copiedBundle),digest]));
        copiedManifest.config={...copiedManifest.config,dumpPath:dump,evidencePath:evidence,expectedDumpSha256:sha,expectedEvidenceSha256:hash(evidenceBytes),workDirectory:exactOutput,assetsRoot:path.join(copiedBundle,'assets')};
        assert.ok(copiedManifest.config.dumpPath.startsWith(directory+'/'));assert.ok(copiedManifest.config.evidencePath.startsWith(directory+'/'));
        await writeFile(copiedManifestPath,JSON.stringify(copiedManifest)+'\n');
        const seal=async directory=>{for(const entry of await readdir(directory,{withFileTypes:true})){const p=path.join(directory,entry.name);if(entry.isDirectory())await seal(p);else await chmod(p,0o400);}await chmod(directory,0o500);};await seal(copiedBundle);
        const exactCommand=(await readFile('/tmp/mentor-refresh-diagnostics-20261018/user-diagnostic-command-readable.txt','utf8')).replaceAll(originalBundle,copiedBundle).replaceAll('046f43aab1eee0c94a9ee5408f3270318461be8fb40295c175814ba5d6f2b464',hash(await readFile(copiedManifestPath)));
        try{
          const exact=spawnSync('/bin/sh',['-c',exactCommand],{encoding:'utf8'});assert.equal(exact.status,0,exact.stdout);assert.equal(exact.stderr,'');assert.equal(JSON.parse(exact.stdout).status,'LOCAL_RESTORE_MATCH');
        }finally{await rm(exactOutput,{recursive:true,force:true});}
        }
      }
    }
  }finally{await client?.end();await cluster.close();
    // Test-created immutable bundle only; never the real sealed handoff.
    const {execFileSync}=await import('node:child_process');execFileSync('/bin/chmod',['-R','u+w',directory]);await rm(directory,{recursive:true,force:true});}
});
