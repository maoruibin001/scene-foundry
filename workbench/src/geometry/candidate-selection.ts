/** 对同契约评分进行退步保护；不重算分数，不把分差当作画面改善的证明。 */
export function candidateSelection(before:any,after:any){
 if(!before)return {eligible:true,reasons:[],minGain:2};
 const reasons:string[]=[];
 if(before.policyVersion&&after.policyVersion&&before.policyVersion!==after.policyVersion)reasons.push('评分版本不同，不能自动选优');
 for(const id of ['spatial','coverage','material']){
  const a=before.dimensions?.find((d:any)=>d.id===id),b=after.dimensions?.find((d:any)=>d.id===id);
  if(Number.isFinite(a?.score)&&Number.isFinite(b?.score)&&a.score-b.score>.3+1e-9)reasons.push(id+' 退步超过 0.3/5');
 }
 const missing=new Set(before.criticalMissing??[]);
 if((after.criticalMissing??[]).some((id:string)=>!missing.has(id)))reasons.push('新增关键未完成项');
 for(const b of after.criteria??[]){const a=before.criteria?.find((v:any)=>v.id===b.id);if(a?.verdict==='met'&&b.verdict==='missing')reasons.push('已完成标准变为缺失：'+b.id);}
 return {eligible:reasons.length===0,reasons,minGain:2};
}
