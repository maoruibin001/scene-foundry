/** Actual captured frame intervals; a short static preview is not a full runtime pass. */
export function previewPerformance(frames:any[]){
 const views=frames.map(f=>{
  const times=(f.pose?.frameTimes??[]).filter((n:any)=>Number.isFinite(n)&&n>0).slice(-120),ordered=[...times].sort((a,b)=>a-b);
  return {referenceIndex:f.referenceIndex??null,samples:times.length,averageFps:times.length?1000/(times.reduce((a:number,b:number)=>a+b,0)/times.length):null,p95FrameMs:times.length?ordered[Math.min(times.length-1,Math.floor(times.length*.95))]:null};
 });
 const measured=views.filter(v=>v.samples>=30);
 return {source:'实际 Engine 相机审计帧时间',views,signal:measured.length!==views.length||!views.length?'insufficient-samples':measured.some(v=>v.averageFps!<10||v.p95FrameMs!>=100)?'runtime-risk':'preview-only',formalRuntimePassed:false,scope:'仅短时静态观测，可能受同时打开的预览或设备负载影响。出现风险先对照同环境来源场景，不默认归因于模型或新材质；完整录屏与运行门槛仍需独立验收。'};
}
