export const SPATIAL_SELECTION='net-closure-v1';
export const SPATIAL_NET_CLOSURE_MARGIN=.5;
/** Only jobs created under the policy select by net closure; historical rounds replay under their original rule. */
export function spatialSelectionRule(job:any){return job?.spatialSelectionPolicy===SPATIAL_SELECTION;}
export type SpatialCandidate={jobId:string;round:number;folder:string;space:any;gate:any};

/** Select the next repair's geometry, screenshots and feedback together. Never promote a failed graybox. */
export function selectSpatialCandidate(previous:SpatialCandidate|null,current:SpatialCandidate,options:{netClosure?:boolean}={}){
 const g=current.gate;
 if(!Number.isFinite(g.review?.score)||!Number.isFinite(g.review?.confidence))throw Error('空间候选缺少完整独立评估');
 if(!previous)return {candidate:current,eligible:true,changed:true,reason:'首个完整评估候选'};
 const old=previous.gate;
 if(g.protocol!==old.protocol||JSON.stringify(g.threshold)!==JSON.stringify(old.threshold)||JSON.stringify(current.space.spatialRelations)!==JSON.stringify(previous.space.spatialRelations))throw Error('空间候选的冻结关系或评审契约改变，不能跨契约选优');
 if(g.review.confidence<g.threshold.confidence)return {candidate:previous,eligible:false,changed:false,reason:'候选证据置信度未达门槛，保留原来源'};
 const added=(g.failed??[]).filter((id:string)=>!(old.failed??[]).includes(id));
 if(added.length){
  // A repair that closes more critical blocks than it opens, scores higher, and only opens marginal ones is a better next basis.
  const marginal=added.every((id:string)=>(g.review.relations??[]).find((r:any)=>r.id===id)?.score>=g.threshold.critical-SPATIAL_NET_CLOSURE_MARGIN);
  const closed=(old.failed??[]).filter((id:string)=>!(g.failed??[]).includes(id));
  if(!(options.netClosure===true&&marginal&&closed.length>added.length&&g.review.score>old.review.score))return {candidate:previous,eligible:false,changed:false,reason:'新增关键空间阻断：'+added.join('、')};
  return {candidate:current,eligible:true,changed:true,reason:SPATIAL_SELECTION+' 净关闭关键阻断：关闭'+closed.join('、')+'，新增临界'+added.join('、')+'，空间分提高'};
 }
 if((g.passed&&!old.passed)||g.review.score>old.review.score)return {candidate:current,eligible:true,changed:true,reason:g.passed?'独立空间门槛通过':'空间分提高且没有新增关键阻断'};
 return {candidate:previous,eligible:true,changed:false,reason:'未超过来源空间分，下一轮沿用已评估较好几何及其截图'};
}

export function spatialCandidateProof(v:SpatialCandidate){return {jobId:v.jobId,round:v.round,folder:v.folder,score:v.gate.review.score,passed:v.gate.passed,runtimeDigest:v.gate.runtimeDigest};}
