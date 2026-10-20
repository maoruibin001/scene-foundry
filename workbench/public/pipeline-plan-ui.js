import {scenePath} from './scene-context.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={coverage:'需求实现',spatial:'空间与构图',shape:'主体形态',material:'材质与色彩',lighting:'光照与氛围',readability:'画面可读性'};
const ids=['coverage','spatial','shape','material','lighting','readability'];
const legacyIds=ids.filter(id=>id!=='lighting');
const drafts=new Map(),pendingReweights=new Set(),savedDrafts=new Map();

export function validateScoreWeights(weights,dimensions=ids){
 if(!weights||typeof weights!=='object'||Array.isArray(weights)||Object.keys(weights).length!==dimensions.length||dimensions.some(id=>!Object.hasOwn(weights,id)))throw Error('评分权重必须覆盖本次全部评审维度');
 if(dimensions.some(id=>!Number.isInteger(weights[id])||weights[id]<0||weights[id]>100))throw Error('每项权重须为 0–100 的整数');
 if(dimensions.reduce((sum,id)=>sum+weights[id],0)!==100)throw Error('权重合计须为 100%');
 return {...weights};
}

/** Largest remainder keeps integer weights and an exact total without changing dimension order. */
export function normalizeScoreWeights(weights,dimensions=ids){
 if(!weights||Object.keys(weights).length!==dimensions.length||dimensions.some(id=>!Number.isInteger(weights[id])||weights[id]<0||weights[id]>100))throw Error('先填写每项 0–100 的整数，再按比例归一化');
 const total=dimensions.reduce((sum,id)=>sum+weights[id],0);if(!total)throw Error('至少有一项权重大于 0，才能按比例归一化');
 const rows=dimensions.map((id,index)=>({id,index,exact:weights[id]*100/total}));
 const result=Object.fromEntries(rows.map(row=>[row.id,Math.floor(row.exact)]));
 const remaining=100-Object.values(result).reduce((sum,n)=>sum+n,0);
 rows.sort((a,b)=>(b.exact-Math.floor(b.exact))-(a.exact-Math.floor(a.exact))||a.index-b.index);
 for(const row of rows.slice(0,remaining))result[row.id]++;
 return validateScoreWeights(result,dimensions);
}

export function validatePresetCatalog(catalog){
 if(!catalog?.version||!Array.isArray(catalog.dimensions)||!Array.isArray(catalog.presets))throw Error('管线预设未加载完整，请重试读取');
 const dimensions=catalog.dimensions.map(d=>typeof d==='string'?d:d.id);
 if(dimensions.length!==ids.length||new Set(dimensions).size!==ids.length||ids.some(id=>!dimensions.includes(id)))throw Error('管线预设的评审维度与当前界面不一致');
 const presetIds=catalog.presets.map(p=>p.id);
 if(presetIds.length!==4||new Set(presetIds).size!==4||['balanced','spatial','assets','effects'].some(id=>!presetIds.includes(id)))throw Error('管线预设清单不完整');
 for(const preset of catalog.presets)validateScoreWeights(preset.weights,dimensions);
 return catalog;
}

const dimensionLabel=(dimension)=>typeof dimension==='string'?(labels[dimension]??dimension):(dimension.label??labels[dimension.id]??dimension.id);
const focusItems=focus=>Array.isArray(focus)?focus:focus&&typeof focus==='object'?Object.values(focus):focus?[focus]:[];
const itemText=item=>typeof item==='string'?(labels[item]??item):(item?.reason??item?.label??item?.description??item?.id??'');
const capabilityRows=capabilities=>Array.isArray(capabilities)?capabilities:Object.entries(capabilities??{}).map(([id,value])=>typeof value==='object'?{id,...value}:{id,available:value===true});
const unavailable=capability=>capability?.available===false||capability?.enabled===false||['unavailable','not-integrated','unsupported','planned'].includes(capability?.state??capability?.status);
const toolText=(tool,capabilities)=>{
 const id=typeof tool==='string'?tool:tool?.id;
 const capability=capabilityRows(capabilities).find(c=>c.id===id),row=typeof tool==='object'?tool:capability;
 return `<li>${esc(row?.label??capability?.label??id)}${unavailable(row)||unavailable(capability)?' · 未接入':''}${row?.reason||row?.scope?`<span class="hint">${esc(row.reason??row.scope)}</span>`:''}</li>`;
};

