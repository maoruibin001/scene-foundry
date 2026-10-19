import {scenePath,currentSceneKind} from './scene-context.js';

const pending=new Map();
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const isVoxel=job=>job?.sceneKind==='voxel'||currentSceneKind()==='voxel';
const terminal=job=>['failed','blocked','cancelled','needs_review','passed'].includes(job?.status);
const canContinue=job=>terminal(job)&&job.status!=='passed'&&job.stage==='voxel'&&Boolean(job.plan);
const canResumeNetwork=job=>job?.status==='blocked'&&job.networkResume?.available===true;
const initialUpgrade=job=>job?.voxelConstructionVersion==='voxel-lattice-v1'&&job.status==='blocked'&&job.recovery?.available===true&&['observation','plan'].includes(job.recovery.mode)&&job.spatialMechanismChangeAvailable===true;
const relative=value=>typeof value==='string'&&value.length>0&&!value.startsWith('/')&&!value.includes('\\')&&!value.includes('\0')&&value.split('/').every(part=>part&&part!=='.'&&part!=='..');
const fileURL=(job,folder,name)=>scenePath('/files/runs/'+[job.id,...(folder?folder.split('/'):[]),...name.split('/')].map(encodeURIComponent).join('/'),'voxel');
const key=job=>'voxel:'+job.id;
const label={
 'continue-voxel':['继续生成体素（保留需求）','正在继续体素生成…'],
 'network-resume':['确认网络已恢复并继续','正在核验网络并继续…'],
};
const button=(job,action)=>`<button type="button" data-voxel-action="${action}" ${pending.has(key(job))?'disabled aria-busy="true"':''}>${label[action][pending.get(key(job))===action?1:0]}</button>`;

/** Extra voxel data shares the ordinary detail cards; common recovery stays authoritative. */
export function voxelDetailsHTML(job){
 if(!job||!isVoxel(job))return '';
 const rows=[['cells','占用格'],['triangles','表面三角形'],['entities','实体']].filter(([field])=>Number.isFinite(job.voxel?.[field])&&job.voxel[field]>=0);
 const palette=Array.isArray(job.voxel?.palette)?job.voxel.palette:[];
 const best=job.delivery?.best,folder=best?.folder??'',validFolder=folder===''||relative(folder);
 const artifacts=job.voxel&&validFolder?[
  ['editable','scene.vox','下载可编辑 .vox'],['program','voxel-program.json','查看体素生成数据'],
 ].flatMap(([field,fallback,title])=>{
  const path=job.voxel[field]??fallback;if(!relative(path))return [];
  const url=fileURL(job,folder,path)+(field==='editable'?'?download=1':'');
  return [`<a class="button" href="${esc(url)}"${field==='program'?' target="_blank" rel="noopener"':''}>${title}</a>`];
 }):[];
 const actions=[...(canContinue(job)?[button(job,'continue-voxel')]:[]),...(canResumeNetwork(job)?[button(job,'network-resume')]:[])];
 if(!job.voxel&&!actions.length&&!initialUpgrade(job))return '';
 return `<section class="card voxel-details" data-voxel-job="${esc(job.id)}"><h2>体素物料与继续制作</h2>${rows.length?`<p>${rows.map(([field,title])=>esc(job.voxel[field].toLocaleString('zh-CN'))+' 个'+title).join(' · ')}</p>`:''}${palette.length?`<ul class="voxel-palette">${palette.map(color=>`<li>${/^#[a-fA-F0-9]{6}$/.test(color?.color??'')?`<span aria-hidden="true" style="display:inline-block;width:1em;height:1em;background:${color.color}"></span> `:''}${esc(color?.id??'未记录颜色名称')}${color?.color?' · '+esc(color.color):''}</li>`).join('')}</ul>`:''}${artifacts.length?`<div class="actions">${artifacts.join('')}</div><p class="hint">文件来自${folder?'当前保留候选':'本次任务已保存产物'}，与历史记录分别保留；下载不代表场景已通过验收。</p>`:job.voxel&&!validFolder?'<p class="hint">保留产物路径暂不可核验，未改为下载其他轮次的文件。</p>':''}${initialUpgrade(job)?'<p class="hint">已验证新的初始规划机制，可使用本页“恢复未完成的任务”入口继续；保留原图、需求、累计调用和失败记录。</p>':''}${canResumeNetwork(job)?'<p class="hint">原调用因网络问题停止。仅在确认网络已恢复后继续；服务会核验可达性，保留已有尝试和累计调用。</p>':''}${actions.length?`<div class="actions">${actions.join('')}</div>`:''}</section>`;
}

/** A pending write survives polling/rerenders; navigation never replays it. */
export function bindVoxelDetails({job,root,api,onError,onCreated}){
 if(!job||!isVoxel(job))return;
 const current=()=>root.querySelector('[data-voxel-job]')?.dataset.voxelJob===String(job.id);
 const buttons=()=>root.querySelectorAll('[data-voxel-action]');
 const update=()=>{if(!current())return;for(const element of buttons()){
  const action=element.dataset.voxelAction;if(!Object.hasOwn(label,action))continue;
  const active=pending.has(key(job));element.disabled=active;element.textContent=label[action][pending.get(key(job))===action?1:0];element.setAttribute('aria-busy',String(active));
 }};
 update();
 for(const element of buttons()){
  const action=element.dataset.voxelAction;
  if(!Object.hasOwn(label,action))continue;
  element.onclick=async()=>{
   if(!current()||pending.has(key(job))||(action==='continue-voxel'?!canContinue(job):!canResumeNetwork(job)))return;
   pending.set(key(job),action);update();
   try{
    const next=await api('/api/jobs/'+encodeURIComponent(job.id)+'/'+action,{});
    if(!next||typeof next.id!=='string'||!next.id)throw Error('服务未返回可继续查看的任务记录');
    if(current())await onCreated?.(next);
   }catch(error){if(current())onError?.(error);}
   finally{pending.delete(key(job));update();}
  };
 }
}
