/** Delivery targets never replace the frozen visual scores or full-spec verdict. */
export type DeliveryStandard='basic70'|'strict'|'profile70';
export function deliveryStandard(policy:any):DeliveryStandard {
 const value=policy?.deliveryStandard??'strict';
 if(value!=='basic70'&&value!=='strict'&&value!=='profile70')throw Error('未知交付标准');
 return value;
}
/** Score-independent delivery safeguards are identical across legacy basic70 and new profiles. */
export function commonDelivery(job:any,review:any,runtime:any,quality:any,spec:any,countContradictions:any[]=[],objections:any[]=[]){
 const hardFailures=[...new Set([...(quality.hardFailures??[]),...['video','cameraStopped'].filter(k=>runtime.hard?.[k]!==true)])];
 const requirements=quality.requirements??review.requirements??[];
 const missing=[...new Set([...(job.plan.requirements??[]).filter((r:any)=>r.critical&&requirements.find((v:any)=>v.id===r.id)?.verdict==='missing').map((r:any)=>r.id),
  ...(job.policy.deliveryStandard==='profile70'?(job.plan.acceptanceCriteria??[]).filter((c:any)=>c.critical&&review.criteria?.find((r:any)=>r.id===c.id)?.verdict==='missing').map((c:any)=>c.requirementId):[])])];
 const confirmedDefects=(spec.rules??[]).filter((r:any)=>['mandatory','conditional'].includes(r.kind)&&r.status==='failed').map((r:any)=>r.id);
 // Authored instances and visible instances have different scopes. Preserve uncertain
 // visibility as a warning only for categories no exact count binds. Without a binding
 // for every counted requirement, any exact count keeps all categories strict.
 const counted=(job.plan.requirements??[]).filter((r:any)=>r.count!=null).map((r:any)=>r.id),bindings=job.structure?.categoryRequirements;
 const scoped=!!bindings&&counted.every((id:string)=>Object.values(bindings).some((ids:any)=>Array.isArray(ids)&&ids.includes(id)));
 const exactFor=(kind:string)=>scoped?(Array.isArray(bindings[kind])?bindings[kind]:[]).some((id:string)=>counted.includes(id))||!Array.isArray(bindings[kind]):counted.length>0;
 const partialVisibility=countContradictions.filter((c:any)=>{
  const actual=job.structure?.semanticCounts?.[c.kind];
  return !exactFor(c.kind)&&Number.isInteger(actual)&&Number.isInteger(c.visibleMin)&&Number.isInteger(c.visibleMax)
   // Owner decision 2026-10-21 (ticket 8ce27520): with no count to meet, a judge seeing more than the record is a counting-scope warning too.
   &&c.visibleMin>0&&c.visibleMax>=c.visibleMin&&(actual>c.visibleMax||actual<c.visibleMin);
 });
 const reasons=[
  ...hardFailures.map((k:string)=>'运行硬检查失败：'+k),
  ...(!job.structure?.passed?['场景结构检查未通过']:[]),
  ...missing.map((k:string)=>'关键主体或要求缺失：'+k),
  ...confirmedDefects.map((k:string)=>'已确认的规范缺陷：'+k),
 ];
 const pending=[...(job.partialOutput||job.assessmentScope==='partial'?['资产未齐，仅为部分草稿']:[]),
  ...(!quality.confidenceValid||quality.confidence<job.policy.confidenceFloor?['评分置信度不足']:[]),
  ...(countContradictions.length>partialVisibility.length?['场景数量与评分证据矛盾']:[]),...objections];
 return {version:'common-delivery-v1',status:reasons.length?'failed':pending.length?'needs_review':'passed',failures:reasons,pending,hardFailures,criticalMissing:missing,confirmedDefects,
  reasons:[...reasons,...pending],warnings:[...(spec.rules??[]).filter((r:any)=>['mandatory','conditional'].includes(r.kind)&&r.status==='needs_review').map((r:any)=>({id:r.id,reason:r.reason})),
   ...partialVisibility.map((c:any)=>({id:'count-visibility:'+c.kind,reason:job.structure.semanticCounts[c.kind]>c.visibleMax?`${c.kind}：场景记录${job.structure.semanticCounts[c.kind]}个组合实例，实际画面仅能辨认${c.visibleMin}–${c.visibleMax}个；其余可见性未证实，不等于已确认缺失或全部可见。${c.reason??''}`:`${c.kind}：场景记录${job.structure.semanticCounts[c.kind]}个组合实例，评审在画面中辨认出${c.visibleMin}–${c.visibleMax}个；该类别没有数量要求，按计数口径差异警告。${c.reason??''}`}))],
  scope:'完整性、关键主体、结构、真实Engine、必需规范与可信评分；不包含加权分数门槛'};
}
export function basicDelivery(job:any,review:any,runtime:any,quality:any,spec:any,strictStatus:string,countContradictions:any[]=[],objections:any[]=[]){
 const common=commonDelivery(job,review,runtime,quality,spec,countContradictions,objections),score=quality.score,rawScore=quality.diagnostic?.score;
 // Policies frozen before rawScoreGate existed keep gating the raw score; new ones report it alongside the composite.
 const reasons=[...(!Number.isFinite(score)||score<70?['综合分未达到70']:[]),...(job.policy.rawScoreGate!==false&&(!Number.isFinite(rawScore)||rawScore<70)?['原始维度加权分未达到70']:[]),...common.failures];
 return {standard:'basic70',threshold:70,status:reasons.length?'failed':common.pending.length?'needs_review':'passed',score,rawScore,strictStatus,
  reasons:[...reasons,...common.pending],warnings:common.warnings,
  scope:'完整场景的70分基础交付；局部细节和待复核项保留，不等于80分完整规范通过'};
}
