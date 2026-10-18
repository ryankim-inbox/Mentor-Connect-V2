import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readFile } from 'node:fs/promises';
import path from 'node:path';

export const APPROVAL = 'Sentinel_ffd3ea6a2ec481918348d4055e1c5da7';
export const TARGET = Object.freeze({project:'purple-pond-78194407',branch:'br-super-queen-b5j58k39',host:'ep-crimson-night-b552ar17.c-7.us-east-2.aws.neon.tech',port:5432,database:'neondb',user:'neondb_owner',renderService:'srv-db96aglg1s2s739tbtd0'});
export const RECEIPT_SHA256 = '3dcd43fc601fa0a0556ce80ce6407ca0a6e0358d41623c0b9f864fb88c9b5e08';
export const canonical = value => value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])) : value;
export const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export const hashBytes = value => createHash('sha256').update(value).digest('hex');
export const same = (a,b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
export function requireThat(condition) { if (!condition) throw new Error('HANDOFF_PRECONDITION_REJECTED'); }
export async function privateDirectory(directory) {
  const stat=await lstat(directory);
  requireThat(stat.isDirectory()&&!stat.isSymbolicLink()&&stat.uid===process.getuid()&&(stat.mode&0o077)===0);
}
export async function privateRead(filename) {
  await privateDirectory(path.dirname(filename));
  const handle=await open(filename,constants.O_RDONLY|constants.O_NOFOLLOW);
  try { const stat=await handle.stat();requireThat(stat.isFile()&&stat.uid===process.getuid()&&(stat.mode&0o077)===0&&stat.nlink===1&&stat.size<4*1024*1024);return await handle.readFile(); }
  finally { await handle.close(); }
}
export async function durableCreate(filename,value) {
  await privateDirectory(path.dirname(filename));
  const handle=await open(filename,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try { await handle.writeFile(JSON.stringify(value)+'\n');await handle.sync(); } finally { await handle.close(); }
  const dir=await open(path.dirname(filename),'r');try { await dir.sync(); } finally { await dir.close(); }
}

export function validateDeployment(gate,manifest,now=Date.now()) {
  requireThat(gate?.formatVersion===1&&same(gate.target,TARGET)&&gate.approval===APPROVAL&&gate.releaseSha===manifest.releaseSha&&gate.manifestSha256===manifest.manifestSha256&&gate.reviewed===true&&gate.deployed===true);
  requireThat(/^https:\/\/dashboard\.render\.com\/web\/srv-db96aglg1s2s739tbtd0\/deploys\/dep-[a-z0-9]+$/.test(gate.deploymentUrl??''));
  const age=now-Date.parse(gate.verifiedAt);requireThat(Number.isFinite(age)&&age>=0&&age<=30*60_000);
}

export function validateWriterResponse(response,request,now=Date.now()) {
  requireThat(response?.formatVersion===1&&response.nonce===request.nonce&&response.requestDigest===digest(request));
  for(const key of ['attemptId','revisionId','phase','previewDigest','targetDigest','releaseSha','manifestSha256','approval'])requireThat(response[key]===request[key]);
  requireThat(same(response.target,TARGET)&&response.source==='actual-render-control-plane-ui'&&response.suspended===true&&response.deployedReleaseSha===request.releaseSha&&response.activeDeploy===false);
  requireThat(response.sourceUrl===`https://dashboard.render.com/web/${TARGET.renderService}`);
  const observed=Date.parse(response.verifiedAt),created=Date.parse(request.createdAt);
  requireThat(Number.isFinite(observed)&&observed>=created&&observed<=now&&now-observed<=30_000);
  return {verifiedAt:response.verifiedAt,targetDigest:response.targetDigest,releaseSha:response.releaseSha,evidenceDigest:digest(response)};
}

/** The operator must actually inspect Render for every request. Files are a
 * private local handoff, not an assertion that the module can authenticate UI. */
export function writerEvidenceProvider({directory,attemptId,revisionId,manifestSha256,timeoutMs=55_000,now=Date.now,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),status=()=>{}}) {
  requireThat(timeoutMs>0&&timeoutMs<=60_000);
  const phases=new Set();
  return async ({phase,previewDigest,targetDigest,releaseSha})=>{
    requireThat(['initial','locked-prewrite','precommit'].includes(phase)&&!phases.has(phase));phases.add(phase);
    const request={formatVersion:1,attemptId,revisionId,phase,previewDigest,targetDigest,releaseSha,manifestSha256,approval:APPROVAL,target:TARGET,nonce:randomBytes(24).toString('hex'),createdAt:new Date(now()).toISOString()};
    const stem=`writer-${phase}-${request.nonce}`;
    await durableCreate(path.join(directory,stem+'.request.json'),request);
    status('WAITING_FOR_FRESH_WRITER_EVIDENCE');
    const deadline=now()+timeoutMs;
    while(now()<deadline) {
      try {
        const response=JSON.parse(await privateRead(path.join(directory,stem+'.response.json')));
        const verified=validateWriterResponse(response,request,now());
        await durableCreate(path.join(directory,stem+'.consumed.json'),{requestDigest:digest(request),evidenceDigest:verified.evidenceDigest,consumedAt:new Date(now()).toISOString()});
        return verified;
      } catch(error) { if(error.code!=='ENOENT') throw new Error('WRITER_EVIDENCE_REJECTED'); }
      await pause(Math.min(200,Math.max(0,deadline-now())));
    }
    throw new Error('WRITER_EVIDENCE_TIMEOUT');
  };
}

export async function consumeClaim({directory,manifest,claimToken,revisionId}) {
  const claim=JSON.parse(await privateRead(path.join(directory,'attempt.json')));
  requireThat(claim.formatVersion===1&&claim.state==='claimed-no-retry'&&claim.releaseSha===manifest.releaseSha&&claim.manifestSha256===manifest.manifestSha256&&claim.revisionId===revisionId&&claim.claimTokenDigest===hashBytes(claimToken)&&same(claim.target,TARGET)&&claim.approval===APPROVAL);
  requireThat(/^[A-Za-z0-9_-]{8,120}$/.test(claim.attemptId??''));
  await durableCreate(path.join(directory,'attempt-consumed.json'),{attemptId:claim.attemptId,releaseSha:claim.releaseSha,manifestSha256:claim.manifestSha256,consumedAt:new Date().toISOString()});
  return claim;
}
