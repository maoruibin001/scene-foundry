import {scenePath} from './scene-context.js';
import {sceneOutput,requestScenePreview} from './scene-preview.js';

const opening=new Set(),settledListeners=new Map();
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function historySceneHTML(job,delivery,error=''){
 const output=sceneOutput({...job,delivery});
 if(!output)return `<span class="record-placeholder">${error?'暂未读取到场景输出':delivery?.state==='pending'?'场景制作中':'暂无可打开的场景'}</span>${error?'<button type="button" data-reload-scene>重试读取输出</button>':''}`;
 const disabled=opening.has(output.key)?'disabled aria-busy="true"':'';
 return `${output.poster?`<button type="button" class="record-scene-thumb" data-open-scene aria-label="打开${esc(output.label)}：${esc(job.name||'生成结果')}" ${disabled}><img class="record-thumb" loading="lazy" src="${esc(output.poster)}" alt="${esc(output.label)} ${esc(job.name)}"></button>`:''}<button type="button" class="primary record-open-scene" data-open-scene ${disabled}>${opening.has(output.key)?'正在打开…':'打开'+esc(output.label)+' ↗'}</button><small>${esc(output.qualityLabel||output.label)}</small>${output.selectionStatus==='fallback'?'<small>保留证据不完整，当前提供其他可运行输出</small>':''}<a href="${esc(scenePath('/api/jobs/'+encodeURIComponent(job.id)+'/download-output'))}">下载当前输出 ↓</a>`;
}

/** Read only the current page's small saved receipts; opening revalidates through the normal product API. */
export async function hydrateHistoryScenes({items,api,root,isActive,onError,hostWindow=globalThis.window}){
 let cursor=0;
 const nodeFor=id=>[...root.querySelectorAll('[data-scene-output]')].find(node=>node.dataset.sceneOutput===id);
 async function load(job){
  let delivery=null,readError='';
  try{delivery=await api('/files/runs/'+encodeURIComponent(job.id)+'/delivery.json');}catch(error){readError=String(error?.message||error);}
  if(!isActive())return;
  const node=nodeFor(job.id);if(!node)return;
  node.innerHTML=historySceneHTML(job,delivery,readError);
  const retry=node.querySelector('[data-reload-scene]');if(retry)retry.onclick=()=>{retry.disabled=true;void load(job);};
  const output=sceneOutput({...job,delivery});if(!output)return;
  const buttons=()=>node.querySelectorAll('[data-open-scene]');
  const restore=()=>{for(const b of buttons()){b.disabled=false;b.setAttribute('aria-busy','false');if(b.classList.contains('record-open-scene'))b.textContent='打开'+output.label+' ↗';}};
  if(opening.has(output.key)){const listeners=settledListeners.get(output.key)??new Set();listeners.add(()=>{if(isActive()&&nodeFor(job.id)===node)restore();});settledListeners.set(output.key,listeners);}
  for(const button of buttons())button.onclick=async()=>{
   if(!isActive()||opening.has(output.key))return;
   opening.add(output.key);for(const b of buttons()){b.disabled=true;b.setAttribute('aria-busy','true');}
   // Reserve the tab in the click event; no preview starts while reading the list.
   let target;
   try{
    target=hostWindow.open('about:blank','_blank');
    const result=await requestScenePreview({api,job:{...job,delivery}});
    if(!isActive()){target?.close();return;}
    if(target)target.location.href=result.url;else hostWindow.location.href=result.url;
   }catch(error){target?.close();if(isActive())onError(error);}
   finally{opening.delete(output.key);for(const listener of settledListeners.get(output.key)??[])listener();settledListeners.delete(output.key);if(isActive())restore();}
  };
 }
 async function worker(){while(cursor<items.length&&isActive()){const job=items[cursor++];await load(job);}}
 await Promise.all(Array.from({length:Math.min(4,items.length)},worker));
}
