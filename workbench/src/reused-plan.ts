import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {digest,read} from './store';
import {stable} from './validated-cache';
import {validateGroundedPlan} from './grounding';
import {parseModelJson} from './provider';
import {validateCriteria} from './atomic-criteria';

/** 复用保存的需求，而不是伪造一次缺失的历史模型响应。 */
export function loadReusedPlan(sourceDir:string,target:any){
 const source=read(join(sourceDir,'job.json'));
 const ids=(job:any)=>(job.images??(job.image?[job.image]:[])).map((i:any)=>i.id);
 if(source.prompt!==target.prompt||stable(ids(source))!==stable(ids(target)))throw Error('REUSE_INPUT_CHANGED：复用需求的文字或参考图与来源不一致');
 const files=['plan.json','plan-response.txt'].filter(f=>existsSync(join(sourceDir,f)));
 const candidates=files.map(file=>({file,value:file.endsWith('.txt')?parseModelJson(readFileSync(join(sourceDir,file),'utf8')):read(join(sourceDir,file))}));
 if(source.plan)candidates.push({file:'job.json:plan',value:source.plan});
 if(!candidates.length)throw Error('REUSE_PLAN_MISSING：来源没有可校验的需求计划');
 const checked=candidates.map(c=>({...c,value:validateGroundedPlan(structuredClone(c.value),target.prompt)}));
 const core=(p:any)=>{const {acceptanceCriteria,...rest}=p;return rest;};
 const canonicalCore=stable(core(checked[0].value));
 if(checked.some(c=>stable(core(c.value))!==canonicalCore))throw Error('REUSE_PLAN_CONFLICT：来源保存的需求计划与原始响应不一致');
 const withCriteria=checked.filter(c=>c.value.acceptanceCriteria);
 if(withCriteria.length){
  for(const c of withCriteria)validateCriteria(c.value);
  if(withCriteria.some(c=>stable(c.value.acceptanceCriteria)!==stable(withCriteria[0].value.acceptanceCriteria)))throw Error('REUSE_PLAN_CONFLICT：保存的原子标准不一致');
  if(checked.some(c=>!c.value.acceptanceCriteria)){
   // Old response remains intact. A completed model receipt must prove the added criteria.
   const promptFile=join(sourceDir,'judge-prompt.json'),receiptFile=join(sourceDir,'judge-receipt.json');
   const migrationFile=join(sourceDir,'criteria','plan-response.txt'),migrationReceipt=join(sourceDir,'criteria','plan-receipt.json');
   let attested:any=null;
   if(existsSync(migrationFile)&&existsSync(migrationReceipt)&&read(migrationReceipt).stopReason==='completed')attested=validateGroundedPlan(parseModelJson(readFileSync(migrationFile,'utf8')),target.prompt);
   else if(existsSync(promptFile)&&existsSync(receiptFile)&&read(receiptFile).stopReason==='completed')attested=JSON.parse(read(promptFile).input).frozenPlan;
   if(!attested||stable(core(attested))!==canonicalCore||stable(attested.acceptanceCriteria)!==stable(withCriteria[0].value.acceptanceCriteria))throw Error('REUSE_PLAN_CONFLICT：新增原子标准缺少完整模型调用来源');
  }
 }
 const plan=withCriteria[0]?.value??checked[0].value,canonical=stable(plan);
 return {plan,provenance:{version:'saved-plan-reuse-v2',sourceJobId:source.id,source:withCriteria[0]?.file??checked[0].file,planSha256:digest(canonical),criteriaPreserved:withCriteria.length>0,evidence:['job.json',...files,...['judge-prompt.json','judge-receipt.json','criteria/plan-response.txt','criteria/plan-receipt.json'].filter(f=>existsSync(join(sourceDir,f)))].map(file=>({file,sha256:digest(readFileSync(join(sourceDir,file)))})),modelResponsePresent:files.includes('plan-response.txt'),modelCall:false}};
}
