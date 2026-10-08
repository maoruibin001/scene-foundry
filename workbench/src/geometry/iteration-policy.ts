import {candidateProgress} from './candidate-selection';
/** 保留每轮证据；显式 null 解除总轮数限制，无改善仍须诊断策略。 */
export const MAX_VISUAL_REPAIRS=2;
export const MIN_MEANINGFUL_GAIN=2;
export type CycleResult={index:number;status:string;score:number|null;startedAt:number;endedAt:number;rawDimensions?:any[];dimensionWeights?:Record<string,number>;dimensionFloor?:number;specRules?:any[];hardFailures?:string[];dimensions?:any[];criteria?:any[];criticalMissing?:string[];policyVersion?:string;selection?:any};
export type IterationResult={cycles:CycleResult[];bestIndex:number;firstDraft:CycleResult;stopReason:'passed'|'limit'|'no-improvement'|'budget'|'runtime-evidence'};
export async function boundedIterations(options:{
 maxRepairs:number|null;firstStartedAt?:number;signal:AbortSignal;canRefine:()=>boolean;
 refineBlockedReason?:()=>Exclude<IterationResult['stopReason'],'passed'>;
 evaluate:(index:number)=>Promise<{status:string;score:number|null;rawDimensions?:any[];dimensionWeights?:Record<string,number>;dimensionFloor?:number;specRules?:any[];hardFailures?:string[];dimensions?:any[];criteria?:any[];criticalMissing?:string[];policyVersion?:string}>;
 snapshot:(cycle:CycleResult)=>Promise<void>;
 refine:(sourceIndex:number,nextIndex:number)=>Promise<void>;
 onProgress?:(cycles:CycleResult[],bestIndex:number)=>void;
}):Promise<IterationResult>{
 if(options.maxRepairs!==null&&(!Number.isInteger(options.maxRepairs)||options.maxRepairs<0||options.maxRepairs>MAX_VISUAL_REPAIRS))throw Error('有限自动视觉修正上限为两轮；持续修正须明确使用 null');
 const cycles:CycleResult[]=[];let bestIndex=0,noGain=0,stopReason:IterationResult['stopReason']='limit';
 for(let index=0;options.maxRepairs===null||index<=options.maxRepairs;index++){
  options.signal.throwIfAborted();const startedAt=index===0?(options.firstStartedAt??Date.now()):Date.now();
  if(index)await options.refine(bestIndex,index);
  options.signal.throwIfAborted();const result=await options.evaluate(index);options.signal.throwIfAborted();
  if(!['passed','failed','needs_review'].includes(result.status)||!Number.isFinite(result.score)||(result.score??-1)<0||(result.score??101)>100)throw Error('轮次评分未完成或无效');
  const previous=cycles[bestIndex],cycle={index,...result,startedAt,endedAt:Date.now(),selection:candidateProgress(previous,result)};await options.snapshot(cycle);cycles.push(cycle);
  // 真实关闭未通过项也是进展，不让较高但不合格的总分锁死后续修正。
  if(cycle.selection.meaningful)bestIndex=index;
  options.onProgress?.(structuredClone(cycles),bestIndex);
  if(result.status==='passed'&&bestIndex===index){stopReason='passed';break;}
  if(index>0)noGain=bestIndex!==index?noGain+1:0;
  if(noGain>=2){stopReason='no-improvement';break;}
  if(index===options.maxRepairs){stopReason='limit';break;}
  if(!options.canRefine()){stopReason=options.refineBlockedReason?.()??'budget';break;}
 }
 return {cycles,bestIndex,firstDraft:structuredClone(cycles[0]),stopReason};
}