export function weightEditorHTML(weights,dimensions,{prefix='pipeline',disabled=false}={}){
 return `<div class="pipeline-weight-grid">${dimensions.map(d=>{const id=typeof d==='string'?d:d.id;return `<label for="${esc(prefix+'-'+id)}">${esc(dimensionLabel(d))}<span><input id="${esc(prefix+'-'+id)}" data-score-weight="${esc(id)}" type="number" min="0" max="100" step="1" inputmode="numeric" value="${esc(weights[id])}"${disabled?' disabled':''}> %</span></label>`;}).join('')}</div>`;
}
const readWeights=root=>Object.fromEntries([...root.querySelectorAll('[data-score-weight]')].map(input=>[input.dataset.scoreWeight,input.value.trim()===''?NaN:Number(input.value)]));
const setWeights=(root,weights)=>{for(const input of root.querySelectorAll('[data-score-weight]'))input.value=String(weights[input.dataset.scoreWeight]);};
function showWeightValidity(root,dimensions){
 const weights=readWeights(root),status=root.querySelector('[data-weight-status]');
 let valid=true,message;try{validateScoreWeights(weights,dimensions);message='合计 100% · 权重有效';}catch(error){valid=false;const total=Object.values(weights).reduce((sum,n)=>sum+n,0);message=(Number.isFinite(total)?'当前合计 '+total+'% · ':'')+error.message;}
 if(status){status.textContent=message;status.classList.toggle('failed',!valid);}
 return valid;
}

export function createPipelinePlanSelector({container,api,onChange=()=>{},onError=()=>{},isActive=()=>true}){
 let catalog,presetId='balanced',ready=false;
 const selection=()=>{if(!ready)throw Error('请先读取并确认制作管线');return {pipelinePreset:presetId,scoreWeights:validateScoreWeights(readWeights(container),ids)};};
 function render(){
  const preset=catalog.presets.find(p=>p.id===presetId);
  container.innerHTML=`<fieldset class="pipeline-settings"><legend>制作管线与关注重点</legend><p class="hint">选择制作重点，工具和阶段按任务冻结。仍使用当前 Codex；关键需求、真实运行和结构底线必须通过。</p><p class="pipeline-target"><b>本次目标：所选权重综合分 ≥70</b>（原始加权分单列参考）<br><span class="hint">完整场景、关键需求、空间与真实运行底线必须通过；达标即停止提分。原 80 分规范结果单列，不作为本预设的提分目标。</span></p><div class="pipeline-preset-options">${catalog.presets.map(p=>`<label><input type="radio" name="pipeline-preset" value="${esc(p.id)}"${p.id===presetId?' checked':''}><span><b>${esc(p.label)}</b><small>${esc(p.description)}</small></span></label>`).join('')}</div><div class="pipeline-focus"><b>${esc(preset.label)} · 实际制作重点</b><ul>${focusItems(preset.focus).map(item=>`<li>${esc(itemText(item))}</li>`).join('')}</ul><p class="pipeline-frozen-weights" data-active-weights></p><p class="hint">光照与氛围单独评审，材质表现不会代替光照得分。</p><details><summary>本管线可用工具与边界</summary><ul>${(preset.tools??[]).map(tool=>toolText(tool,catalog.capabilities)).join('')}</ul>${capabilityRows(catalog.capabilities).filter(unavailable).map(c=>`<p class="hint">${esc(c.label??c.id)} · 未接入${c.reason||c.scope?'：'+esc(c.reason??c.scope):''}</p>`).join('')}</details></div><details class="pipeline-weight-settings"><summary>调整六项评分权重</summary><p class="hint">每项 0–100 的整数，合计 100%。它们决定制作和修正的优先级，不能豁免关键缺失和真实运行失败。</p>${weightEditorHTML(preset.weights,catalog.dimensions)}<div class="pipeline-weight-actions"><button type="button" data-weight-reset>恢复此预设默认</button><button type="button" data-weight-normalize>按比例归一化</button></div><p class="hint" data-weight-status aria-live="polite"></p></details><p class="hint">制作预设 ${esc(catalog.version)} · 预设、权重、工具和执行阶段随本次任务保存。${catalog.weightsCalibrated===false?'六维预设仍需真实场景校准。':''}</p></fieldset>`;
  for(const radio of container.querySelectorAll('[name="pipeline-preset"]'))radio.onchange=()=>{presetId=radio.value;render();onChange();};
  const changed=()=>{ready=showWeightValidity(container,ids);const active=container.querySelector('[data-active-weights]'),weights=readWeights(container);if(active)active.textContent='本次权重：'+catalog.dimensions.map(d=>{const id=typeof d==='string'?d:d.id;return dimensionLabel(d)+' '+(Number.isFinite(weights[id])?weights[id]+'%':'未填写');}).join(' · ');onChange();};
  for(const input of container.querySelectorAll('[data-score-weight]'))input.oninput=changed;
  container.querySelector('[data-weight-reset]').onclick=()=>{setWeights(container,preset.weights);changed();};
  container.querySelector('[data-weight-normalize]').onclick=()=>{try{setWeights(container,normalizeScoreWeights(readWeights(container)));changed();}catch(error){onError(error);changed();}};
  changed();
 }
 async function load(){
  ready=false;container.innerHTML='<fieldset class="pipeline-settings"><legend>制作管线与关注重点</legend><p class="hint">正在读取可用管线…</p></fieldset>';onChange();
  try{const result=validatePresetCatalog(await api('/api/pipeline-presets'));if(!isActive())return;catalog=result;render();}
  catch(error){if(!isActive())return;container.innerHTML='<fieldset class="pipeline-settings"><legend>制作管线与关注重点</legend><p class="failed">未能读取制作管线，暂不能提交。</p><button type="button" data-pipeline-retry>重新读取管线</button></fieldset>';container.querySelector('[data-pipeline-retry]').onclick=load;onError(error);onChange();}
 }
 void load();return {ready:()=>ready,selection};
}

