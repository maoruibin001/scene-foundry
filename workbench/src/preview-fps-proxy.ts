import {brotliDecompressSync,gunzipSync,inflateSync} from 'node:zlib';

const FPS_SCRIPT='/__scene-foundry-preview-fps.js';
const MAX_PROXIES=8;

/** Only the root URL returned by the existing Engine preview launcher is accepted. */
export function previewEngineURL(value:unknown):URL {
 let url:URL;
 try{if(typeof value!=='string')throw Error();url=new URL(value);}catch{throw Error('预览回执缺少有效的本机 Engine 地址');}
 const port=Number(url.port);
 if(url.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password||!Number.isInteger(port)||port<19775||port>=19800||url.pathname!=='/'||url.search||url.hash)throw Error('预览地址不属于本机 Engine 预览端口');
 return url;
}

/**
 * Decorate HTTP preview responses only. Every origin gets its own ephemeral
 * listener, so absolute/root-relative assets retain the Engine's path semantics.
 * This registry neither starts an Engine nor reads or changes generated dist.
 */
export function createPreviewFpsProxyRegistry({scriptSource}:{scriptSource:string}){
 if(typeof scriptSource!=='string'||!scriptSource.trim())throw Error('缺少冻结界面的 FPS 脚本');
 const script=scriptSource;
 const proxies=new Map<string,ReturnType<typeof Bun.serve>>();
 let closed=false;
 return {
  async wrapURL(value:string):Promise<string>{
   if(closed)throw Error('场景预览界面已经关闭');
   const engine=previewEngineURL(value),existing=proxies.get(engine.origin);
   if(existing)return existing.url.href;
   if(proxies.size>=MAX_PROXIES)throw Error('已打开八个不同场景预览，请关闭旧预览后重启界面释放端口');
   const server=Bun.serve({hostname:'127.0.0.1',port:0,idleTimeout:60,fetch:async(req:Request)=>{
    const incoming=new URL(req.url);
    if(!['GET','HEAD'].includes(req.method))return Response.json({error:'场景预览只允许读取静态资源'},{status:405,headers:{Allow:'GET, HEAD'}});
    if(req.headers.get('origin')&&req.headers.get('origin')!==incoming.origin)return Response.json({error:'跨站预览请求被拒绝'},{status:403});
    const common={'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'cross-origin'};
    if(incoming.pathname===FPS_SCRIPT)return new Response(req.method==='HEAD'?null:script,{headers:{...common,'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'}});
    try{
     // Never pass ambient cookies, authorization or the proxy Origin to Engine.
     const requestHeaders=new Headers({'Accept-Encoding':'identity'});
     for(const name of ['Accept','Accept-Language','Range','If-Range']){const value=req.headers.get(name);if(value)requestHeaders.set(name,value);}
     if(incoming.pathname.startsWith('//'))throw Error('预览资源地址超出已注册 Engine');
     const target=new URL(incoming.pathname+incoming.search,engine.origin);
     if(target.origin!==engine.origin)throw Error('预览资源地址超出已注册 Engine');
     // Keep encoded asset streams byte-for-byte; only decorated HTML is decoded.
     const upstream=await fetch(target,{method:req.method,headers:requestHeaders,redirect:'manual',credentials:'omit',signal:req.signal,decompress:false});
     if(upstream.status>=300&&upstream.status<400){await upstream.body?.cancel();return Response.json({error:'Engine 静态预览发生意外重定向'},{status:502,headers:common});}
     const headers=new Headers(upstream.headers);headers.delete('Set-Cookie');
     for(const [name,value]of Object.entries(common))if(!headers.has(name))headers.set(name,value);
     const main=['/','/index.html'].includes(incoming.pathname)&&upstream.ok&&headers.get('Content-Type')?.toLowerCase().includes('text/html');
     if(main){
      const encoding=headers.get('Content-Encoding')?.trim().toLowerCase();
      headers.set('Cache-Control','no-store');headers.delete('Content-Length');headers.delete('Content-Encoding');headers.delete('ETag');headers.delete('Last-Modified');
      if(req.method==='HEAD')return new Response(null,{status:upstream.status,headers});
      let html:string;
      if(encoding&&encoding!=='identity'){const bytes=new Uint8Array(await upstream.arrayBuffer());const decoded=encoding==='gzip'?gunzipSync(bytes):encoding==='deflate'?inflateSync(bytes):encoding==='br'?brotliDecompressSync(bytes):null;if(!decoded)throw Error('未知 HTML 编码');html=new TextDecoder().decode(decoded);}else html=await upstream.text();
      const tag=`<script type="module" src="${FPS_SCRIPT}"></script>`;
      const decorated=/<\/body\s*>/i.test(html)?html.replace(/<\/body\s*>/i,tag+'$&'):html+tag;
      return new Response(decorated,{status:upstream.status,headers});
     }
     return new Response(req.method==='HEAD'?null:upstream.body,{status:upstream.status,statusText:upstream.statusText,headers});
    }catch{return Response.json({error:'Engine 预览暂时不可读；没有重新生成场景。'},{status:502,headers:common});}
   }});
   proxies.set(engine.origin,server);
   return server.url.href;
  },
  close(){closed=true;for(const server of proxies.values())server.stop(true);proxies.clear();},
 };
}
