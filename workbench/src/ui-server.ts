// Serve an independent UI release without changing an active worker's frozen inputs.
// This process owns no jobs, scheduler, model calls, or persisted task state.
import {resolve, sep} from 'node:path';
import {existsSync, realpathSync, statSync} from 'node:fs';
import {createProcessRoutes} from './process-observer/routes';

export function uiHandler(publicDir:string, upstream:string, productionTiming?:(id:string)=>any, voxelUpstream?:string, voxelObserverDataRoot?:string) {
  const root=realpathSync(publicDir), target=new URL(upstream);
  if(target.protocol!=='http:' || target.hostname!=='127.0.0.1' || target.username || target.password) throw Error('界面后端必须是本机 HTTP 服务');
  const voxel=voxelUpstream?new URL(voxelUpstream):target;
  if(voxel.protocol!=='http:'||voxel.hostname!=='127.0.0.1'||voxel.username||voxel.password)throw Error('体素后端必须是本机 HTTP 服务');
  const headers={'Cache-Control':'no-cache','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'};
  const observer=voxelObserverDataRoot?createProcessRoutes(voxelObserverDataRoot,resolve(import.meta.dirname,'../public/process'),'/api/voxel/process/media'):null;
  return async(req:Request)=>{
    const url=new URL(req.url);
    if(req.headers.get('origin')&&req.headers.get('origin')!==url.origin)return Response.json({error:'跨站请求被拒绝'},{status:403});
    if(observer&&url.pathname.startsWith('/api/voxel/process/')){const observedURL=new URL(url);observedURL.pathname=observedURL.pathname.replace('/api/voxel/process/','/api/process/');const response=observer(new Request(observedURL,req));if(response)return response;}
    if(req.method==='GET' && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/files/')) {
      const pathname=decodeURIComponent(url.pathname),file=resolve(root,'.'+pathname+(pathname.endsWith('/')?'index.html':''));
      if(file.startsWith(root+sep) && existsSync(file) && realpathSync(file).startsWith(root+sep) && statSync(file).isFile()) return new Response(Bun.file(file),{headers});
    }
    try {
      const selected=url.pathname.startsWith('/api/voxel/')||url.pathname.startsWith('/voxel/files/')||url.pathname.startsWith('/voxel/process/')?voxel:target;
      const proxy=new URL(url.pathname+url.search,selected);
      const requestHeaders=new Headers(req.headers);requestHeaders.delete('host');if(requestHeaders.has('origin'))requestHeaders.set('origin',selected.origin);
      const response=await fetch(proxy,{method:req.method,headers:requestHeaders,body:['GET','HEAD'].includes(req.method)?undefined:req.body,redirect:'manual',signal:req.signal});
      const timing=req.method==='GET'&&url.pathname.match(/^\/api\/jobs\/([a-f0-9-]{36})\/timing$/);
      if(timing&&productionTiming&&response.ok){
        const body=await response.json();
        try{body.production=productionTiming(timing[1]);}catch{body.productionError=true;}
        const timingHeaders=new Headers(response.headers);timingHeaders.delete('Content-Length');timingHeaders.delete('Content-Encoding');timingHeaders.set('Cache-Control','no-store');
        return Response.json(body,{status:response.status,headers:timingHeaders});
      }
      return new Response(response.body,{status:response.status,statusText:response.statusText,headers:response.headers});
    } catch {
      return Response.json({error:'生成服务暂不可用；界面没有重启或重建任何任务。'},{status:502});
    }
  };
}

if(import.meta.main){
  const {productionTimingSnapshot}=await import('./production-timing');
  const port=Number(process.env.UI_PORT??19772),upstream=process.env.UI_UPSTREAM??'http://127.0.0.1:19771';
  const server=Bun.serve({hostname:'127.0.0.1',port,idleTimeout:60,maxRequestBodySize:21*1024*1024,fetch:uiHandler(resolve(import.meta.dirname,'../public'),upstream,productionTimingSnapshot,process.env.VOXEL_UPSTREAM,process.env.VOXEL_OBSERVER_DATA_DIR)});
  console.log('SCENE_WORKBENCH_UI '+server.url+' -> '+upstream);
}