/** Reweight only dimensions independently assessed for this candidate; old five-dimensional reports stay five-dimensional. */
export function scoredWeightDimensions(job){
 const raw=job.review?.dimensions,weighted=job.quality?.dimensions;
 if(!Array.isArray(raw)||!Array.isArray(weighted))return null;
 const rawIds=raw.map(d=>d.id),expected=rawIds.includes('lighting')?ids:legacyIds;
 if(rawIds.length!==expected.length||new Set(rawIds).size!==expected.length||expected.some(id=>!rawIds.includes(id)))return null;
 if(raw.some(d=>!Number.isFinite(d.score)||d.score<0||d.score>5))return null;
 if(weighted.length!==expected.length||new Set(weighted.map(d=>d.id)).size!==expected.length||expected.some(id=>!weighted.some(d=>d.id===id)))return null;
 const dimensions=expected.map(id=>({id,label:weighted.find(d=>d.id===id).label??labels[id]}));
 try{validateScoreWeights(Object.fromEntries(weighted.map(d=>[d.id,d.weight])),expected);}catch{return null;}
 return dimensions;
}

export function previewWeightedScore(job,weights){
 const dimensions=scoredWeightDimensions(job);if(!dimensions)return null;
 validateScoreWeights(weights,dimensions.map(d=>d.id));
 return Math.round(job.review.dimensions.reduce((sum,d)=>sum+d.score/5*weights[d.id],0)*100)/100;
}

/** Matches the server's sealed full-candidate guard; independent scores alone do not make a draft deliverable. */
export function reweightEligibility(job){
 if(job.partialOutput||job.assessmentScope==='partial'||job.delivery?.best?.assessmentScope==='partial')return {available:false,reason:'当前仅有部分草稿；可查看原评分，但不能保存完整场景的重算回执。'};
 const output=job.delivery?.best;
 if(!output||output.assessmentScope!=='scene'||output.assessmentError||!output.qualityFile||!job.runtime?.distManifestDigest||output.distManifestDigest!==job.runtime.distManifestDigest)return {available:false,reason:'缺少与原评审一致的已封存完整候选；原产物和评分保留，暂不能重算完整场景。'};
 if(['queued','running'].includes(job.status)||job.recovery?.mode==='active')return {available:false,reason:'本任务仍在执行或保存停止进度，结束后可保存重算回执。',pending:true};
 return {available:true};
}

