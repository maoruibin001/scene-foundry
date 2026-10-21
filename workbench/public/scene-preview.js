import {currentSceneKind,scenePath} from './scene-context.js';
import {deliveryLimitation} from './delivery-ui.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pendingPreviews=new Map();
const outputPath=(job,path,kind)=>scenePath(`/files/runs/${encodeURIComponent(job.id)}/${path}`,kind);

/** Availability and selection come only from the delivery receipt, never root runtime or status. */
export function sceneOutput(job){
 const delivery=job?.delivery,best=delivery?.best;
 if(delivery?.available!==true||!best)return null;
 const context=currentSceneKind(),imagePaths=Array.isArray(best.images)?best.images.filter(path=>typeof path==='string'&&path.length):[],images=imagePaths.map(path=>outputPath(job,path,context));
 const label=best.layoutDraft?'布局范围草稿':best.kind==='graybox'?'空间草稿':best.kind==='partial'?'部分场景草稿':'场景';
 const qualityLabel=best.kind==='scene'?(best.deliveryStatus==='passed'&&best.deliveryStandard==='profile70'?'所选权重70分目标与共同底线通过；旧固定基准另列':best.deliveryStatus==='passed'&&best.deliveryStandard==='basic70'?'70分基础交付通过；完整规范结果另列':best.qualityStatus==='passed'?'正式验收通过':best.qualityStatus==='not_met'?'已评分，未达标':'未完成成品评分'):best.kind==='partial'&&best.qualityStatus==='partial_assessed'?'草稿已评分，成品尚未完成':'未完成成品评分';
 return {key:JSON.stringify([context,job.id,best.distManifestDigest??null,best.folder??null]),kind:best.kind,label,poster:images[0]??null,imagePaths,images,folder:best.folder??null,distManifestDigest:best.distManifestDigest??null,qualityLabel,score:Number.isFinite(best.score)?best.score:null,limitations:deliveryLimitation(delivery),selectionStatus:delivery.selection?.status??null,selectionReason:delivery.selection?.reason??null,runtime:best.runtime?outputPath(job,best.runtime,context):null};
}

