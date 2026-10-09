const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function spatialDiagnosisHTML(job,currentVersion,options={}){
 const origin=job.spatialDiagnosis?`<section class="card"><h2>依据几何证据修正空间</h2><p>沿用原始输入与需求，使用<a href="#job/${esc(job.spatialRepairSource.jobId)}">来源第 ${job.spatialRepairSource.round+1} 轮灰模</a>作为修改依据；来源评分保留，本次不是新独立样本或执行恢复。</p><p>${esc(job.spatialDiagnosis.reason)}</p><p class="hint">先提交局部补丁，再正常运行与独立验收。空间灰模通过后才生成详细资产，成品仍按70分基础交付验收。</p></section>`:'';
 if(job.generationMode!=='qualified'||!['failed','needs_review'].includes(job.status)||job.sceneProgram||job.blockout?.status!=='stopped')return origin;
 const finite=job.improvement?.limits?.repairs!==null||job.improvement?.limits?.calls!==null;
 const stopped=job.improvement?.stopped??'',qualityStop=stopped.startsWith('同一评审契约连续两轮'),repairStop=finite&&/^(累计修复 \d+\/\d+ 次，已达到上限|灰模与成品已共用 \d+ 次修正额度)/.test(stopped);
 if(!qualityStop&&!(options.allowFiniteRevisions&&repairStop))return origin;
 if(finite&&(!options.allowFiniteRevisions||(job.improvement.limits.calls!==null&&job.improvement.calls+4>job.improvement.limits.calls)))return origin;
 const rounds=(job.blockout.rounds??[]).filter(r=>r.passed===false&&Number.isFinite(r.review?.score)&&Number.isFinite(r.endedAt));if(!rounds.length)return origin;
 const basis=[...rounds].sort((a,b)=>b.review.score-a.review.score||a.round-b.round)[0];
 const changed=job.spatialMechanismChangeAvailable!==false&&currentVersion?.id&&currentVersion.id!==job.pipelineVersion?.id;
 return origin+`<section class="card"><h2>按诊断修正空间</h2><p>当前路径已停止。只有已经验证的新机制才能继续；原输入、累计调用、原始评分和失败记录保留。</p>${changed?`<label>灰模修改依据<select id="spatial-basis">${rounds.map(r=>`<option value="${r.round}" ${r.round===basis.round?'selected':''}>第 ${r.round+1} 轮 · ${r.review.score}/5 · 未通过</option>`).join('')}</select></label><p class="hint">分数最高、同分最早的一轮默认作为修改依据，不改标成品最佳或合格。</p><label>失败证据与已验证机制<textarea id="spatial-diagnosed-strategy" rows="5" minlength="40" maxlength="6000"></textarea></label>${finite?'<label>本次修复上限<select id="spatial-additional-repairs"><option value="2">最多追加 2 次修复</option><option value="1">最多追加 1 次修复</option></select></label><p class="hint">保留累计修复、调用和历史评分；不增加调用预算，同一冻结版本只能启动一次有依据的修复。</p>':''}<button id="spatial-refine" class="primary">提交局部空间修正</button>`:'<p>当前没有新的空间生成机制可用，保留结果与原始评分；请先验证新机制再继续。</p>'}</section>`;
}
