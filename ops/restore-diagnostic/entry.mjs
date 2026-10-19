import { open } from 'node:fs/promises';
import { runDiagnostic } from './diagnostic.mjs';
async function main(){
try {
  let input='';for await(const chunk of process.stdin){input+=chunk.toString('utf8');if(input.length>8192)throw new Error('INPUT_REJECTED');}
  const config=JSON.parse(input);
  const result=await runDiagnostic(config);
  result.reportWrite='saved';
  try{
    const file=await open(config.workDirectory+'/result.json','wx',0o600);
    try{await file.writeFile(JSON.stringify(result)+'\n');await file.sync();}finally{await file.close();}
  }catch{result.reportWrite='failed';}
  process.stdout.write(JSON.stringify(result)+'\n');
  process.exitCode=result.status==='LOCAL_RESTORE_MATCH'&&result.cleanup==='ok'&&result.reportWrite==='saved'?0:2;
}catch{process.stdout.write('{"status":"LOCAL_RESTORE_FAILED","failedStage":null,"category":"LOCAL_OPERATION_FAILED","mismatchFields":[],"cleanup":"unknown"}\n');process.exitCode=2;}
}
main();
