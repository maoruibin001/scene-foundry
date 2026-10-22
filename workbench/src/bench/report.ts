const esc=(x:any)=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const num=(v:any,d=1)=>Number.isFinite(v)?(+v).toFixed(d):'—';

/** Static bench report: reference | baseline | current per camera, with colour, FPS and regression tables. */
export function benchReportHTML(report:any){
 const prior=report.baseline?'基准':'原交付';
 const rows=report.results.map((r:any)=>{
  if(r.skipped||r.error)return `<section><h2>${esc(r.id)}</h2><p class="${r.error?'bad':'muted'}">${esc(r.skipped??r.error)}</p></section>`;
  const fps=r.fps?.system,regress=r.regressions??[];
  const views=r.frames.map((f:any)=>{const g=r.colour.references.find((c:any)=>c.referenceIndex===f.referenceIndex);
   return `<figure><div class="row"><img src="${esc(f.reference)}" alt="参考"><img src="${esc(f.baseline??'')}" alt="${f.baseline?prior:'无对照'}"><img src="${esc(f.frame)}" alt="当前"></div>
    <figcaption>机位 ${f.referenceIndex} · 参考 / ${prior} / 当前 · 整体 ΔL ${num(g?.global?.dL)} Δ彩度 ${num(g?.global?.dChroma)}${Number.isFinite(g?.baselineDiffL)?` · 相对${prior} |ΔL| ${num(g.baselineDiffL)}`:''}</figcaption></figure>`;}).join('');
  const off=r.offLandmarks.slice(0,10).map((l:any)=>`<tr><td>${esc(l.label)}</td><td>${l.referenceIndex}</td><td>${num(l.dL)}</td><td>${num(l.dChroma)}</td><td>${num(l.dHue,0)}°</td></tr>`).join('');
  return `<section><h2>${esc(r.id)} <small>${esc(r.kind)} · 交付分 ${num(r.deliveredScore,2)} · ${Math.round(r.durationMs/1000)}s</small></h2>
   <p>系统 Chrome DPR2：<b class="${Number.isFinite(fps?.median)&&fps.median<report.limits.minSystemFps?'bad':''}">${esc(fps?.median??fps?.error??'—')} FPS</b> ${fps?.canvas?`（画布 ${fps.canvas.join('×')}）`:''}</p>
   ${regress.length?`<p class="bad">相对基准退化 ${regress.length} 项：${esc(regress.map((x:any)=>x.kind+(x.label?' '+x.label:'')+(x.before!==undefined?` ${x.before}→${x.after}`:'')).join('；'))}</p>`:report.baseline?'<p class="good">相对基准无退化</p>':''}
   ${views}
   ${(r.inspection??[]).length?`<details open><summary>检查机位（无参考图，${prior} / 当前）</summary>${r.inspection.map((f:any)=>`<figure><div class="row two"><img src="${esc(f.baseline??'')}" alt="${f.baseline?prior:'无对照'}"><img src="${esc(f.frame)}" alt="当前"></div><figcaption>${esc(f.camera)}</figcaption></figure>`).join('')}</details>`:''}
   ${off?`<details open><summary>偏离参考的地标（|ΔL|或|Δ彩度| &gt; ${report.limits.landmarkL}）</summary><table><tr><th>地标</th><th>机位</th><th>ΔL</th><th>Δ彩度</th><th>Δ色相</th></tr>${off}</table></details>`:'<p class="good">地标颜色都在限值内</p>'}</section>`;}).join('');
 return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>场景回放基准</title>
<style>body{font:14px/1.6 system-ui,sans-serif;margin:24px;background:#fafaf7;color:#223}section{background:#fff;border:1px solid #dde;border-radius:10px;padding:16px;margin:16px 0}
.row{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.row.two{grid-template-columns:repeat(2,1fr)}.row img{width:100%;border-radius:6px;background:#eee;min-height:40px}figure{margin:12px 0}figcaption{font-size:12px;color:#667}
table{border-collapse:collapse;font-size:13px}td,th{border-bottom:1px solid #eee;padding:3px 10px;text-align:left}.bad{color:#b3261e}.good{color:#2e7d32}.muted{color:#889}small{color:#889;font-weight:normal}</style></head>
<body><h1>场景回放基准</h1><p>${esc(report.createdAt)} · 场景集 ${esc(report.set)} · 基准 ${esc(report.baseline??'无')}。不调用模型：用当前代码重新导出、构建并渲染已生成的场景。ΔL 为 CIELAB 亮度差（负值表示比参考暗），只比较观察框内平均色，框内含背景与遮挡。</p>${rows}</body></html>`;
}
