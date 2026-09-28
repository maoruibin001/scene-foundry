const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function criteriaHTML(job){
 const rows=job.plan?.acceptanceCriteria;if(!rows?.length)return '';
 return '<details><summary>冻结的原子验收标准 · '+rows.length+' 项</summary><p>空间32% · 需求28% · 材质20% · 形态12% · 可读性8%。分数由以下条目计算，不把新旧评分规则混算。</p><div class="table-wrap"><table><thead><tr><th>标准 / 原始需求</th><th>维度与依据</th><th>实际评估</th></tr></thead><tbody>'+rows.map(c=>{const r=job.review?.criteria?.find(r=>r.id===c.id);return '<tr><td>'+esc(c.description)+'<br><small>'+esc(c.id)+' / '+esc(c.requirementId)+(c.critical?' · 关键':'')+'</small></td><td>'+esc(c.dimension)+'<br>'+esc(c.evidence.join('；'))+'</td><td>'+(r?esc(r.score)+' / 5<br>'+esc(r.reason)+'<br>'+esc(r.frames.join('、')):'尚未评估')+'</td></tr>';}).join('')+'</tbody></table></div></details>';
}
