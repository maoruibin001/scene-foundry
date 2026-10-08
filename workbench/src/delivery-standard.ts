/** Delivery targets never replace the frozen visual scores or full-spec verdict. */
export type DeliveryStandard='basic70'|'strict';
export function deliveryStandard(policy:any):DeliveryStandard {
 const value=policy?.deliveryStandard??'strict';
 if(value!=='basic70'&&value!=='strict')throw Error('未知交付标准');
 return value;
}
export function basicDelivery(job:any,review:any,runtime:any,quality:any,spec:any,strictStatus:string,countContradictions:any[]=[],objections:any[]=[]){
 const hardFailures=[...new Set([...(quality.hardFailures??[]),...['video','cameraStopped'].filter(k=>runtime.hard?.[k]!==true)])];
 const score=quality.score,rawScore=quality.diagnostic?.score;
 const requirements=quality.requirements??review.requirements??[];
 const missing=(job.plan.requirements??[]).filter((r:any)=>r.critical&&requirements.find((v:any)=>v.id===r.id)?.verdict==='missing').map((r:any)=>r.id);
 const confirmedDefects=(spec.rules??[]).filter((r:any)=>['mandatory','conditional'].includes(r.kind)&&r.status==='failed').map((r:any)=>r.id);
 // Authored instances and visible instances have different scopes. Preserve uncertain
 // visibility as a warning only when the plan does not require an exact count.
 const exactCountRequired=(job.plan.requirements??[]).some((r:any)=>r.count!=null);
 const partialVisibility=countContradictions.filter((c:any)=>{
  const actual=job.structure?.semanticCounts?.[c.kind];
  return !exactCountRequired&&Number.isInteger(actual)&&Number.isInteger(c.visibleMin)&&Number.isInteger(c.visibleMax)
   &&c.visibleMin>0&&c.visibleMax>=c.visibleMin&&actual>c.visibleMax;
 });
 const reasons=[
  ...(!Number.isFinite(score)||score<70?['综合分未达到70']:[]),
  ...(!Number.isFinite(rawScore)||rawScore<70?['原始维度加权分未达到70']:[]),
  ...hardFailures.map((k:string)=>'运行硬检查失败：'+k),
  ...(!job.structure?.passed?['场景结构检查未通过']:[]),
  ...missing.map((k:string)=>'关键主体或要求缺失：'+k),
  ...confirmedDefects.map((k:string)=>'已确认的规范缺陷：'+k),
 ];
 const pending=[...(job.partialOutput||job.assessmentScope==='partial'?['资产未齐，仅为部分草稿']:[]),
  ...(!quality.confidenceValid||quality.confidence<job.policy.confidenceFloor?['评分置信度不足']:[]),
  ...(countContradictions.length>partialVisibility.length?['场景数量与评分证据矛盾']:[]),...objections];
 return {standard:'basic70',threshold:70,status:reasons.length?'failed':pending.length?'needs_review':'passed',score,rawScore,strictStatus,
  reasons:[...reasons,...pending],warnings:[...(spec.rules??[]).filter((r:any)=>['mandatory','conditional'].includes(r.kind)&&r.status==='needs_review').map((r:any)=>({id:r.id,reason:r.reason})),
   ...partialVisibility.map((c:any)=>({id:'count-visibility:'+c.kind,reason:`${c.kind}：场景记录${job.structure.semanticCounts[c.kind]}个组合实例，实际画面仅能辨认${c.visibleMin}–${c.visibleMax}个；其余可见性未证实，不等于已确认缺失或全部可见。${c.reason??''}`}))],
  scope:'完整场景的70分基础交付；局部细节和待复核项保留，不等于80分完整规范通过'};
}
