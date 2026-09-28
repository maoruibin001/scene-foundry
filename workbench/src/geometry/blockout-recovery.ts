import {existsSync,readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {read,runDir,digest} from '../store';

/** Only this execution chain, the identical frozen space and model are eligible.
 * Unlike the global cache, this also preserves valid siblings of a failed batch.
 */
export function recoverBlockoutTemplates(space:any,ctx:any,validate:(value:any,brief:any,proof:any)=>any){
 const found=new Map<string,any>(),seen=new Set<string>();let id=ctx.job.recoverySourceJobId;
 while(id){
  if(seen.has(id)||seen.size>=32)throw Error('恢复来源链无效');seen.add(id);
  const jobFile=join(runDir(id),'job.json');if(!existsSync(jobFile))break;const source=read(jobFile);
  if(ctx.job.reuseMode==='fresh'&&(source.reuseMode!=='fresh'||(source.executionRecoveryRoot??source.id)!==(ctx.job.executionRecoveryRoot??ctx.job.id)))break;
  if(source.prompt!==ctx.job.prompt||JSON.stringify((source.images??[]).map(i=>i.id))!==JSON.stringify((ctx.job.images??[]).map(i=>i.id))||JSON.stringify(source.plan)!==JSON.stringify(ctx.plan)||JSON.stringify(source.modelSettings)!==JSON.stringify(ctx.job.modelSettings))break;
  const root=join(runDir(id),'generation/blockout');
  if(existsSync(root))for(const round of readdirSync(root).filter(n=>/^\d+$/.test(n)).sort((a,b)=>Number(b)-Number(a))){
   const folder=join(root,round),spaceFile=join(folder,'space.json');
   if(!existsSync(spaceFile)||JSON.stringify(read(spaceFile))!==JSON.stringify(space))continue;
   const candidates:string[]=[];
   // Batch provider responses are immutable evidence even when one sibling was invalid.
   const batches=join(folder,'batches');if(existsSync(batches))for(const batch of readdirSync(batches).filter(n=>/^\d+$/.test(n))){
    const file=join(batches,batch,'scene-blockout-parsed.json'),receipt=join(batches,batch,'scene-blockout-receipt.json');
    if(existsSync(file)&&existsSync(receipt)&&read(receipt).requestedModel===ctx.job.modelSettings?.model)candidates.push(file);
   }
   // Individual generation records have the same receipt requirement.
   for(const brief of space.program.templates){const folder=join(root,round,'templates',brief.id),file=join(folder,'geometry.json'),receipt=join(folder,'scene-blockout-receipt.json');if(existsSync(file)&&existsSync(receipt)&&read(receipt).requestedModel===ctx.job.modelSettings?.model)candidates.push(file);}
   for(const file of candidates){
    const raw=readFileSync(file,'utf8');let value:any;try{value=JSON.parse(raw);}catch{continue;}
    for(const brief of space.program.templates){
     if(found.has(brief.id)||value?.templates?.filter(t=>t.id===brief.id).length!==1)continue;
     const proof={sourceJobId:id,sourceVersion:source.pipelineVersion,sourceFile:file,responseSha256:digest(raw),chain:[...seen],validatedAt:Date.now()};
     try{const checked=validate({templates:[value.templates.find(t=>t.id===brief.id)]},brief,proof);found.set(brief.id,{value:checked,proof});}catch{/* Never restore a template that still fails the current contract. */}
    }
   }
  }
  id=source.recoverySourceJobId;
 }
 return found;
}
