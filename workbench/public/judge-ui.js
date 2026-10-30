// Graybox round rendering for object3d-gate-v1: the measured judge decides, the model review is repair feedback only.
// Rounds without object3d (older policies) keep the review line the page always showed.
const OBJECT3D_LIMIT=.35;
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const CHECKS={'critical-visible':'关键地标在参考机位可见','not-mirrored':'无左右镜像','camera-clear':'参考机位有净空','object3d':'地标三维位置误差'};

export function object3dPolicyDescription(job){
  if(job.object3dGatePolicy?.version!=='object3d-gate-v1')return null;
  return '空间评委 object3d：逐个地标比较灰模中物体与参考图单目三维测量的位置（离相机远近、在画面中的位置），平均误差 ≤0.35，且关键地标可见、无左右镜像、机位有净空即放行；不调用模型。模型评审分只作修复反馈，不决定放行。';
}

export function grayboxRoundHTML(j,r,file){
  const shots=`<div class="shots">${r.frames.map(f=>`<a href="${file(j,r.path+'/runtime/'+f)}" target="_blank"><img src="${file(j,r.path+'/runtime/'+f)}" alt="灰模参考机位"></a>`).join('')}</div>`;
  if(!r.object3d)return `<p>第 ${r.round+1} 轮（已结束）：${r.review.score}/5 · ${r.passed?'通过':'未通过'} · ${escape(r.review.summary)} · <a href="${file(j,r.path+'/gate.json')}">关系评分与证据</a></p>${shots}`;
  const o=r.object3d,checks=r.objective?.checks??[];
  const rows=checks.map(c=>`<tr><td>${c.passed?'✓':'<span class="failed">✗</span>'}</td><td>${escape(CHECKS[c.id]??c.id)}</td><td>${escape(c.detail)}</td></tr>`).join('');
  const bar=Math.max(0,Math.min(100,(1-o.score)*100));
  return `<div class="req">
   <div class="score-row"><span><b>第 ${r.round+1} 轮</b> · ${r.passed?'<span class="badge passed">通过</span>':'<span class="badge failed">未通过</span>'}</span>
    <span>空间评委 object3d <b>${o.score.toFixed(2)}</b> / 上限 ${OBJECT3D_LIMIT}（越低越好）</span></div>
   <div class="bar" title="1 − 误差"><i style="width:${bar}%"></i></div>
   <div class="table-wrap"><table><tr><th></th><th>检查项</th><th>实测</th></tr>${rows}</table></div>
   <p class="hint">${o.rows} 个地标视图，其中 ${o.invisible} 个在参考机位不可见。模型评审 ${r.review.score}/5（仅作修复反馈）：${escape(r.review.summary)}</p>
   <details data-o3d="${file(j,r.path+'/object3d.json')}"><summary>逐地标位置误差（关键地标在前，按误差从大到小）</summary><div class="o3d-rows">加载中…</div></details>
   <p class="hint"><a href="${file(j,r.path+'/object3d.json')}" target="_blank">object3d 原始数据</a> · <a href="${file(j,r.path+'/gate.json')}" target="_blank">门禁与评审证据</a></p>
  </div>${shots}`;
}

function issue(x){
  if(!x.visible)return '不可见';
  if(x.depthRatio==null)return '位置偏差';
  if(x.depthRatio<.85)return '离相机过近（约原图 '+Math.round(x.depthRatio*100)+'%）';
  if(x.depthRatio>1.15)return '离相机过远（约原图 '+Math.round(x.depthRatio*100)+'%）';
  return '画面内偏移';
}
// Landmark rows load when the reader opens them; toggle does not bubble, so listen in the capture phase.
document.addEventListener('toggle',async e=>{
  const d=e.target;if(!(d instanceof HTMLDetailsElement)||!d.open||!d.dataset.o3d||d.dataset.loaded)return;d.dataset.loaded='1';
  const box=d.querySelector('.o3d-rows');
  try{
    const r=await (await fetch(d.dataset.o3d)).json();
    const rows=[...r.landmarks].sort((a,b)=>(b.critical-a.critical)||(b.error-a.error));
    box.innerHTML=`<div class="table-wrap"><table><tr><th>地标</th><th>机位</th><th>关键</th><th>误差</th><th>判断</th></tr>${rows.map(x=>`<tr><td>${escape(x.label??x.landmarkId)}</td><td>${x.referenceIndex}</td><td>${x.critical?'是':''}</td><td>${x.error>=OBJECT3D_LIMIT?`<span class="failed">${x.error.toFixed(2)}</span>`:x.error.toFixed(2)}</td><td>${escape(issue(x))}</td></tr>`).join('')}</table></div>`;
  }catch(err){box.textContent='无法读取逐地标数据：'+err;}
},true);
