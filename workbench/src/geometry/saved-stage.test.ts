import {test,expect} from 'bun:test';
import {join} from 'node:path';
import {mkdirSync,rmSync} from 'node:fs';
import {runDir,save,digest} from '../store';
import {savedStage} from './saved-stage';

// Recovery of a job that ran graybox repairs (v27, 2026-10-29): repair folders hold the repair tool's summary as scene-space-response.txt.
test('space recovery reuses the last completed repair, skips an unfinished one, and falls back to the initial plan',()=>{
 const id=crypto.randomUUID(),root=runDir(id),gen=join(root,'generation'),model='m';
 const job={id,prompt:'p',images:[],plan:{requirements:[]},modelSettings:{model},pipelineVersion:'v'};
 const space=(n:number)=>({version:'scene-space-v1',marker:n});
 try{
  mkdirSync(gen,{recursive:true});save(join(root,'job.json'),job);
  save(join(gen,'scene-space-response.txt'),{version:'scene-space-plan-v2',marker:0});save(join(gen,'scene-space-receipt.json'),{requestedModel:model,stopReason:'completed'});
  const repair=(n:number,completed:boolean)=>{const d=join(gen,'space-repair-'+n);mkdirSync(d,{recursive:true});
   save(join(d,'scene-space-response.txt'),{selectedPatchSha256:'x',reason:'summary'});save(join(d,'scene-space-receipt.json'),{requestedModel:model,stopReason:'completed',toolsContract:'graybox-space-preview-v15'});
   if(completed){save(join(d,'applied-space.json'),space(n));save(join(d,'repair-receipt.json'),{contract:'graybox-space-repair-v8',spaceSha256:digest(JSON.stringify(space(n))),modelReceipt:{requestedModel:model}});}};
  const ctx={job:{...job,id:'r',recoverySourceJobId:id},plan:job.plan};
  repair(1,false);
  expect(savedStage(ctx,'scene-space',v=>v)!.value.marker).toBe(0);
  repair(2,true);repair(3,false);
  const saved=savedStage(ctx,'scene-space',v=>v)!;expect(saved.value.marker).toBe(2);expect(saved.proof.sourceResponse).toBe('applied-space.json');expect(saved.receipt.requestedModel).toBe(model);
 }finally{rmSync(root,{recursive:true,force:true});}
});
