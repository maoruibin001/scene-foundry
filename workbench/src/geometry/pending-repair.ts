import {existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {runDir,read,digest} from '../store';
/** A planned automatic repair is distinct from the last independently scored scene. */
export function pendingIterationRepair(job:any,dir=runDir(job.id)){
 if(['running','queued','passed','cancelled'].includes(job.status)||job.stage!=='repair'||!job.sceneProgram||job.partialOutput)return null;
 const generation=join(dir,'generation');if(!existsSync(generation))return null;
 const folders=readdirSync(generation).filter(f=>/^iteration-\d+$/.test(f)).sort((a,b)=>Number(b.slice(10))-Number(a.slice(10)));
 for(const name of folders){
  const folder=join(generation,name,'refinement');
  if(!['source.json','repair-goals.json','repair-batches.json','scene-repair-plan-parsed.json','scene-repair-plan-receipt.json'].every(f=>existsSync(join(folder,f)))||existsSync(join(folder,'receipt.json')))continue;
  const meta=read(join(folder,'source.json')),goals=read(join(folder,'repair-goals.json')),receipt=read(join(folder,'scene-repair-plan-receipt.json'));
  if(meta.sourceJobId!==job.id||!Number.isInteger(meta.sourceIteration)||receipt.stopReason!=='completed'||receipt.role!=='scene-repair-plan')continue;
  if(meta.sourceDigest!==digest(JSON.stringify(read(join(dir,'generated-scene.json'))))||goals.sourceDigest!==meta.sourceDigest)continue;
  return {folder,sourceIteration:meta.sourceIteration,sourceDigest:meta.sourceDigest};
 }
 return null;
}
