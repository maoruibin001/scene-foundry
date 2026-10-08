const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sourceId=j=>j.spatialRepairSource?.jobId||j.reuseAssessmentFrom||j.recoverySourceJobId||j.automaticRecoveryFrom||j.reuseSceneFrom;
const continuation=j=>j.spatialRepairSource?'空间质量修正':j.reuseAssessmentFrom?'重新评估':j.recoverySourceJobId||j.automaticRecoveryFrom?'执行恢复':j.refineScene?'场景修正':j.reuseSceneFrom?'基于已有场景继续':null;
export function jobOriginHTML(j){
 const kind=continuation(j),source=sourceId(j);
 if(kind)return `${kind} · ${source?`<a href="#job/${esc(source)}">查看来源记录</a> · `:''}沿用原输入与已保存产物，累计耗时保留`;
 return j.reuseMode==='fresh'?'完全从头生成 · 跨任务缓存关闭；技术恢复只沿本次任务继续':'优先复用已验证产物';
}
export function deliveryLimitation(d){const b=d.best;return b?.deliveryStandard==='basic70'&&b?.deliveryStatus==='passed'?(d.limitations??'').replace('当前质量未达标','70分基础交付已通过，80分完整规范尚未通过'):(d.limitations??'');}
export function deliveryHTML(j){
 const d=j.delivery;if(!d)return '';
 if(!d.available){
  const kind=continuation(j),source=sourceId(j);
  return `<section class="card delivery"><h2>${d.state==='pending'?(kind?'正在准备本次'+kind+'结果':'正在准备首个场景输出'):(kind?'本次'+kind+'尚无可运行结果':'尚未生成可运行输出')}</h2><p>${esc(d.execution.fault?.reason??(kind?'从已保存进度继续，来源产物和历史评分保留。':'先完成空间草稿，再逐步补齐详细资产。'))}</p>${source?`<p><a href="#job/${esc(source)}">查看来源输出与状态</a></p>`:''}${d.state==='unavailable'?'<p>这是本次交付失败，已有输入、来源产物和诊断保留；不能记为生成成功。</p>':''}</section>`;
 }
 const b=d.best,title=b.kind==='graybox'?'空间草稿已可查看':b.kind==='partial'?'部分场景已可查看':'场景输出已可查看';
 const quality=b.deliveryStandard==='basic70'&&b.deliveryStatus==='passed'?'70分基础交付通过；完整规范结果另列':b.qualityStatus==='passed'?'正式验收通过':b.qualityStatus==='partial_assessed'?'草稿已评分，成品尚未完成':b.qualityStatus==='not_met'?'已评分，未达标':'未完成成品评分';
 return `<section class="card delivery"><h2>${title}</h2><p><b>${quality}</b>${b.score!==null?' · '+esc(b.score)+' 分':''} · ForgeaX Engine 实际运行画面</p><p>${esc(deliveryLimitation(d))}</p>${d.selection?.reason?`<p class="callout">${esc(d.selection.reason)}</p>`:''}${d.execution.fault?`<p class="callout">${esc(d.execution.fault.reason)}</p><details><summary>停止原因与恢复依据</summary><pre>${esc(d.execution.error)}</pre><p>${esc(j.recovery?.reason??'已有结果保留，按具体故障修复后恢复。')}</p></details>`:''}${d.partial?.missing?.length?`<p>详细资产完成 ${esc(d.partial.completed)}/${esc(d.partial.total)}；仍使用本次灰模：${d.partial.missing.map(x=>esc(x.label)).join('、')}。</p>`:''}${j.assemblyOptimization?.changes?.length?`<p class="callout">组装时降低了程序化散布密度：三角形 ${j.assemblyOptimization.before} → ${j.assemblyOptimization.after}；原始资产保留，画面仍需验收。</p>`:''}<div class="shots">${b.images.slice(0,2).map(p=>`<a href="/files/runs/${esc(j.id)}/${esc(p)}" target="_blank"><img src="/files/runs/${esc(j.id)}/${esc(p)}" alt="${title}"></a>`).join('')}</div><div class="actions"><button id="preview-output">打开已有输出</button><a class="button" href="/api/jobs/${esc(j.id)}/download-output">下载已有输出 ↓</a><a href="/files/runs/${esc(j.id)}/${esc(b.runtime)}">运行证据</a></div><p class="hint">执行进度、交付状态、质量评分分别记录。中断或未达标不会隐藏已有输出；草稿不会计为成品通过。</p></section>`;
}
