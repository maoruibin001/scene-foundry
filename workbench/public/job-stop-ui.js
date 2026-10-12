const pendingStops=new Map();
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function confirmJobStop(){
 return new Promise(resolve=>{
  const dialog=document.createElement('dialog');dialog.className='stop-confirmation';dialog.setAttribute('aria-labelledby','stop-confirmation-title');
  dialog.innerHTML='<h2 id="stop-confirmation-title">停止当前场景的生成？</h2><p>当前执行和后续自动修正将中止。已生成的输出、资产和记录会保留。</p><div class="stop-confirmation-actions"><button type="button" data-stop-dismiss>继续生成</button><button type="button" class="stop-generation" data-stop-confirm>停止生成</button></div>';
  const finish=accepted=>{window.removeEventListener('hashchange',dismiss);dialog.remove();resolve(accepted);},dismiss=()=>finish(false);
  dialog.querySelector('[data-stop-dismiss]').onclick=dismiss;dialog.querySelector('[data-stop-confirm]').onclick=()=>finish(true);
  dialog.oncancel=event=>{event.preventDefault();dismiss();};window.addEventListener('hashchange',dismiss,{once:true});document.body.append(dialog);dialog.showModal();
 });
}

export function stopGenerationHTML(job){
 if(!['queued','running'].includes(job.status))return '';
 const pending=pendingStops.get(job.id);
 return `<button type="button" class="stop-generation" data-stop-job="${esc(job.id)}" ${pending?'disabled aria-busy="true"':''} title="停止当前任务，保留已有输出">${pending==='confirm'?'确认停止…':pending?'正在停止…':'停止生成'}</button>`;
}

/** Shared across detail/list renders so navigation and polling cannot duplicate a stop. */
export function bindStopGeneration({root,api,onStopped,onError,confirmStop=confirmJobStop}){
 const buttons=()=>root.querySelectorAll('[data-stop-job]');
 const update=(id,pending)=>{for(const button of buttons())if(button.dataset.stopJob===id){button.disabled=Boolean(pending);button.textContent=pending==='confirm'?'确认停止…':pending?'正在停止…':'停止生成';button.setAttribute('aria-busy',String(Boolean(pending)));}};
 for(const button of buttons()){
  const id=button.dataset.stopJob;
  update(id,pendingStops.get(id));
  button.onclick=async()=>{
   if(pendingStops.has(id))return;
   pendingStops.set(id,'confirm');update(id,'confirm');
   try{if(!await confirmStop())return;pendingStops.set(id,'request');update(id,'request');await api('/api/jobs/'+encodeURIComponent(id)+'/cancel',{});await onStopped?.(id);}
   catch(error){onError(error);}
   finally{pendingStops.delete(id);update(id,false);}
  };
 }
}
