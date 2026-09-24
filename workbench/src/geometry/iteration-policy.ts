/** 有限自动修正：轮数包含首稿，不允许把多轮成功改记为首稿成功。 */
export const MAX_VISUAL_REPAIRS=2;
export const MIN_MEANINGFUL_GAIN=2;
export type CycleResult={index:number;status:string;score:number|null;startedAt:number;endedAt:number};
export type IterationResult={cycles:CycleResult[];bestIndex:number;firstDraft:CycleResult;stopReason:'passed'|'limit'|'no-improvement'|'budget'};
export async function boundedIterations(options:{
 maxRepairs:number;firstStartedAt?:number;signal:AbortSignal;canRefine:()=>boolean;
 evaluate:(index:number)=>Promise<{status:string;score:number|null}>;
 snapshot:(cycle:CycleResult)=>Promise<void>;
 refine:(sourceIndex:number,nextIndex:number)=>Promise<void>;
 onProgress?:(cycles:CycleResult[],bestIndex:number)=>void;
}):Promise<IterationResult>{
 if(!Number.isInteger(options.maxRepairs)||options.maxRepairs<0||options.maxRepairs>MAX_VISUAL_REPAIRS)throw Error('自动视觉修正上限为两轮');
 const cycles:CycleResult[]=[];let bestIndex=0,stopReason:IterationResult['stopReason']='limit';
 for(let index=0;index<=options.maxRepairs;index++){
  options.signal.throwIfAborted();const startedAt=index===0?(options.firstStartedAt??Date.now()):Date.now();
  if(index)await options.refine(bestIndex,index);
  options.signal.throwIfAborted();const result=await options.evaluate(index);options.signal.throwIfAborted();
  if(!['passed','failed','needs_review'].includes(result.status)||!Number.isFinite(result.score)||(result.score??-1)<0||(result.score??101)>100)throw Error('轮次评分未完成或无效');
  const cycle={index,...result,startedAt,endedAt:Date.now()},previous=cycles[bestIndex];await options.snapshot(cycle);cycles.push(cycle);
  // 通过全部门槛优先，其次比较有效分数；不足两分的波动保留更早的产物，不作为继续消耗调用的依据。
  if(!previous||(cycle.status==='passed'&&previous.status!=='passed')||cycle.status!=='passed'&&previous.status!=='passed'&&(cycle.score??-1)-(previous.score??-1)>=MIN_MEANINGFUL_GAIN)bestIndex=index;
  options.onProgress?.(structuredClone(cycles),bestIndex);
  if(result.status==='passed'){stopReason='passed';break;}
  if(index>0&&bestIndex!==index){stopReason='no-improvement';break;}
  if(index===options.maxRepairs){stopReason='limit';break;}
  if(!options.canRefine()){stopReason='budget';break;}
 }
 return {cycles,bestIndex,firstDraft:structuredClone(cycles[0]),stopReason};
}
