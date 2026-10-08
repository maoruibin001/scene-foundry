import {existsSync,readdirSync,readFileSync} from 'node:fs';
import {join,relative} from 'node:path';
import {read,runDir,digest} from '../store';
import {blockoutTemplateInput} from './blockout-contract';
import {recoverReviewedGrayboxGeometry} from './graybox-reviewed-geometry';

/** Reuse local geometry within this execution chain when its actual input is unchanged.
 * Placement changes still require validation and a new complete spatial assessment.
 */
export function recoverBlockoutTemplates(space:any,ctx:any,validate:(value:any,brief:any,proof:any)=>any,currentFolder?:string){
 const found=new Map<string,any>(),seen=new Set<string>();
 const currentRound=currentFolder?relative(join(runDir(ctx.job.id),'generation/blockout'),currentFolder):'';
 if(currentFolder&&!/^\d+$/.test(currentRound))throw Error('灰模当前轮次路径无效');
 let id=currentFolder?ctx.job.id:ctx.job.spatialRepairSource?.jobId??ctx.job.recoverySourceJobId;
 let selectedSource=ctx.job.spatialRepairSource;
 while(id){
  if(seen.has(id)||seen.size>=32)throw Error('恢复来源链无效');seen.add(id);
  const jobFile=join(runDir(id),'job.json');if(id!==ctx.job.id&&!existsSync(jobFile))break;const source=id===ctx.job.id?ctx.job:read(jobFile);
  if((source.executionRecoveryRoot??source.id)!==(ctx.job.executionRecoveryRoot??ctx.job.id)||source.reuseMode!==ctx.job.reuseMode)break;
  if(source.prompt!==ctx.job.prompt||JSON.stringify((source.images??[]).map(i=>i.id))!==JSON.stringify((ctx.job.images??[]).map(i=>i.id))||JSON.stringify(source.plan)!==JSON.stringify(ctx.plan)||JSON.stringify(source.modelSettings)!==JSON.stringify(ctx.job.modelSettings))break;
  const root=join(runDir(id),'generation/blockout');
  if(existsSync(root))for(const round of readdirSync(root).filter(n=>/^\d+$/.test(n)).sort((a,b)=>Number(b)-Number(a))){
   if(id===ctx.job.id&&Number(round)>=Number(currentRound))continue;
   // A chosen diagnostic basis cannot borrow geometry from a later rejected branch.
   if(selectedSource?.jobId===id&&Number(round)>selectedSource.round)continue;
   const folder=join(root,round),spaceFile=join(folder,'space.json');
   if(!existsSync(spaceFile))continue;const previousSpace=read(spaceFile);
   const compatible=space.program.templates.filter(brief=>{
    const previous=previousSpace.program.templates.filter(t=>t.id===brief.id);
    return previous.length===1&&JSON.stringify(blockoutTemplateInput(previousSpace,previous[0]))===JSON.stringify(blockoutTemplateInput(space,brief));
   });
   if(!compatible.length)continue;
   const reviewed=recoverReviewedGrayboxGeometry(folder,ctx);
   if(reviewed){for(const brief of compatible){if(found.has(brief.id))continue;const template=reviewed.find(t=>t.id===brief.id);if(!template)throw Error('灰模部件恢复模板缺失');const proof={sourceJobId:id,sourceRound:Number(round),sourceVersion:source.pipelineVersion,sourceFile:join(folder,'scene.json'),responseSha256:digest(JSON.stringify(template)),localContractSha256:digest(JSON.stringify(blockoutTemplateInput(space,brief))),chain:[...seen],reviewed:true,validatedAt:Date.now()};const checked=validate({templates:[template]},brief,proof);found.set(brief.id,{value:checked,proof});}}
   const candidates:string[]=[];
   // Batch provider responses are immutable evidence even when one sibling was invalid.
   const batches=join(folder,'batches');if(existsSync(batches))for(const batch of readdirSync(batches).filter(n=>/^\d+$/.test(n))){
    const file=join(batches,batch,'scene-blockout-parsed.json'),receipt=join(batches,batch,'scene-blockout-receipt.json');
    if(existsSync(file)&&existsSync(receipt)&&read(receipt).requestedModel===ctx.job.modelSettings?.model)candidates.push(file);
   }
   // Individual generation records have the same receipt requirement.
   for(const brief of compatible){const folder=join(root,round,'templates',brief.id),file=join(folder,'geometry.json'),receipt=join(folder,'scene-blockout-receipt.json');if(existsSync(file)&&existsSync(receipt)&&read(receipt).requestedModel===ctx.job.modelSettings?.model)candidates.push(file);}
   for(const file of candidates){
    const raw=readFileSync(file,'utf8');let value:any;try{value=JSON.parse(raw);}catch{continue;}
    for(const brief of compatible){
     if(found.has(brief.id)||value?.templates?.filter(t=>t.id===brief.id).length!==1)continue;
     const proof={sourceJobId:id,sourceRound:Number(round),sourceVersion:source.pipelineVersion,sourceFile:file,responseSha256:digest(raw),localContractSha256:digest(JSON.stringify(blockoutTemplateInput(space,brief))),sourceSpaceSha256:digest(JSON.stringify(previousSpace)),chain:[...seen],validatedAt:Date.now()};
     try{const checked=validate({templates:[value.templates.find(t=>t.id===brief.id)]},brief,proof);found.set(brief.id,{value:checked,proof});}catch{/* Never restore a template that still fails the current contract. */}
    }
   }
  }
  selectedSource=source.spatialRepairSource;
  id=source.spatialRepairSource?.jobId??source.recoverySourceJobId;
 }
 return found;
}
