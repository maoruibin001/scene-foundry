/** Presentation-owned read-only bridge; the Engine owns inspection and completion.
 * Does not start frames, mutate ECS, or substitute a timer for renderer evidence. */
export function opticsObserverPlugin(){return `import type {} from '@forgeax/engine/app';
import type {Plugin} from '@forgeax/engine/plugin';
export default {name:'scene/optics-observer',inject:['gameHost'],apply(ctx){ctx.effect(()=>{
 const root=document.documentElement as any,app=ctx.gameHost?.app as any;
 const fields=['state','frame','reflectionProbes','iblBinding','ssr','volumetricFog'];
 const read=async(expectedWorldIdentity:string)=>{
  if(typeof app?.remoteEval==='function')return await app.remoteEval('return await execution.inspectRenderer({fields:'+JSON.stringify(fields)+'});',expectedWorldIdentity);
  if(app?.world?.identity===expectedWorldIdentity&&ctx.gameHost?.renderer)return {ok:true,value:ctx.gameHost.renderer.inspect({fields} as any)};
  return {ok:false,error:{code:'OPTICS_INSPECTION_UNAVAILABLE'}};
 };
 root.sceneReadOptics=read;
 return ()=>{if(root.sceneReadOptics===read)delete root.sceneReadOptics;};
});}} satisfies Plugin;\n`;}
