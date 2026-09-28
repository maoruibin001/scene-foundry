import {ATOMIC_QUALITY_VERSION,ATOMIC_PLAN_PROMPT,validateCriteria} from './atomic-criteria';
import {callValidated} from './contracts';
import {stable} from './validated-cache';
import {validateGroundedPlan} from './grounding';
import {save} from './store';
import {join} from 'node:path';
import {mkdirSync} from 'node:fs';
export function validateCriteriaMigration(value:any,frozen:any,prompt:string){
 const grounded=validateGroundedPlan(value,prompt);
 for(const key of ['name','summary','requirements','capabilities','assumptions'])if(stable(grounded[key])!==stable(frozen[key]))throw Error('补充原子标准不能修改冻结需求：'+key);
 return validateCriteria(grounded);
}
/** 旧需求只补原子标准，保存到新任务；真实调用仍受总预算与用户确认开关保护。 */
export async function ensurePlanCriteria(plan:any,job:any,images:any[],dir:string,signal:AbortSignal){
 if(job.policy.version!==ATOMIC_QUALITY_VERSION)return plan;
 if(plan.acceptanceCriteria)return validateCriteria(plan);
 const frozen=structuredClone(plan),modelPlan={...frozen,requirements:frozen.requirements.map(({evidenceSpans,...r}:any)=>r)};
 const folder=join(dir,'criteria');mkdirSync(folder,{recursive:true});
 const result=await callValidated({role:'plan',schemaContext:{qualityVersion:ATOMIC_QUALITY_VERSION},modelSettings:job.modelSettings,images,signal,maxTokens:10000,system:ATOMIC_PLAN_PROMPT,text:JSON.stringify({originalPrompt:job.prompt,frozenPlan:modelPlan})},folder,v=>validateCriteriaMigration(v,frozen,job.prompt));save(join(dir,'criteria-migration.json'),{version:ATOMIC_QUALITY_VERSION,sourceRequirements:frozen.requirements,scope:'仅新增标准；历史计划与评分不修改'});return result.value;
}
