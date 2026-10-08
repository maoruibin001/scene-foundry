const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={subjects:'主体与主要结构',layout:'布局、比例与遮挡',shape:'主要轮廓与构造',materials:'主要材质与色彩',lighting:'整体光照',camera:'参考机位与构图'};
const differences={close:'接近参考',minor_difference:'局部差异',major_difference:'明显差异',unverified:'未核实'};
const levels={close:'可见范围接近参考',broadly_consistent:'大体一致',major_differences:'存在明显差异',unverified:'证据不足，尚未核实'};
export function imageReconstructionHTML(job){
 const best=job.delivery?.best,goal=best?.reconstructionGoal??job.reconstructionGoal;
 if(!goal)return '';
 // The delivered candidate can be an earlier iteration; never borrow the root report.
 const stored=best?best.imageReconstruction:job.imageReconstruction;
 const partial=best&&best.kind!=='scene',hash=best?best.distManifestDigest:job.runtime?.distManifestDigest;
 const mismatch=stored&&(stored.goalId!==goal.id||stored.distManifestDigest!==hash||partial&&stored.status==='passed');
 const report=mismatch?{status:'needs_review',level:'unverified',scope:partial?'partial':'complete',references:[],reasons:['当前选中候选与原图对照证据不匹配；历史报告保留，不能用于声明当前场景一致。']}:stored??(best?{status:'needs_review',level:'unverified',scope:partial?'partial':'complete',references:[],reasons:['当前保留候选没有有效的原图对照报告，不能借用其他候选的判定。']}:null);
 const path=best?best.imageReconstructionFile:'image-reconstruction.json';
 const reportLink=typeof path==='string'&&path&&!path.startsWith('/')&&path.split('/').every(p=>p&&p!=='.'&&p!=='..')?`<a href="/files/runs/${encodeURIComponent(job.id)}/${path.split('/').map(encodeURIComponent).join('/')}" target="_blank">原图对照报告 →</a>`:'';
 const status=report?.status??'pending';
 const title=report?levels[report.level]??'尚未核实':'等待成品原图对照';
 return `<section class="card"><div class="card-heading"><h2>原图还原对照</h2><span class="badge ${esc(status)}">${esc(title)}</span></div><p>目标：尽量复现全部参考图，至少保持主要结构、布局、轮廓、材质、光照与机位大体一致，允许局部细节差异。</p><p class="hint">基础交付评分与原图对照分别记录；接近参考不表示像素完全相同。</p>${report?`${report.scope==='partial'?'<p class="callout">当前是空间或资产未齐的草稿，不能据此声明成品还原通过。</p>':''}${report.reasons?.length?`<ul class="issues">${report.reasons.map(r=>`<li>${esc(r)}</li>`).join('')}</ul>`:''}<details><summary>逐张参考图与视觉属性</summary>${(report.references??[]).map(r=>`<h3>参考图 ${esc(r.referenceIndex)}</h3><table><thead><tr><th>属性</th><th>对照结果</th><th>依据与差距</th></tr></thead><tbody>${Object.entries(labels).map(([id,label])=>`<tr><td>${label}</td><td>${esc(differences[r.attributes[id]?.status]??'未核实')}</td><td>${esc(r.attributes[id]?.reason)}</td></tr>`).join('')}</tbody></table>`).join('')}</details>${reportLink}`:'<p>灰模检查与资产预览不能代替完整场景的原图还原评审。</p>'}</section>`;
}
