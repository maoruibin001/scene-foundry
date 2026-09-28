/** 将已核验评审、需求与实际对象关联；不拆改冻结需求、不赋新分、不自动选目标。 */
export function repairRequirementFeedback(plan:any,review:any,scene:any,visibility:any,history:any){
 const prior=(history.attempts??[]).filter((a:any)=>a.scoreComparison?.comparableWithinAttempt&&a.scoreComparison?.comparableToCurrentAssessment);
 const unique=<T>(items:T[])=>[...new Set(items)];
 const requirements=(plan.requirements??[]).map((requirement:any)=>{
  const current=(review.requirements??[]).find((r:any)=>r.id===requirement.id);
  const instances=scene.program.instances.filter((i:any)=>i.requirementIds.includes(requirement.id));
  const ids=new Set(instances.map((i:any)=>i.id)),templates=new Set(instances.map((i:any)=>i.template));
  const evaluations=prior.map((a:any)=>{
   // 历史摘要只保留未完成项，缺席不能被推断为通过。
   const r=(a.assessment?.unmetRequirements??[]).find((r:any)=>r.id===requirement.id);
   const goals=(a.selectedGoals??[]).filter((g:any)=>(g.requirementIds??[]).includes(requirement.id));
   return r||goals.length?{jobId:a.jobId,relation:a.relation,verdict:r?.verdict??'未记录',reason:r?.reason??null,selectedGoals:goals.map((g:any)=>({kind:g.kind,problem:g.problem,expectedChange:g.expectedChange})),scoreGain:a.scoreGain??null}:null;
  }).filter(Boolean);
  const views=(visibility?.views??[]).map((view:any)=>{
   const resolved=(view.instances??[]).map((i:any)=>({...i,instanceId:i.instanceId??(visibility.palette??[]).find((p:any)=>p.number===i.number)?.instanceId}));
   const identitiesKnown=resolved.every((i:any)=>typeof i.instanceId==='string');
   const visible=resolved.filter((i:any)=>ids.has(i.instanceId));
   const fractions=visible.map((i:any)=>i.frameFraction);
   return {referenceIndex:view.referenceIndex,cameraName:view.cameraName,visibleInstanceIds:unique(visible.map((i:any)=>i.instanceId)),geometrySampleFraction:Array.isArray(view.instances)&&identitiesKnown&&fractions.every((n:any)=>Number.isFinite(n)&&n>=0&&n<=1)?Math.min(1,Math.round(fractions.reduce((s:number,n:number)=>s+n,0)*10000)/10000):null};
  });
  return {id:requirement.id,text:requirement.text,critical:requirement.critical,verdict:current?.verdict??'未评估',remainingEvidence:current?.reason??null,frames:current?.frames??[],
   associatedInstances:instances.map((i:any)=>({id:i.id,label:i.label,templateId:i.template})),
   associatedMaterials:unique(scene.program.templates.filter((t:any)=>templates.has(t.id)).flatMap((t:any)=>t.parts.flatMap((p:any)=>[p.material,...instances.filter((i:any)=>i.template===t.id).flatMap((i:any)=>(i.surfaceOverrides??[]).filter((o:any)=>o.sourceMaterialId===p.material).map((o:any)=>o.targetMaterialId))]))),
   views,evaluations,recordedIncompleteCount:evaluations.filter((r:any)=>['partial','missing','unverifiable'].includes(r.verdict)).length,
   selectionEvidence:'以当前评审和原始参考图确认具体缺项；关联对象、编辑记录和几何面积都不是质量验收。'};
 });
 return {version:'repair-requirement-feedback-v1',requirements,omittedVerifiedHistory:history.omittedVerified??0,
  scope:'冻结需求逐条关联，不改变需求权重、覆盖率计算或最终评分。历史仅取当前评审契约可比且来源已校验的记录，分支关系保留；没有历史未完成记录不等于通过。可见比例是排除透明表面的低分辨率几何采样，多个需求可能关联同一物体，禁止将其相加当作画面完成度。'};
}
