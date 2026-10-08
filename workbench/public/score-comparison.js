export function scoreComparison(job){
 const formal=job.quality?.score,weights=job.quality?.dimensions,raw=job.review?.dimensions;
 if(!Number.isFinite(formal)||!Array.isArray(weights)||!Array.isArray(raw)||weights.length!==5||raw.length!==5||new Set(raw.map(d=>d.id)).size!==5||Math.abs(weights.reduce((s,d)=>s+d.weight,0)-100)>1e-6)return null;
 let score=0;for(const w of weights){const d=raw.find(d=>d.id===w.id);if(!d||!Number.isFinite(d.score)||d.score<0||d.score>5)return null;score+=d.score/5*w.weight;}
 return {formal,diagnostic:Math.round(score*100)/100,gap:Math.round((formal-score)*100)/100};
}
export function scoreComparisonHTML(job){const s=scoreComparison(job);if(!s)return '';
 return `<div class="notice"><b>正式分 ${s.formal.toFixed(1)} · 原始维度加权分 ${s.diagnostic.toFixed(2)}</b><p>正式分按冻结的需求条目汇总；原始维度分来自同一次评审对整体画面的判断，使用相同权重。二者相差 ${Math.abs(s.gap).toFixed(2)} 分。</p><p>${job.status==='passed'?'本次正式验收通过。':'本次尚未通过正式验收；单独一个高分不代表合格。'} 诊断分不替换历史正式分或验收结论。</p></div>`;
}
