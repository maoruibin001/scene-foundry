import {spatialInstances} from './spatial-order';
import {mkdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {callValidated} from '../contracts';
import {save,saveJob,read} from '../store';
import {roleSettings} from '../generation-policy';
import {executionSettings} from '../execution-settings';
import {assetWorkers} from './asset-workers';
import {validateAsset} from './layout';
import {BLOCKOUT_PART_LIMIT,COMPACT_BLOCKOUT_RULES,assertBlockoutGeneration,blockoutTemplateInput} from './blockout-contract';
export {blockoutTemplateInput} from './blockout-contract';
import {standardJob,STANDARD_MATCHING} from '../matching-level';
import {repairBlockoutContours} from './blockout-contours';
import {recoverBlockoutTemplates} from './blockout-recovery';
import {limitBlockoutTessellation} from './blockout-tessellation';
import {assetTriangleBudget} from './triangle-budget';
import {assertProceduralBudget} from './procedural-handoff';

export const BLOCKOUT_MATERIALS=[{id:'blockout',color:[.52,.55,.58,1],roughness:.85,metallic:0,textureId:null}];
export const BLOCKOUT_TEMPLATE_PROMPT='根据已冻结的局部空间契约生成一个三维灰模模板，只输出 templates 数组且恰好包含指定 id。各参考图对应同一资产；不能改变世界机位、摆放或局部原点。\n'+COMPACT_BLOCKOUT_RULES;
export function blockoutGenerationInput(space:any,brief:any){const input=blockoutTemplateInput(space,brief);input.contract='composition-graybox-v2';input.brief.maxParts=Math.min(BLOCKOUT_PART_LIMIT,input.brief.maxParts);return {...input,proceduralTriangleBudget:assetTriangleBudget(space,brief),proceduralBudgetInstructions:'branchCrown必须在本额度内保留全部结构并为详细部件留出余量；场景总量合格不能替代单资产额度。'};}
export function validateBlockoutTemplate(value:any,space:any,brief:any){
 const input=blockoutTemplateInput(space,brief);
 if(value?.templates?.length!==1||value.templates[0].id!==brief.id||value.templates[0].parts?.some(p=>p.shape?.type==='scatter'))throw Error('灰模只允许指定模板与简单几何');
 assertProceduralBudget({program:{templates:value.templates}},space);
 validateAsset({version:'asset-geometry-v1',template:value.templates[0]},input.brief,{...space,program:{...space.program,instances:spatialInstances(space.program.instances),materials:BLOCKOUT_MATERIALS}},{});return value;
}
export function checkedBlockoutTemplate(value:any,space:any,brief:any,folder:string,proof:any=null){
 const repaired=repairBlockoutContours(value);
 const tessellation=limitBlockoutTessellation(repaired.value);
 const checked=validateBlockoutTemplate(tessellation.value,space,brief);
 if(repaired.repairs.length){const file=join(folder,'contour-repairs.json'),rows=existsSync(file)?read(file):[];rows.push({at:Date.now(),proof,repairs:repaired.repairs});save(file,rows);}
 if(tessellation.adjustments.length){const file=join(folder,'tessellation-adjustments.json'),rows=existsSync(file)?read(file):[];rows.push({at:Date.now(),proof,adjustments:tessellation.adjustments});save(file,rows);}
 return checked;
}
/** Shared layout is frozen first; all independent templates use the existing global model pool. */
export async function generateBlockoutTemplates(space:any,ctx:any,folder:string,request:typeof callValidated=callValidated){
 if(standardJob(ctx.job))return generateBlockoutBatches(space,ctx,folder,request);
 const {job,images,signal}=ctx,limit=Math.min(executionSettings(job.executionSettings).assetConcurrency,job.optimizationPolicy?.grayboxConcurrency??6);
 const progress:any={total:space.program.templates.length,completed:0,reused:0,active:0,peak:0,concurrency:limit,steps:space.program.templates.map(t=>({id:t.id,status:'pending'}))};
 const persist=()=>{save(join(folder,'template-progress.json'),progress);job.blockout.templateProgress=structuredClone(progress);saveJob(job);};persist();
 const results=await assetWorkers(space.program.templates,limit,signal,async(brief:any,index,childSignal)=>{
  const dir=join(folder,'templates',brief.id);mkdirSync(dir,{recursive:true});const step=progress.steps[index];step.status='running';step.startedAt=Date.now();progress.active++;progress.peak=Math.max(progress.peak,progress.active);persist();
  try{const result=await request({role:'scene-blockout',modelSettings:roleSettings(job.modelSettings,'scene-blockout',job.optimizationPolicy),signal:childSignal,maxTokens:6000,images,system:BLOCKOUT_TEMPLATE_PROMPT,text:JSON.stringify(blockoutGenerationInput(space,brief))},dir,v=>validateBlockoutTemplate(assertBlockoutGeneration(v),space,brief));
   save(join(dir,'geometry.json'),result.value);step.status=result.reuse?'reused':'passed';step.reusedFrom=result.reuse??null;step.modelSettings=result.receipt?.modelSettings??roleSettings(job.modelSettings,'scene-blockout',job.optimizationPolicy);progress.completed++;if(result.reuse)progress.reused++;return result.value.templates[0];
  }catch(error){step.status=childSignal.aborted?'cancelled':'failed';step.error=String(error);throw error;}finally{step.endedAt=Date.now();step.durationMs=step.endedAt-step.startedAt;progress.active--;persist();}
 });return {value:{templates:results}};
}

/** Several simple local templates share a request; every template keeps its own validation and artifact. */
export async function generateBlockoutBatches(space:any,ctx:any,folder:string,request:typeof callValidated=callValidated){
 const {job,images,signal}=ctx,briefs=space.program.templates,batches:any[][]=[];
 signal.throwIfAborted();
 const recovered=recoverBlockoutTemplates(space,ctx,(v,b,proof)=>checkedBlockoutTemplate(v,space,b,folder,proof),folder);
 for(const [id,item] of recovered){const out=join(folder,'templates',id);mkdirSync(out,{recursive:true});save(join(out,'geometry.json'),item.value);save(join(out,'recovery-source.json'),item.proof);}
 const pending=briefs.filter(b=>!recovered.has(b.id));
 for(let i=0;i<pending.length;i+=STANDARD_MATCHING.grayboxBatchSize)batches.push(pending.slice(i,i+STANDARD_MATCHING.grayboxBatchSize));
 const limit=Math.max(1,Math.min(executionSettings(job.executionSettings).assetConcurrency,batches.length));
 const progress:any={total:briefs.length,completed:recovered.size,reused:recovered.size,active:0,peak:0,concurrency:limit,batchSize:4,modelRequests:batches.length,steps:briefs.map(t=>({id:t.id,status:recovered.has(t.id)?'reused':'pending',...(recovered.has(t.id)?{reusedFrom:recovered.get(t.id).proof}:{})}))};
 const persist=()=>{save(join(folder,'template-progress.json'),progress);job.blockout.templateProgress=structuredClone(progress);saveJob(job);};persist();
 const results=await assetWorkers(batches,limit,signal,async(batch,index,childSignal)=>{
  const dir=join(folder,'batches',String(index));mkdirSync(dir,{recursive:true});
  for(const b of batch)Object.assign(progress.steps.find(s=>s.id===b.id),{status:'running',startedAt:Date.now()});progress.active++;progress.peak=Math.max(progress.peak,progress.active);persist();
  try{
   const result=await request({role:'scene-blockout',modelSettings:roleSettings(job.modelSettings,'scene-blockout',job.optimizationPolicy),signal:childSignal,maxTokens:10000,images,system:BLOCKOUT_TEMPLATE_PROMPT.replace('一个三维灰模模板，只输出 templates 数组且恰好包含指定 id','一组独立三维灰模模板，只输出 templates 数组且恰好包含本批全部指定 id')+'\n每项通常1–8个部件；各自保留原点、轮廓及通透开口，不生成细节。',text:JSON.stringify({contract:'batch-local-graybox-v1',items:batch.map(b=>blockoutGenerationInput(space,b))})},dir,v=>{
    assertBlockoutGeneration(v);
    if(v?.templates?.length!==batch.length||new Set(v.templates.map(t=>t.id)).size!==batch.length||v.templates.some(t=>!batch.some(b=>b.id===t.id)))throw Error('批量灰模必须与本批模板逐一对应');
    return {templates:batch.map(b=>checkedBlockoutTemplate({templates:[v.templates.find(t=>t.id===b.id)]},space,b,dir).templates[0])};
   });
   for(const b of batch){const out=join(folder,'templates',b.id);mkdirSync(out,{recursive:true});save(join(out,'geometry.json'),{templates:[result.value.templates.find(t=>t.id===b.id)]});save(join(out,'batch-source.json'),{batch:index,receiptFolder:dir,reuse:result.reuse??null});Object.assign(progress.steps.find(s=>s.id===b.id),{status:result.reuse?'reused':'passed',endedAt:Date.now()});progress.completed++;if(result.reuse)progress.reused++;}
   return result.value.templates;
  }catch(error){for(const b of batch)Object.assign(progress.steps.find(s=>s.id===b.id),{status:childSignal.aborted?'cancelled':'failed',endedAt:Date.now(),error:String(error)});throw error;}
  finally{progress.active--;persist();}
 });
 return {value:{templates:briefs.map(b=>recovered.get(b.id)?.value.templates[0]??results.flat().find(t=>t.id===b.id))}};
}
