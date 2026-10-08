import {existsSync} from 'node:fs';
import {join,relative,sep} from 'node:path';
import {RUNS,read} from './store';
import type {ModelSettings} from './model-selection';
export const OPTIMIZATION_POLICY={version:'reuse-parallel-v2',reuse:true,reasoning:'phase-capped',grayboxConcurrency:6,spatialPreflight:'composition-v3',assetVisualChecks:3,assetContextViews:1} as const;
const legacyRoles=new Set(['plan','scene-blockout','scene-surface','scene-repair-plan','scene-alignment']);
const caps:Record<string,string>={plan:'medium','scene-observation':'high','scene-space':'high','scene-space-judge':'medium','scene-blockout':'medium','scene-surface':'high','scene-repair-plan':'high','scene-alignment':'high','geometry-asset':'xhigh','scene-refine':'xhigh'};
/** 按阶段降低推理强度，绝不提升用户选择；精细档保留最终评分配置。 */
export function roleSettings(base:ModelSettings|undefined,role:string,policy:any):ModelSettings|undefined{
 if(!base)return undefined;
 if(policy?.version==='reuse-parallel-v1'&&policy.reasoning==='bounded-high'&&/^gpt-6-astra(?:-aihub-(?:openai|azure))?$/.test(base.model)&&base.reasoningEffort==='xhigh'&&(legacyRoles.has(role)||(policy.spatialPreflight==='coarse-v2'&&['scene-space','scene-space-judge'].includes(role))))return {...base,reasoningEffort:'high'};
 if(policy?.version!==OPTIMIZATION_POLICY.version||policy.reasoning!=='phase-capped')return {...base};
 const standardCaps:Record<string,string>={plan:'medium','scene-observation':'medium','scene-space':'high','scene-space-judge':'medium','scene-blockout':'medium','scene-surface':'high','geometry-asset':'high','scene-refine':'high',judge:'high'};
 const selectedCaps=policy?.matchingLevel==='standard'?standardCaps:caps;
 const levels=['none','minimal','low','medium','high','xhigh','max','ultra'],current=levels.indexOf(base.reasoningEffort),cap=levels.indexOf(selectedCaps[role]);
 // 模型未知时不猜测其支持档位；保留已选配置。
 if(!/^gpt-6-(astra|sol|luna)(?:-aihub-(?:openai|azure))?$/.test(base.model)||current<0||cap<0)return {...base};
 return {...base,reasoningEffort:levels[Math.min(current,cap)] as ModelSettings['reasoningEffort']};
}
export function requestJob(dir:string){const path=relative(RUNS,dir),id=path.split(sep)[0];if(path.startsWith('..')||!/^[a-f0-9-]{36}$/.test(id))return null;const file=join(RUNS,id,'job.json');return existsSync(file)?read(file):null;}
export function assetSettings(job:any,brief:any,layout:any){
 const hasOpening=(layout.spatialOpenings??[]).some((o:any)=>layout.program.instances.find((i:any)=>i.id===o.instanceId)?.template===brief.id);
 const ids=new Set(layout.program.instances.filter((i:any)=>i.template===brief.id).map((i:any)=>i.id));
 const critical=(layout.spatialRelations??[]).some((r:any)=>r.critical&&r.instanceIds?.some((id:string)=>ids.has(id)));
 const structural=hasOpening||critical||brief.bounds?.max.some((n:number,k:number)=>n-brief.bounds.min[k]>=5);
 if(job.optimizationPolicy?.version===OPTIMIZATION_POLICY.version)return roleSettings(job.modelSettings,structural?'scene-refine':brief.maxParts>12?'scene-surface':'scene-blockout',job.optimizationPolicy);
 const legacyStructural=structural||/墙|建筑|门|窗|楼梯|台阶|屋顶|地板|拱|立柱|梁/.test(brief.label+' '+brief.description);
 return roleSettings(job.modelSettings,legacyStructural?'geometry-asset':'scene-blockout',job.optimizationPolicy);
}