export function pipelinePlanHTML(job){
 const plan=job.pipelinePlan;if(!plan)return '';
 const dimensions=Object.keys(plan.weights??{}).map(id=>({id,label:labels[id]??id}));
 return `<section class="card pipeline-plan-card"><div class="card-heading"><h2>本次冻结的制作管线</h2><b>${esc(plan.label??plan.presetId)}</b></div><p>${focusItems(plan.focus).map(item=>esc(itemText(item))).join(' · ')}</p><p class="pipeline-frozen-weights">${dimensions.map(d=>`${esc(d.label)} ${esc(plan.weights[d.id])}%`).join(' · ')}</p>${plan.scoring?`<p class="pipeline-target">本次冻结目标：综合分 ≥${esc(plan.scoring.minimumScore)}，${plan.scoring.rawMinimumScore===null?'原始加权分单列参考':'原始加权分 ≥'+esc(plan.scoring.rawMinimumScore)}；完整场景与共同底线必须通过。原 80 分规范结果单列。</p>`:''}<ol class="pipeline-stage-list">${(plan.stages??[]).map(stage=>{const row=typeof stage==='string'?{id:stage,label:stage}:stage;const status=job.stages?.[row.id]?.status??(job.stage===row.id&&job.status==='running'?'running':null);return `<li><b>${esc(row.label??row.id)}</b>${status?`<span class="hint">${esc({passed:'已完成',running:'进行中',failed:'未完成',pending:'待执行',cancelled:'已停止'}[status]??status)}</span>`:''}${row.reason?`<p class="hint">${esc(row.reason)}</p>`:''}</li>`;}).join('')}</ol><details><summary>工具与资源</summary><ul>${(plan.tools??[]).map(tool=>toolText(tool,plan.capabilities??{})).join('')}</ul><p class="hint">制作计划 ${esc(plan.version)} · 任务创建时固定。结果重算不会改变已执行阶段。</p></details></section>`;
}

/** The original profile result keeps score goals, common safeguards and the legacy projection separate. */
export function profileAssessmentHTML(job){
 if(job.deliveryAssessment?.standard!=='profile70'&&job.policy?.deliveryStandard!=='profile70')return '';
 const verdict=status=>({passed:'通过',failed:'未通过',needs_review:'待复核'}[status]??'未核实');
 const scores=row=>`综合分 ${Number.isFinite(row?.score)?row.score.toFixed(2):'未提供'} · 原始加权分 ${Number.isFinite(row?.rawScore)?row.rawScore.toFixed(2):'未提供'}`;
 const issues=row=>{
  const reasons=(row?.reasons??[]).map(itemText).filter(Boolean),warnings=(row?.warnings??[]).map(itemText).filter(Boolean);
  return `${reasons.length?`<ul class="issues">${reasons.map(reason=>`<li>${esc(reason)}</li>`).join('')}</ul>`:''}${warnings.length?`<details open><summary>保留警告 · ${warnings.length} 项</summary><ul>${warnings.map(warning=>`<li>${esc(warning)}</li>`).join('')}</ul></details>`:''}`;
 };
 const delivery=job.deliveryAssessment,goal=job.goalAssessment,common=job.commonDeliveryAssessment,benchmark=job.defaultBenchmarkAssessment;
 return `<section class="pipeline-profile-assessment"><h3>本次冻结权重交付：${esc(verdict(delivery?.status))}</h3><p class="hint">本次目标与共同底线同时通过，才算达到所选制作管线的要求；维度评审状态不替代交付结论。</p><div class="pipeline-reweight-verdicts"><h4>所选权重目标：${esc(verdict(goal?.status))}</h4><p>${scores(goal)} · 两者均须 ≥70</p>${issues(goal)}</div><div class="pipeline-reweight-verdicts"><h4>完整性与运行共同底线：${esc(verdict(common?.status))}</h4><p class="hint">完整资产、关键主体、结构、真实Engine、必需规范与可信评分；权重为零也不豁免。</p>${issues(common)}</div><div class="pipeline-reweight-verdicts"><h4>旧固定权重基准</h4>${benchmark?`<p>旧基础70：${esc(verdict(benchmark.status))} · 旧80规范：${esc(verdict(benchmark.strictStatus))}</p><p>${scores(benchmark)}</p>${issues(benchmark)}`:'<p>尚无基准回执，不能推断旧70或80通过。</p>'}<p class="hint">由本次v8已有五维投影，非独立v7评审；仅供对照，不决定本次目标通过，也不改写历史结果。</p></div>${delivery?issues(delivery):''}<p class="hint">原图还原在“原图还原对照”中单列；目标70通过不等于高还原。</p></section>`;
}

