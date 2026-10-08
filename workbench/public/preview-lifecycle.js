/** Own exactly one embedded Engine context; opening an external view releases it. */
export function createPreviewLifecycle({document:doc=globalThis.document,IntersectionObserver:Observer=globalThis.IntersectionObserver,onState=()=>{}}={}){
 let frame=null,visible=false,external=false,observer=null;
 function apply(){
  const active=!!frame?.isConnected&&visible&&!doc.hidden&&!external;
  if(frame){
   if(active&&!frame.getAttribute('src'))frame.setAttribute('src',frame.dataset.previewSrc);
   if(!active&&frame.getAttribute('src'))frame.removeAttribute('src');
  }
  onState({active,external,reason:external?'独立预览已打开，页面内预览已暂停':doc.hidden?'页面隐藏，预览已暂停':!visible?'预览离开可视区域，已暂停':'正在页面内预览'});
 }
 function attach(next){
  if(next!==frame){
   if(frame?.getAttribute('src'))frame.removeAttribute('src');
   observer?.disconnect();frame=next;visible=false;
   if(frame){observer=new Observer(entries=>{const entry=entries.find(e=>e.target===frame);if(entry){visible=entry.isIntersecting&&entry.intersectionRatio>=.05;apply();}},{threshold:.05});observer.observe(frame);}
  }
  apply();
 }
 const visibility=()=>apply();doc.addEventListener('visibilitychange',visibility);
 return {attach,pauseForExternal(){external=true;apply();},resume(){external=false;apply();},dispose(){attach(null);doc.removeEventListener('visibilitychange',visibility);}};
}
