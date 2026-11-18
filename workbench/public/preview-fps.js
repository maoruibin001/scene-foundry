/** FPS derives only from Engine queue-submission events, never page animation ticks. */
export function createSubmissionFpsMonitor({windowMs=2000,staleMs=1500,warmupMs=500}={}){
 let source=null,identity=null,lastFrame=-1,times=[];
 const reset=()=>{source=null;identity=null;lastFrame=-1;times=[];};
 function observe(frame,at,canvas){
  if(!frame||!Number.isSafeInteger(frame.frameId)||frame.frameId<0||!Number.isSafeInteger(frame.deviceGeneration)||frame.deviceGeneration<0||!Number.isFinite(at)||(frame.worldIdentity!==undefined&&typeof frame.worldIdentity!=='string'))return false;
  const key=JSON.stringify([frame.worldIdentity??null,frame.deviceGeneration]);
  if(source!==canvas||identity!==key){reset();source=canvas;identity=key;}
  if(frame.frameId<=lastFrame||(times.length&&at<times.at(-1)))return false;
  lastFrame=frame.frameId;times.push(at);
  // Keep one anchor before the window, so a measured interval has both ends.
  while(times.length>2&&times[1]<at-windowMs)times.shift();
  if(times.length>4096)times=times.slice(-4096);
  return true;
 }
 function sample(now,{hidden=false}={}){
  if(hidden)return {status:'hidden',fps:null,p95FrameMs:null,samples:0};
  if(!times.length||!Number.isFinite(now))return {status:'waiting',fps:null,p95FrameMs:null,samples:0};
  const elapsed=now-times[0],sinceLast=now-times.at(-1);
  if(sinceLast>=staleMs)return {status:'stalled',fps:0,p95FrameMs:null,samples:0};
  while(times.length>2&&times[1]<now-windowMs)times.shift();
  if(times.length<2||elapsed<warmupMs)return {status:'warming',fps:null,p95FrameMs:null,samples:times.length};
  const intervals=times.slice(1).map((t,i)=>t-times[i]).filter(t=>t>0).sort((a,b)=>a-b),duration=now-times[0];
  if(!intervals.length||duration<=0)return {status:'warming',fps:null,p95FrameMs:null,samples:times.length};
  return {status:'running',fps:intervals.length/(duration/1000),p95FrameMs:intervals[Math.min(intervals.length-1,Math.floor(intervals.length*.95))],samples:intervals.length};
 }
 return {observe,sample,reset};
}

/** Preview-only drawing-buffer budgets. Materials, geometry and retained evidence are untouched. */
export function previewPixelBudget(mode){
 return mode==='smooth'?{width:1600,height:900}:mode==='native'?null:{width:1920,height:1080};
}
export function installPreviewResolution(win){
 const doc=win.document;let canvas=null,original=null,select=null,mode='balanced';
 try{const saved=win.sessionStorage?.getItem('scene-foundry.preview-resolution');if(['smooth','balanced','native'].includes(saved))mode=saved;}catch{}
 const names=['data-forgeax-render-width-limit','data-forgeax-render-height-limit'];
 const restore=()=>{if(canvas&&original)names.forEach((name,i)=>{if(original[i]===null)canvas.removeAttribute(name);else canvas.setAttribute(name,original[i]);});};
 const apply=()=>{if(!canvas)return;const budget=previewPixelBudget(mode);names.forEach((name,i)=>{const authored=Number(original[i]),limit=budget?[budget.width,budget.height][i]:null,value=limit===null?original[i]:String(authored>0?Math.min(authored,limit):limit);if(value===null)canvas.removeAttribute(name);else if(canvas.getAttribute(name)!==value)canvas.setAttribute(name,value);});};
 return {sync(next){
  if(!next?.getAttribute||!next?.setAttribute)return;
  if(next!==canvas){restore();canvas=next;original=names.map(name=>canvas.getAttribute(name));apply();}
  if(!select&&doc.querySelector('#game-ui')){
   select=doc.createElement('select');select.setAttribute('aria-label','预览渲染分辨率');select.dataset.scenePreviewResolution='true';select.title='仅调整当前交互预览的像素预算；原生使用设备像素比。原有截图、评分和下载包保持不变。';
   select.style.cssText='position:fixed;right:12px;top:70px;z-index:2147483647;pointer-events:auto;max-width:190px;padding:3px 6px;border:1px solid #8ec5a755;border-radius:5px;background:#102522e8;color:#e8fff5;font:12px/1.5 system-ui';
   for(const [value,label]of [['smooth','流畅 · 最高 900p'],['balanced','均衡 · 最高 1080p'],['native','原生分辨率']]){const option=doc.createElement('option');option.value=value;option.textContent=label;select.append(option);}select.value=mode;
   select.onchange=()=>{mode=select.value;try{win.sessionStorage?.setItem('scene-foundry.preview-resolution',mode);}catch{}apply();};doc.querySelector('#game-ui').append(select);
  }
 },dispose(){restore();select?.remove();}};
}