function receiptHTML(receipt){
 const weighted=receipt.weightedScore??receipt.score,raw=receipt.rawWeightedScore??receipt.rawScore;
 const states={passed:'通过',failed:'未通过',needs_review:'待复核'},verdict=status=>states[status]??'未记录';
 const reasons=[...new Set([...(receipt.reasons??[]),...(receipt.commonDeliveryAssessment?.reasons??[]),...(receipt.goalAssessment?.reasons??[])].map(itemText).filter(Boolean))];
 const warnings=receipt.warnings??receipt.commonDeliveryAssessment?.warnings??[];
 return `<li><div class="pipeline-reweight-verdicts"><b>独立重算回执：${esc(verdict(receipt.status))}</b><span>当前权重目标：${esc(verdict(receipt.goalAssessment?.status))}</span><span>完整性与运行底线：${esc(verdict(receipt.commonDeliveryAssessment?.status))}</span></div><b>重算分 ${Number.isFinite(weighted)?weighted.toFixed(2):'未提供'}${Number.isFinite(raw)?' · 原始维度 '+raw.toFixed(2):''}</b>${reasons.length?`<ul class="issues">${reasons.map(reason=>`<li>${esc(reason)}</li>`).join('')}</ul>`:''}${warnings.length?`<details open><summary>保留警告 · ${warnings.length} 项</summary><ul>${warnings.map(warning=>`<li>${esc(itemText(warning))}</li>`).join('')}</ul></details>`:''}<p class="hint">${Object.entries(receipt.weights??receipt.dimensionWeights??{}).map(([id,weight])=>`${esc(labels[id]??id)} ${esc(weight)}%`).join(' · ')}</p><p class="hint">${esc(receipt.createdAt?new Date(receipt.createdAt).toLocaleString():'时间未记录')} · 独立回执 ${esc(receipt.id??'')}</p>${receipt.sourceJobId&&/^[a-f0-9]{64}$/.test(receipt.id??'')?`<p><a href="${scenePath(`/files/runs/${encodeURIComponent(receipt.sourceJobId)}/weighted-receipts/${receipt.id}.json`)}" target="_blank" rel="noopener">查看这份回执与原评审绑定</a></p>`:''}${receipt.evidenceSignature?`<details><summary>评分证据签名</summary><code>${esc(receipt.evidenceSignature)}</code></details>`:''}</li>`;
}
export function reweightHTML(job){
 const dimensions=scoredWeightDimensions(job);if(!dimensions)return '';
 const eligibility=reweightEligibility(job);
 if(!eligibility.available&&!eligibility.pending)return `<section class="card pipeline-reweight-unavailable"><h2>按偏好重新计算已有结果</h2><p class="hint">${esc(eligibility.reason)}</p></section>`;
 const dimensionIds=dimensions.map(d=>d.id),defaults=Object.fromEntries(job.quality.dimensions.map(d=>[d.id,d.weight]));
 const weights=drafts.get(job.id)??defaults,pending=pendingReweights.has(job.id),ended=eligibility.available;
 return `<section class="card pipeline-reweight" data-reweight-job="${esc(job.id)}"><h2>按偏好重新计算已有结果</h2><p>使用同一候选已有的独立维度评审，不调用模型、不制作新场景。原任务得分、产物和验收结论保留。</p>${dimensionIds.includes('lighting')?'':'<p class="callout">这条历史记录只有五项维度，没有独立光照评审；本次只能重算原五项，不能补造光照得分。</p>'}${weightEditorHTML(weights,dimensions,{prefix:'reweight',disabled:pending||!ended})}<div class="pipeline-weight-actions"><button type="button" data-reweight-reset${pending||!ended?' disabled':''}>恢复本次原权重</button><button type="button" data-reweight-normalize${pending||!ended?' disabled':''}>按比例归一化</button><button type="button" class="primary" data-reweight-save${pending||!ended?' disabled':''}>${pending?'正在保存重算…':'保存重算回执'}</button></div><p class="hint" data-weight-status aria-live="polite"></p><p class="hint" data-reweight-preview></p>${!ended?`<p class="hint">${esc(eligibility.reason)}</p>`:''}<p class="hint">重算分仅用于偏好对照，不自动修正场景，也不改写原始通过率。</p><div data-reweight-receipts>${job.scoreReweights?.length?`<h3>已保存的重算回执</h3><ol class="pipeline-receipts">${job.scoreReweights.map(receiptHTML).join('')}</ol>`:''}</div></section>`;
}

