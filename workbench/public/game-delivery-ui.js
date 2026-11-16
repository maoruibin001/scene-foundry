const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const localPreview=value=>{try{const u=new URL(value);return u.protocol==='http:'&&['127.0.0.1','localhost'].includes(u.hostname)?u.href:null;}catch{return null;}};
const fileURL=value=>typeof value==='string'&&value.startsWith('/files/diagnostics/')&&!value.includes('..')?value:null;
export function gameDeliveryCards(data){return (data?.items??[]).flatMap(d=>{
 const preview=localPreview(d.previewUrl),report=fileURL(d.reportUrl),cover=fileURL(d.coverUrl);
 if(!preview||!report||!cover||!d.playPassed)return [];
 return [`<section class="card" data-game-delivery="${esc(d.id)}"><p class="hint">最新已回接场景 · ${esc(d.updatedAt)}</p><h2>${esc(d.title)}</h2><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:20px;align-items:center"><a href="${esc(preview)}" target="_blank" rel="noopener"><img style="width:100%;border-radius:12px" src="${esc(cover)}" alt="最新大厅真实游戏截图"></a><div><p>${esc(d.summary)}</p><p>正常入口与交互验收通过。性能专项待处理；历史评分单独保留。</p><div class="actions"><a class="button primary" href="${esc(preview)}" target="_blank" rel="noopener">打开最新场景 ↗</a><a class="button" href="${esc(report)}" target="_blank" rel="noopener">截图、视频与验收记录</a><a href="#job/${esc(d.sourceJobId)}">原始管线记录 →</a></div></div></div>${data.viewOnly?'<p class="hint">当前入口仅浏览：不会启动生成、重试或自动恢复。已有场景可正常打开。</p>':''}</section>`];
 }).join('');}
