/** Engine browser-frame-signal publishes canvas progress only after FrameReceipt completion.
 * Neither submitted frames, requestAnimationFrame nor elapsed time establish readiness. */
export function reflectionFramesSettled(frame,start,count){return Number.isSafeInteger(frame)&&Number.isSafeInteger(start)&&frame>=start+60*count;}
export function acceptedGpuCompletion(snapshot){
 if(snapshot?.canvases?.length!==1)return null;
 const {canvas,submitted:s,completed:c}=snapshot.canvases[0];
 if(!s||!c||!Number.isSafeInteger(c.frameId)||c.frameId<=0||!Number.isSafeInteger(s.frameId)||c.frameId>s.frameId||c.presentation!=='ready'||typeof c.worldIdentity!=='string'||!c.worldIdentity||s.worldIdentity!==c.worldIdentity||!Number.isSafeInteger(c.deviceGeneration)||c.deviceGeneration<0||s.deviceGeneration!==c.deviceGeneration)return null;
 return {canvas,frameId:c.frameId,submittedFrameId:s.frameId,worldIdentity:c.worldIdentity,deviceGeneration:c.deviceGeneration,graphGeneration:c.graphGeneration??null};
}
export async function waitForReflections(page,audit,options={}){
 const count=audit.reflectionProbeCount??0;if(!count)return null;
 if(!Number.isSafeInteger(count)||count<1)throw Error('反射探针计数无效');
 const read=()=>page.evaluate(()=>{
  const all=[];const walk=root=>{for(const e of root.querySelectorAll('*')){if(e.tagName==='CANVAS')all.push(e);if(e.shadowRoot)walk(e.shadowRoot);}};walk(document);
  return {canvases:all.flatMap((c,i)=>c.forgeaxFrameProgress?[{canvas:i,submitted:c.forgeaxFrameProgress.submitted&&{frameId:c.forgeaxFrameProgress.submitted.frameId,worldIdentity:c.forgeaxFrameProgress.submitted.worldIdentity,deviceGeneration:c.forgeaxFrameProgress.submitted.deviceGeneration},completed:c.forgeaxFrameProgress.completed&&{frameId:c.forgeaxFrameProgress.completed.frameId,worldIdentity:c.forgeaxFrameProgress.completed.worldIdentity,deviceGeneration:c.forgeaxFrameProgress.completed.deviceGeneration,presentation:c.forgeaxFrameProgress.completed.presentation}}]:[])};
 });
 const now=options.now??Date.now,startedAt=now(),samples=[];let start=null,last=null;
 const fail=reason=>{const error=Error(reason);error.evidence={kind:'engine-completed-frame-warmup',source:'canvas.forgeaxFrameProgress',passed:false,probeCount:count,samples,elapsedMs:now()-startedAt,probeStateInspected:false};throw error;};
 do{const snapshot=await read(),frame=acceptedGpuCompletion(snapshot);samples.push({elapsedMs:now()-startedAt,accepted:frame,canvasCount:snapshot?.canvases?.length??0});
 if(frame){
  if(start&&(frame.canvas!==start.canvas||frame.worldIdentity!==start.worldIdentity||frame.deviceGeneration!==start.deviceGeneration))fail('反射预热场景、canvas或GPU设备身份改变');
  if(last&&frame.frameId<last.frameId)fail('反射预热完成帧倒退');
  start??=frame;last=frame;
  if(reflectionFramesSettled(frame.frameId,start.frameId,count))return {kind:'engine-completed-frame-warmup',source:'canvas.forgeaxFrameProgress',passed:true,startFrame:start.frameId,endFrame:frame.frameId,worldIdentity:frame.worldIdentity,deviceGeneration:frame.deviceGeneration,probeCount:count,elapsedMs:now()-startedAt,samples,probeStateInspected:false};
 }
 await page.waitForTimeout(100);}while(now()-startedAt<20000);
 fail('反射预热未在20秒内完成足够真实GPU帧：'+JSON.stringify({start,last,count}));
}