const INSTALL_KEY=Symbol.for('scene-foundry.preview-fps');
/** A read-only overlay; it creates no rendering loop and changes no Engine state. */
export function installPreviewFps(win=globalThis.window){
 if(!win?.document)return null;
 if(win[INSTALL_KEY])return win[INSTALL_KEY];
 const doc=win.document,monitor=createSubmissionFpsMonitor(),resolution=installPreviewResolution(win),badge=doc.createElement('div');
 badge.dataset.scenePreviewFps='true';
 badge.style.cssText='position:fixed;right:12px;top:12px;z-index:2147483647;pointer-events:none;padding:7px 10px;border:1px solid #8ec5a755;border-radius:7px;background:#102522e8;color:#e8fff5;font:12px/1.5 ui-monospace,monospace;white-space:pre;text-align:right;box-shadow:0 2px 12px #0004';
 badge.title='最近两秒真实 Engine 提交事件；FPS 不是显示器刷新率或历史验收值。p95 为提交帧间隔，数值越小越平稳。';
 doc.documentElement.append(badge);
 let controlsHud=null,controlsButton=null,controlsStyle=null;
 const syncControls=()=>{
  // Only the generated recording-controls HUD is collapsible. Engine owns its
  // content and H-key behavior; this button observes the same hidden property.
  const found=doc.querySelector('#scene-hud[data-scene-ui="recording-controls"]');
  const detected=found?.dataset?.sceneCollapsible==='true'?null:found;
  if(detected&&detected!==controlsHud){
   controlsHud=detected;
   controlsHud.hidden=true;
   const style=doc.createElement('style');style.textContent='#scene-hud[data-scene-ui="recording-controls"]{top:40px!important;left:12px!important;box-sizing:border-box;max-width:min(520px,calc(100vw - 24px));max-height:65vh;overflow:auto;padding:10px!important;font:12px/1.5 system-ui!important}#scene-hud[data-scene-ui="recording-controls"] button{font:inherit!important;margin:3px!important;padding:4px 7px!important}';
   doc.documentElement.append(style);controlsStyle=style;
   if(!controlsButton){
    controlsButton=doc.createElement('button');controlsButton.type='button';controlsButton.dataset.scenePreviewControls='true';
    controlsButton.style.cssText='position:fixed;left:12px;top:8px;z-index:2147483647;pointer-events:auto;padding:4px 8px;border:1px solid #8ec5a777;border-radius:5px;background:#102522e8;color:#e8fff5;font:12px/1.5 system-ui;cursor:pointer';
    controlsButton.onclick=()=>{if(controlsHud){controlsHud.hidden=!controlsHud.hidden;syncControls();}};
    (doc.querySelector('#game-ui')??doc.documentElement).append(controlsButton);
   }
  }
  if(controlsButton){controlsButton.hidden=!detected;if(detected){controlsButton.setAttribute('aria-expanded',String(!detected.hidden));controlsButton.textContent=detected.hidden?'操作说明 ▾':'收起操作说明 ▴';}}
 };
 const update=()=>{
  syncControls();resolution.sync(doc.querySelector('canvas#app')??doc.querySelector('canvas'));
  const s=monitor.sample(win.performance.now(),{hidden:doc.hidden});
  badge.dataset.status=s.status;
  badge.dataset.fps=s.fps===null?'':String(s.fps);
  badge.dataset.p95Ms=s.p95FrameMs===null?'':String(s.p95FrameMs);
  badge.textContent=s.status==='hidden'?'实时 FPS · 页面已暂停':s.status==='waiting'?'实时 FPS · 等待引擎提交':s.status==='warming'?'实时 FPS · 正在采样':s.status==='stalled'?'实时 FPS 0.0 · 暂无新提交':`实时 FPS ${s.fps.toFixed(1)}\np95 ${s.p95FrameMs.toFixed(1)} ms · 引擎提交帧`;
 };
 const submitted=event=>{
  const canvas=doc.querySelector('canvas#app')??doc.querySelector('canvas');
  if(!canvas||event.target!==canvas||!(event.target instanceof win.HTMLCanvasElement)||doc.hidden)return;
  monitor.observe(event.detail,win.performance.now(),canvas);
 };
 const visibility=()=>{monitor.reset();update();};
 doc.addEventListener('forgeax:frame-submitted',submitted,true);
 doc.addEventListener('visibilitychange',visibility);
 const timer=win.setInterval(update,500);update();
 const handle={dispose(){win.clearInterval(timer);doc.removeEventListener('forgeax:frame-submitted',submitted,true);doc.removeEventListener('visibilitychange',visibility);badge.remove();controlsButton?.remove();controlsStyle?.remove();resolution.dispose();if(win[INSTALL_KEY]===handle)delete win[INSTALL_KEY];}};
 win[INSTALL_KEY]=handle;
 return handle;
}
if(typeof window!=='undefined')installPreviewFps(window);
