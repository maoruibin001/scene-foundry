import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {runDir,read,save,digest} from '../store';
import {parseModelJson} from '../provider';
/** Follow only the recorded recovery chain with identical inputs, plan and model. */
export function savedStage(ctx:any,role:string,validate:(value:any)=>any,allowRejected=false,space?:any){
 let id=ctx.job.recoverySourceJobId;const seen=new Set<string>();
 while(id){if(seen.has(id)||seen.size>=32)throw Error('恢复来源链无效');seen.add(id);const source=read(join(runDir(id),'job.json'));
  if(ctx.job.reuseMode==='fresh'&&(source.reuseMode!=='fresh'||(source.executionRecoveryRoot??source.id)!==(ctx.job.executionRecoveryRoot??ctx.job.id)))return null;
  if(source.prompt!==ctx.job.prompt||JSON.stringify((source.images??[]).map(i=>i.id))!==JSON.stringify((ctx.job.images??[]).map(i=>i.id))||JSON.stringify(source.plan)!==JSON.stringify(ctx.plan)||JSON.stringify(source.modelSettings)!==JSON.stringify(ctx.job.modelSettings))return null;
  const generation=join(runDir(id),'generation'),folders=[generation];
  if(role==='scene-space'&&existsSync(generation))folders.unshift(...readdirSync(generation).filter(n=>/^space-repair-\d+$/.test(n)).sort((a,b)=>Number(b.split('-').at(-1))-Number(a.split('-').at(-1))).map(n=>join(generation,n)));
  if(role==='scene-blockout'){folders.length=0;const root=join(generation,'blockout');if(existsSync(root))for(const n of readdirSync(root).filter(n=>/^\d+$/.test(n)).sort((a,b)=>Number(b)-Number(a))){const folder=join(root,n);if(existsSync(join(folder,'space.json'))&&JSON.stringify(read(join(folder,'space.json')))===JSON.stringify(space))folders.push(folder);}}
  for(const folder of folders){
  // A saved clay scene is also a reusable geometry artifact. A failed spatial
  // verdict invalidates its layout acceptance, not the existence of its meshes.
  if(role==='scene-blockout'&&existsSync(join(folder,'scene.json'))&&existsSync(join(folder,'gate.json'))){
   const sceneFile=join(folder,'scene.json'),scene=read(sceneFile),value=validate({templates:scene.program.templates}),gate=read(join(folder,'gate.json'));
   if(gate.runtimeDigest&&gate.frames?.length){const text=JSON.stringify(value),receipt={kind:'saved-graybox-artifact',requestedModel:source.modelSettings?.model,sourceJobId:id,sourceVersion:source.pipelineVersion,sceneSha256:digest(readFileSync(sceneFile)),qualityAccepted:gate.passed};return {value,text,receipt,proof:{sourceJobId:id,sourceVersion:source.pipelineVersion,sourceFolder:folder.slice(generation.length+1),sourceResponse:'scene.json',responseSha256:digest(text),receipt,chain:[...seen],validatedAt:Date.now()}};}
  }
  for(const prefix of [role+'-',...(allowRejected?[role+'-invalid-']:[])]){const file=join(folder,prefix+'response.txt'),receiptFile=join(folder,prefix+'receipt.json');if(!existsSync(file)||!existsSync(receiptFile))continue;
   const text=readFileSync(file,'utf8'),value=validate(parseModelJson(text)),receipt=read(receiptFile);
   if(receipt.requestedModel!==ctx.job.modelSettings?.model)throw Error('恢复输出的模型来源不一致');
   return {value,text,receipt,proof:{sourceJobId:id,sourceVersion:source.pipelineVersion,sourceResponse:prefix+'response.txt',sourceFolder:folder.slice(generation.length+1),responseSha256:digest(text),receipt,chain:[...seen],validatedAt:Date.now()}};
  }
  }id=source.recoverySourceJobId;
 }
 return null;
}
export function persistStageReuse(ctx:any,role:string,saved:any){save(join(ctx.dir,role+'-response.txt'),parseModelJson(saved.text));save(join(ctx.dir,role+'-receipt.json'),saved.receipt);save(join(ctx.dir,role+'-reuse.json'),saved.proof);}
