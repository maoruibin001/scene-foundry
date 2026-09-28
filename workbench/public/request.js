/** 所有页面请求有结束边界；超时显示可重试错误，不自动重放写入。 */
export async function requestJSON(path,body,options={}){
 const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),options.timeoutMs??20000);
 const init=body instanceof FormData?{method:'POST',body}:body!==undefined?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{};
 try{const r=await(options.fetch??fetch)(path,{...init,signal:ctl.signal});const j=await r.json();if(!r.ok)throw Error(j.error||r.statusText);return j;}
 catch(e){if(ctl.signal.aborted)throw Error('请求超时，请稍后重试；当前生成任务不会因此中断');throw e;}
 finally{clearTimeout(timer);}
}
export function singleFlight(fn){let active;return (...args)=>{if(active)return active;active=Promise.resolve().then(()=>fn(...args)).finally(()=>{active=null;});return active;};}