function localPreviewURL(value){
 let parsed;try{if(typeof value!=='string')throw Error();parsed=new URL(value);}catch{throw Error('预览回执缺少有效的本地 Engine 地址');}
 if(!['http:','https:'].includes(parsed.protocol)||!['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)||parsed.username||parsed.password)throw Error('预览回执不是本地 Engine 地址');
 return value;
}

const comparisonSelections=new Map();

/** Uploaded inputs stay separate from rendered evidence, including text-only and legacy jobs. */
export function sceneReferenceImages(job){
 const inputs=Array.isArray(job?.images)&&job.images.length?job.images:job?.image?[job.image]:[];
 const seen=new Set();
 return inputs.flatMap((image,index)=>{
  const file=image?.file;if(typeof file!=='string'||!file.trim()||seen.has(file))return [];seen.add(file);
  return [{url:scenePath('/files/uploads/'+encodeURIComponent(file)),name:typeof image.name==='string'&&image.name?image.name:'参考图 '+(index+1),label:'参考图 '+(index+1)}];
 });
}

function comparisonGallery(kind,images,{interactive=false}={}){
 if(!images.length)return '';
 return `<div class="scene-compare-thumbnails" aria-label="${kind==='reference'?'输入参考图':'生成截图'}选择">${images.map((image,index)=>`<button type="button" class="scene-compare-thumbnail" data-comparison-pick="${kind}" data-index="${index}" data-image-url="${esc(image.url)}" data-image-label="${esc(image.label)}" aria-label="查看${esc(image.label)}" aria-pressed="${index===0}"${interactive?' disabled title="交互预览已打开，保留当前场景；截图可在运行证据中查看"':''}><img loading="lazy" decoding="async" src="${esc(image.url)}" alt="${esc(image.label)}缩略图"><span>${esc(image.label)}</span></button>`).join('')}</div>`;
}

function comparisonMedia(job,output,url){
 const references=sceneReferenceImages(job),screens=output?.images.map((image,index)=>({url:image,label:'生成截图 '+(index+1)}))??[];
 const key=JSON.stringify([currentSceneKind(),job?.id??'',references.map(image=>image.url),output?.key??null]);
 const preparing=job?.delivery?.state==='pending'||['queued','running'].includes(job?.status);
 const placeholder=!output?`<div class="placeholder"><span>◈</span><b>${preparing?'正在准备首个场景输出':'尚未生成可运行输出'}</b><p>${preparing?'生成的场景画面会显示在这里，与输入原图并排对比。':'输入原图与过程记录保留；当前没有已核验可运行的场景或草稿。'}</p></div>`:'<div class="placeholder"><span>◈</span><b>已有可运行输出</b><p>主图暂不可用，可手动打开场景。</p></div>';
 const view=url?`<iframe data-preview-src="${esc(url)}" title="ForgeaX ${esc(output.label)}交互预览" allow="cross-origin-isolated; fullscreen"></iframe>`:output?.poster?`<a class="scene-poster" data-comparison-link="output" href="${esc(output.poster)}" target="_blank" rel="noopener"><img class="cover" data-comparison-display="output" src="${esc(output.poster)}" alt="生成截图 1 · 当前交付产物的真实运行画面"></a>`:placeholder;
 const referencePanel=references.length?`<section class="scene-compare-panel scene-compare-input"><div class="scene-compare-heading"><h3>输入原图 <span>${references.length} 张</span></h3><a data-comparison-link="reference" href="${esc(references[0].url)}" target="_blank" rel="noopener" aria-label="查看当前输入原图">原图 ↗</a></div><div class="scene-compare-canvas"><img data-comparison-display="reference" src="${esc(references[0].url)}" alt="${esc(references[0].label)} · 上传原图"></div>${comparisonGallery('reference',references)}</section>`:'';
 return `<div class="scene-comparison${references.length?' has-references':''}" data-scene-comparison="${esc(key)}">${referencePanel}<section class="scene-compare-panel scene-compare-output"><div class="scene-compare-heading"><h3>${output?esc(output.label):'生成场景'}</h3><span class="hint">${url?'交互预览':screens.length?'运行截图 '+screens.length+' 张':'等待输出'}</span></div><div class="scene-compare-canvas">${view}</div>${comparisonGallery('output',screens,{interactive:Boolean(url)})}</section><p class="scene-compare-note">${references.length?'原图与生成画面分别切换；机位不自动配对。':'文字输入场景 · 这里显示保留的生成画面。'}${url?'交互预览中保留当前场景，不通过切图重载。':''}</p></div>`;
}

/** Pure DOM switching: never starts Engine, changes input files or replaces an iframe. */
export function bindSceneComparison(root){
 for(const panel of root?.querySelectorAll?.('[data-scene-comparison]')??[]){
  const key=panel.dataset.sceneComparison;let selection=comparisonSelections.get(key)??{};
  const apply=(kind,index)=>{
   const buttons=[...panel.querySelectorAll(`[data-comparison-pick="${kind}"]`)];
   const button=buttons.find(item=>Number(item.dataset.index)===index)??buttons[0];
   const image=panel.querySelector(`[data-comparison-display="${kind}"]`);
   if(!button||button.disabled||!image)return;
   if(image.getAttribute('src')!==button.dataset.imageUrl)image.setAttribute('src',button.dataset.imageUrl);image.setAttribute('alt',button.dataset.imageLabel+(kind==='reference'?' · 上传原图':' · 当前交付产物的真实运行画面'));
   for(const link of panel.querySelectorAll(`[data-comparison-link="${kind}"]`))link.setAttribute('href',button.dataset.imageUrl);
   for(const item of buttons)item.setAttribute('aria-pressed',String(item===button));
   selection={...selection,[kind]:Number(button.dataset.index)};comparisonSelections.delete(key);comparisonSelections.set(key,selection);
   while(comparisonSelections.size>32)comparisonSelections.delete(comparisonSelections.keys().next().value);
  };
  for(const kind of ['reference','output']){
   apply(kind,selection[kind]??0);
   for(const button of panel.querySelectorAll(`[data-comparison-pick="${kind}"]`))button.onclick=()=>apply(kind,Number(button.dataset.index));
  }
 }
}

/** Rendering shows original inputs and retained evidence; interaction explicitly starts a preview. */
export function sceneHeroHTML(job,preview={}){
 const output=sceneOutput(job);
 if(!output)return `<section class="card preview scene-preview"><div class="scene-preview-summary"><h2>生成结果与输入对比</h2></div><div class="scene-preview-media">${comparisonMedia(job,null,null)}</div></section>`;
 let url=null,error=preview.error?.message??preview.error??null;
 if(preview.url)try{url=localPreviewURL(preview.url);}catch(e){error=e.message;}
 const fallback=output.selectionStatus==='fallback'?(output.selectionReason||'当前展示另一份已核验可运行输出，不代表重新选优。'):null;
 return `<section class="card preview scene-preview" data-scene-key="${esc(output.key)}"><div class="scene-preview-summary"><div class="card-heading"><h2>生成结果 · ${esc(output.label)}</h2><span class="hint">ForgeaX Engine 实际运行画面</span></div><p><b>${esc(output.qualityLabel)}</b>${output.score!==null?' · '+esc(output.score)+' 分':''}</p>${fallback?`<p class="callout">${esc(fallback)}</p>`:''}${error?`<p class="callout failed" role="alert">${esc(error)}</p>`:''}</div><div class="scene-preview-media">${comparisonMedia(job,output,url)}</div><div class="preview-toolbar">${output.limitations?`<p class="hint">${esc(output.limitations)}</p>`:''}<p class="hint">点击后打开交互预览，场景右上角显示实时 FPS 和 p95 帧间隔；录制与验收占用渲染资源时请稍后再试。草稿和未达标结果仍可查看，不计为成品通过。</p><span class="hint">${url?'点击画面后操作 · 相机按键见场景内提示':'保留产物的真实运行截图'}</span><div class="actions"><button id="preview-scene" class="primary"${preview.pending?' disabled':''}>${preview.pending?'正在打开预览…':'在本页交互预览'}</button>${url?`<span id="preview-state" class="hint"></span><button id="resume-preview" hidden>在页面中继续预览</button><a id="external-preview" class="button" href="${esc(url)}" target="_blank" rel="noopener">独立预览 ↗</a>`:''}<a class="button" href="${esc(scenePath(`/api/jobs/${encodeURIComponent(job.id)}/download-output`))}">下载${output.kind==='scene'?'场景':'草稿'} ↓</a>${output.runtime?`<a href="${esc(output.runtime)}" target="_blank" rel="noopener">运行证据</a>`:''}</div></div></section>`;
}

function renderCount(value){
 if(Array.isArray(value))return value.length;
 if(value===undefined)return 0;
 if(Number.isFinite(value)&&value>=0)return value;
 throw Error('无法确认当前渲染资源状态，请稍后再试');
}

/** Missing or malformed scheduler evidence is an error, never proof that capture is idle. */
export function previewCaptureBusy(scheduler){
 if(!scheduler?.renders||scheduler.renders.active===undefined)throw Error('无法确认当前渲染资源状态，请稍后再试');
 return renderCount(scheduler.renders.active)+renderCount(scheduler.renders.reserved)>0;
}

/** Only coalesce in-flight clicks. No completed URL cache and no automatic POST retry. */
export function requestScenePreview({api,job}){
 const output=sceneOutput(job);if(!output)return Promise.reject(Error('没有已核验可运行的场景输出'));
 if(pendingPreviews.has(output.key))return pendingPreviews.get(output.key);
 const context=currentSceneKind();
 const request=(async()=>{
  const scheduler=await api(scenePath('/api/scheduler',context));
  if(previewCaptureBusy(scheduler))throw Error('正在录制、验收或渲染场景，请稍后再打开交互预览');
  const response=await api(scenePath(`/api/jobs/${encodeURIComponent(job.id)}/preview-output`,context),{});
  localPreviewURL(response?.url);return response;
 })().finally(()=>{pendingPreviews.delete(output.key);});
 pendingPreviews.set(output.key,request);return request;
}
