import {validatePlan} from './recipe';
export function evidenceSpans(evidence:string|string[],prompt:string):string[]{
 if(Array.isArray(evidence)){
  if(!evidence.length||evidence.length>6||evidence.some(x=>typeof x!=='string'||!x.trim()))throw Error('需求引用必须为 1–6 段非空文字');
  const spans=evidence.flatMap(part=>evidenceSpans(part,prompt));let at=0;
  for(const span of spans){const found=prompt.indexOf(span,at);if(found<0)throw Error('需求原文引用顺序不匹配');at=found+span.length;}return spans;
 }
 if(prompt.includes(evidence))return [evidence];
 const pairs=[['“','”'],['"','"'],['‘','’']];
 if(pairs.some(([a,b])=>evidence.startsWith(a)&&evidence.endsWith(b))){const inner=evidence.slice(1,-1);if(inner&&prompt.includes(inner))return [inner];}
 // Models may join multiple literal quotations; accept only named separators,
 // never discard free-form prose or accept paraphrased source evidence.
 const quotes=[...evidence.matchAll(/“([^”]+)”|"([^"]+)"|‘([^’]+)’/g)];
 const remainder=evidence.replace(/“([^”]+)”|"([^"]+)"|‘([^’]+)’/g,'').replace(/\s|以及|和|及|[、，,；;]|\.{3}|…+/g,'');
 const spans=quotes.length>1&&!remainder?quotes.map(q=>(q[1]??q[2]??q[3]).trim()):evidence.split(/\.{3}|…+|[；;]/).map(x=>x.trim());
 if(spans.length<2||spans.some(x=>x.length<2))throw Error('需求原文引用不匹配');
 let at=0;for(const span of spans){const found=prompt.indexOf(span,at);if(found<0)throw Error('需求原文引用不匹配');at=found+span.length;}return spans;
}
export function validateGroundedPlan(p:any,prompt:string){validatePlan(p);
 if(!Array.isArray(p.capabilities)||!p.capabilities.length||p.capabilities.some((v:string)=>!['mapping','consistency'].includes(v)))throw Error('需声明映射/一致性目标');
 for(const r of p.requirements){if(!['prompt','image','inferred'].includes(r.source)||!(typeof r.evidence==='string'&&r.evidence.trim()||Array.isArray(r.evidence)&&r.evidence.length>0&&r.evidence.length<=6&&r.evidence.every((v:any)=>typeof v==='string'&&v.trim())))throw Error('需求缺少来源证据');if(r.source==='prompt')r.evidenceSpans=evidenceSpans(r.evidence,prompt);
 if(r.count!==null&&r.count!==undefined){if(!Number.isInteger(r.count)||r.count<1||r.count>28||r.source!=='prompt')throw Error('精确数量只能来自明确的用户文字，图像推断数量必须为 null');}
 if(r.source==='inferred'&&r.critical)throw Error('推断需求不能冻结成关键项');
 }
 return p;
}