export function bindPipelineReweight({root,job,api,onSaved=()=>{},onError=()=>{}}){
 const box=root.querySelector('[data-reweight-job]');if(!box||box.dataset.reweightJob!==job.id)return;
 const dimensions=scoredWeightDimensions(job);if(!dimensions)return;
 const dimensionIds=dimensions.map(d=>d.id),ended=reweightEligibility(job).available,defaults=Object.fromEntries(job.quality.dimensions.map(d=>[d.id,d.weight]));
 const current=()=>root.querySelector('[data-reweight-job]');
 const same=()=>current()?.dataset.reweightJob===job.id;
 const update=()=>{
  if(!same())return;const node=current(),valid=showWeightValidity(node,dimensionIds),weights=readWeights(node);drafts.set(job.id,weights);
  const preview=node.querySelector('[data-reweight-preview]');if(preview)preview.textContent=valid?'已有原始维度按当前权重：'+previewWeightedScore(job,weights).toFixed(2)+' 分 · '+(savedDrafts.get(job.id)===JSON.stringify(weights)?'已保存独立回执':'尚未保存'):'';
  const pending=pendingReweights.has(job.id);for(const input of node.querySelectorAll('[data-score-weight]'))input.disabled=pending||!ended;
  for(const key of ['reset','normalize','save']){const button=node.querySelector('[data-reweight-'+key+']');if(button)button.disabled=pending||!ended||(key==='save'&&!valid);}
  const save=node.querySelector('[data-reweight-save]');if(save)save.textContent=pending?'正在保存重算…':'保存重算回执';
 };
 for(const input of box.querySelectorAll('[data-score-weight]'))input.oninput=update;
 box.querySelector('[data-reweight-reset]').onclick=()=>{if(pendingReweights.has(job.id)||!ended)return;setWeights(box,defaults);update();};
 box.querySelector('[data-reweight-normalize]').onclick=()=>{if(pendingReweights.has(job.id)||!ended)return;try{setWeights(box,normalizeScoreWeights(readWeights(box),dimensionIds));update();}catch(error){onError(error);}};
 box.querySelector('[data-reweight-save]').onclick=async()=>{
  if(pendingReweights.has(job.id)||!ended)return;
  try{const weights=validateScoreWeights(readWeights(box),dimensionIds);pendingReweights.add(job.id);update();const receipt=await api('/api/jobs/'+encodeURIComponent(job.id)+'/reweight',{weights});savedDrafts.set(job.id,JSON.stringify(weights));if(same()){const receipts=current().querySelector('[data-reweight-receipts]');receipts.innerHTML=`<h3>已保存的重算回执</h3><ol class="pipeline-receipts">${[...(job.scoreReweights??[]),receipt].map(receiptHTML).join('')}</ol>`;await onSaved(receipt);}}
  catch(error){if(same())onError(error);}
  finally{pendingReweights.delete(job.id);update();}
 };
 update();
}
