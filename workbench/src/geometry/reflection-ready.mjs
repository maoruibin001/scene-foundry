/** The Render Worker owns its renderer. Wait on Engine completed frames, not game-plugin DI. */
export function reflectionFramesSettled(frame,start,count){return Number.isSafeInteger(frame)&&Number.isSafeInteger(start)&&frame>=start+60*count;}
export async function waitForReflections(page,audit){
 const count=audit.reflectionProbeCount??0;if(!count)return null;
 const read=()=>page.evaluate(()=>Number(document.documentElement.dataset.forgeaxFrameCompleted));
 const startedAt=Date.now();let start=null,frame=null;
 do{frame=await read();if(start===null&&Number.isSafeInteger(frame)&&frame>0)start=frame;
 if(reflectionFramesSettled(frame,start,count))return {kind:'engine-completed-frame-warmup',startFrame:start,endFrame:frame,probeCount:count,elapsedMs:Date.now()-startedAt,probeStateInspected:false};await page.waitForTimeout(100);}while(Date.now()-startedAt<20000);
 throw Error('反射预热未在20秒内完成足够真实GPU帧：'+JSON.stringify({start,frame,count}));
}
