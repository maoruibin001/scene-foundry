import {requiredSpecRule} from '../spec-rule-kind';
/** 对同契约评分进行退步保护；不重算分数，不把分差当作画面改善的证明。 */
export function candidateSelection(before:any,after:any){
 if(!before)return {eligible:true,reasons:[],minGain:2};
 const reasons:string[]=[];
 if((before.deliveryStandard??'strict')!==(after.deliveryStandard??'strict'))reasons.push('交付标准不同，不能自动选优');
 if(before.policyVersion&&after.policyVersion&&before.policyVersion!==after.policyVersion)reasons.push('评分版本不同，不能自动选优');
 for(const key of ['dimensions','rawDimensions'])for(const id of ['spatial','coverage','material']){
  const a=before[key]?.find((d:any)=>d.id===id),b=after[key]?.find((d:any)=>d.id===id);
  if(Number.isFinite(a?.score)&&Number.isFinite(b?.score)&&a.score-b.score>.3+1e-9)reasons.push((key==='rawDimensions'?'原始维度 ':'')+id+' 退步超过 0.3/5');
 }
 for(const row of after.specRules??[]){const old=before.specRules?.find((v:any)=>v.id===row.id);if(old?.status==='passed'&&row.status!=='passed'&&(requiredSpecRule(old)||requiredSpecRule(row)))reasons.push('已通过规范退步：'+row.id);}
 const oldHard=new Set(before.hardFailures??[]);if((after.hardFailures??[]).some((id:string)=>!oldHard.has(id)))reasons.push('新增运行硬检查失败');
 const missing=new Set(before.criticalMissing??[]);
 if((after.criticalMissing??[]).some((id:string)=>!missing.has(id)))reasons.push('新增关键未完成项');
 for(const b of after.criteria??[]){const a=before.criteria?.find((v:any)=>v.id===b.id);if(a?.verdict==='met'&&b.verdict==='missing')reasons.push('已完成标准变为缺失：'+b.id);}
 return {eligible:reasons.length===0,reasons,minGain:2};
}


/** 选择依据与原始评分并存；关闭真实未通过项优先于总分波动。 */
export function candidateProgress(before:any,after:any){
 const selection=candidateSelection(before,after),reasons:string[]=[],closed:string[]=[];
 if(before?.deliveryStandard==='basic70'&&after.deliveryStandard==='basic70'&&before.status!=='passed'&&after.status==='passed'&&after.deliveryStatus==='passed'&&!after.hardFailures?.length)return {eligible:true,reasons:[],minGain:2,meaningful:true,progressReasons:['已达到完整70分基础交付，停止提分'],closed:[]};
 if(!selection.eligible)return {...selection,meaningful:false,progressReasons:reasons,closed};
 if(!before)return {...selection,meaningful:true,progressReasons:['首个真实候选'],closed};
 if(before.status==='passed')return {...selection,meaningful:false,progressReasons:[],closed};
 if(after.status==='passed')return {...selection,meaningful:true,progressReasons:['已通过全部验收门槛'],closed};
 const basic=after.deliveryStandard==='basic70';
 if(basic){
  // Only stable gates emitted by the actual delivery assessment count. Review prose may
  // change wording without resolving a defect, and strict critical-partial items are warnings here.
  const gate=(s:string)=>['综合分未达到70','原始维度加权分未达到70','场景结构检查未通过','资产未齐，仅为部分草稿','评分置信度不足','场景数量与评分证据矛盾'].includes(s)||['运行硬检查失败：','关键主体或要求缺失：','已确认的规范缺陷：'].some(prefix=>s.startsWith(prefix));
  if(Array.isArray(before.deliveryReasons)&&Array.isArray(after.deliveryReasons))for(const reason of before.deliveryReasons)if(typeof reason==='string'&&gate(reason)&&!after.deliveryReasons.includes(reason))closed.push('delivery:'+reason);
 }else{
  for(const field of ['criticalMissing','hardFailures'])if(Array.isArray(before[field])&&Array.isArray(after[field]))for(const id of before[field])if(!after[field].includes(id))closed.push(field+':'+id);
  for(const old of before.specRules??[]){const row=after.specRules?.find((v:any)=>v.id===old.id);if(old.status==='failed'&&row?.status==='passed'&&requiredSpecRule(old)&&requiredSpecRule(row))closed.push('spec:'+old.id);}
 }
 // basic70 has no strict per-dimension floor. Closing that floor alone cannot prolong it.
 const floor=basic?undefined:after.dimensionFloor;
 if(Number.isFinite(floor)&&before.dimensionFloor===floor)for(const old of before.rawDimensions??[]){const row=after.rawDimensions?.find((v:any)=>v.id===old.id);if(Number.isFinite(old.score)&&old.score<floor&&Number.isFinite(row?.score)&&row.score>=floor)closed.push('dimension:'+old.id);}
 if(closed.length)reasons.push('解决已记录的未通过项：'+closed.join('、'));
 const rawScore=(v:any)=>{const weights=v.dimensionWeights;if(!weights||Object.values(weights).reduce((n:number,w:any)=>n+w,0)!==100)return null;let score=0;for(const [id,w] of Object.entries(weights)){const d=v.rawDimensions?.find((x:any)=>x.id===id);if(!Number.isFinite(d?.score)||d.score<0||d.score>5)return null;score+=d.score*Number(w)/5;}return score;};
 const a=rawScore(before),b=rawScore(after),sameWeights=JSON.stringify(before.dimensionWeights)===JSON.stringify(after.dimensionWeights);
 const rawGain=sameWeights&&a!==null&&b!==null?Math.round((b-a)*100)/100:null;
 if(rawGain!==null&&rawGain>=selection.minGain)reasons.push('原始维度加权分提升 '+rawGain);
 if(!basic&&Number.isFinite(before.score)&&Number.isFinite(after.score)&&after.score-before.score>=selection.minGain-1e-9)reasons.push('正式分提升至少 '+selection.minGain);
 return {...selection,meaningful:reasons.length>0,progressReasons:reasons,closed,rawGain};
}
export function candidateEvidence(job:any){return {deliveryStandard:job.policy?.deliveryStandard??'strict',deliveryStatus:job.deliveryAssessment?.status,deliveryReasons:job.deliveryAssessment?.reasons,assessmentScope:job.partialOutput?'partial':'scene',status:job.status,score:job.quality?.score??null,dimensions:job.quality?.dimensions,rawDimensions:job.review?.dimensions,criteria:job.review?.criteria,criticalMissing:job.quality?.criticalMissing,hardFailures:job.quality?.hardFailures,specRules:job.spec?.rules,dimensionWeights:job.policy?.dimensionWeights,dimensionFloor:job.policy?.dimensionFloor,policyVersion:job.policy?.version};}
