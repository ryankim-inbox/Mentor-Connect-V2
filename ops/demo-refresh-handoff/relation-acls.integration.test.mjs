import test from 'node:test';
import assert from 'node:assert/strict';
import {localCluster,compareRestoreProof} from './backup.mjs';
import {prepareRestoreComparison} from '../restore-relation-acls.mjs';
import {compareProofs} from '../restore-diagnostic/diagnostic.mjs';

const integration=process.env.RUN_REFRESH_BACKUP_LOCAL_TEST==='1'?test:test.skip;
const pgBin=process.env.TEST_REFRESH_PG_BIN??'/opt/homebrew/opt/postgresql@18/bin';
const relation=(name,kind='r',acl=null)=>({relname:name,relkind:kind,owner:'fixture_owner',relacl:acl,reloptions:null,relrowsecurity:false,relforcerowsecurity:false});
const proof=relations=>({schema:{relations,catalog:[],columns:[]},portableSchema:{relations,catalog:[],columns:[]},ledger:[8],rows:{users:{count:0,digest:'fake'}},passwordDigest:'fake',sequences:{},settings:{version:'180006'},databaseGrants:[],triggerStructure:[]});

integration('semantic relation comparison preserves complete grants, owners, shape, source proof and read-only boundaries',async()=>{
  const cluster=await localCluster({pgBin});let client;
  try{
    client=cluster.client('postgres');await client.connect();
    await client.query('CREATE ROLE fixture_owner; CREATE ROLE fixture_app; CREATE ROLE fixture_other; CREATE ROLE "PUBLIC"; CREATE ROLE "FixtureOwner"; CREATE ROLE fixtureowner');
    await client.query('BEGIN READ ONLY');
    // Use this server's complete defaults: PostgreSQL 16 lacks the later
    // MAINTAIN privilege. Production comparison still validates every tuple.
    const defaultTableAcl=async role=>(await client.query("SELECT acldefault('r',$1::regrole)::text[] AS acl",[role])).rows[0].acl;
    const ownerTableAcl=await defaultTableAcl('fixture_owner');
    const source=proof([relation('fixture_table','r',ownerTableAcl),relation('fixture_sequence','S',['fixture_owner=rwU/fixture_owner']),relation('fixture_index','i')]);
    const restored=proof([relation('fixture_table'),relation('fixture_sequence','S'),relation('fixture_index','i')]);
    const originalSource=structuredClone(source),originalRestored=structuredClone(restored);
    assert.throws(()=>compareRestoreProof(source,restored),/RESTORE_SCHEMA_MISMATCH_relations/);
    const a=await prepareRestoreComparison(client,source),b=await prepareRestoreComparison(client,restored);
    compareRestoreProof(a,b);assert.deepEqual(compareProofs(a,b),[]);
    assert.deepEqual(source,originalSource);assert.deepEqual(restored,originalRestored);
    assert.equal((await client.query('SHOW transaction_read_only')).rows[0].transaction_read_only,'on');
    const mutations=[
      rows=>{rows[0].owner='fixture_other';},rows=>{rows[0].relkind='S';},rows=>{rows[0].relname='renamed';},
      rows=>{rows[0].relrowsecurity=true;},rows=>{rows[0].relforcerowsecurity=true;},rows=>{rows[0].reloptions=['fillfactor=70'];},
      rows=>{rows[0].relacl=[];},rows=>{rows[0].relacl=['fixture_owner=r/fixture_owner'];},
      rows=>{rows[0].relacl=[...ownerTableAcl,'fixture_app=r/fixture_owner'];},
      rows=>{rows.pop();},rows=>{rows.push(relation('extra'));},rows=>{rows.reverse();},
    ];
    for(const mutate of mutations){
      const changed=structuredClone(restored);mutate(changed.portableSchema.relations);
      const canonical=await prepareRestoreComparison(client,changed);
      assert.throws(()=>compareRestoreProof(a,canonical),/RESTORE_SCHEMA_MISMATCH_relations/);
      assert.deepEqual(compareProofs(a,canonical),['schema.relations']);
    }
    const withGrant=proof([relation('fixture_table','r',[...ownerTableAcl,'fixture_app=r/fixture_owner'])]);
    const withGrantCanonical=await prepareRestoreComparison(client,withGrant);
    for(const entry of ['fixture_app=r*/fixture_owner','fixture_app=r/fixture_other','fixture_other=r/fixture_owner']){
      const changed=structuredClone(withGrant);changed.portableSchema.relations[0].relacl[1]=entry;
      const canonical=await prepareRestoreComparison(client,changed);
      assert.throws(()=>compareRestoreProof(withGrantCanonical,canonical),/RESTORE_SCHEMA_MISMATCH_relations/);
    }
    const publicGrant=proof([relation('fixture_table','r',['=r/fixture_owner'])]);
    const namedPublicGrant=proof([relation('fixture_table','r',['"PUBLIC"=r/fixture_owner'])]);
    const publicCanonical=await prepareRestoreComparison(client,publicGrant),namedPublicCanonical=await prepareRestoreComparison(client,namedPublicGrant);
    assert.throws(()=>compareRestoreProof(publicCanonical,namedPublicCanonical),/RESTORE_SCHEMA_MISMATCH_relations/);
    const mixedCaseDefault=proof([{...relation('fixture_case_table'),owner:'FixtureOwner'}]);
    const mixedCaseExplicit=structuredClone(mixedCaseDefault);
    mixedCaseExplicit.portableSchema.relations[0].relacl=await defaultTableAcl('"FixtureOwner"');
    const lowercaseExplicit=structuredClone(mixedCaseDefault);
    lowercaseExplicit.portableSchema.relations[0].relacl=await defaultTableAcl('fixtureowner');
    const mixedCaseCanonical=await prepareRestoreComparison(client,mixedCaseDefault);
    const lowercaseCanonical=await prepareRestoreComparison(client,lowercaseExplicit);
    assert.throws(()=>compareRestoreProof(mixedCaseCanonical,lowercaseCanonical),/RESTORE_SCHEMA_MISMATCH_relations/);
    compareRestoreProof(mixedCaseCanonical,await prepareRestoreComparison(client,mixedCaseExplicit));
    for(const field of ['ledger','rows','passwordDigest','sequences','settings','databaseGrants','triggerStructure']){
      const changed=structuredClone(b);changed[field]={fakeDrift:true};
      assert.throws(()=>compareRestoreProof(a,changed),/RESTORE_PROOF_MISMATCH/);
    }
    await client.query('ROLLBACK');
    for(const alter of [row=>{row.extra='PRIVATE_CANARY';},row=>{row.relacl=['INVALID_PRIVATE_CANARY'];},...[null,[],ownerTableAcl].map(acl=>row=>{row.owner='missing_fixture_role';row.relacl=acl;})]){
      const invalid=structuredClone(source);alter(invalid.portableSchema.relations[0]);
      await client.query('BEGIN READ ONLY');
      await assert.rejects(prepareRestoreComparison(client,invalid),error=>error.message==='RESTORE_RELATION_ACL_COMPARISON_FAILED'&&!String(error.stack).includes('PRIVATE_CANARY'));
      await client.query('ROLLBACK');
    }
    const duplicate=structuredClone(source);duplicate.portableSchema.relations.push(duplicate.portableSchema.relations[0]);
    await assert.rejects(prepareRestoreComparison(client,duplicate),/RESTORE_RELATION_ACL_COMPARISON_FAILED/);
  }finally{await client?.end();await cluster.close();}
});
