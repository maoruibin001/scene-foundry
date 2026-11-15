import {acceptedGpuCompletion} from './reflection-ready.mjs';

export function opticsProblems(value,expected){
 const problems=[],p=value?.reflectionProbes;
 if(value?.state!=='alive')problems.push('renderer-not-alive');
 if(!Number.isSafeInteger(value?.frame?.frameId)||!Number.isSafeInteger(value?.frame?.deviceGeneration)||!Array.isArray(value?.frame?.pendingCompletions)||value.frame.pendingCompletionCount!==value.frame.pendingCompletions.length)problems.push('completion-inspection-missing-or-truncated');
 if(value?.frame?.pendingCompletions?.some(x=>x.queue==='rejected'||x.reflection==='rejected'))problems.push('completion-rejected');
 if(expected.probes&&(!p?.pipelineReady||p.activeCount<expected.probes||!p.updates?.length||p.updates.some(x=>x.pending||x.activeGeneration<1||x.capturedRevision!==x.requestedRevision)))problems.push('probe-not-published');
 if(expected.ssr&&(value?.ssr?.status!=='admitted'||value.ssr.history?.state!=='stable'))problems.push('ssr-not-stable');
 if(expected.volume&&(value?.volumetricFog?.status!=='available'||value.volumetricFog.resourceStage!=='accepted'||!value.volumetricFog.selectedLight||!value.volumetricFog.digest))problems.push('volume-not-accepted');
 return problems;
}
export function rendererFrameCompleted(snapshot,target){
 return snapshot?.frame?.deviceGeneration===target.deviceGeneration&&Number.isSafeInteger(snapshot?.frame?.frameId)&&snapshot.frame.frameId>=target.frameId&&
  Array.isArray(snapshot.frame.pendingCompletions)&&snapshot.frame.pendingCompletionCount===snapshot.frame.pendingCompletions.length&&!snapshot.frame.pendingCompletions.some(x=>x.frameId<=target.frameId);
}
const poseMatches=(p,e)=>p&&!p.ambiguousSource&&p.running===false&&p.selectedView===e.index&&
 ['position','target'].every(k=>Array.isArray(p[k])&&p[k].length===3&&p[k].every((n,i)=>Math.abs(n-e[k][i])<1e-4));
const resourceIdentity=v=>JSON.stringify({probes:v.reflectionProbes?.updates?.map(x=>[x.worldId,x.entityKey,x.activeGeneration,x.capturedRevision]),volume:v.volumetricFog?.digest,ssrReset:v.ssr?.history?.resetCount});

export async function waitForOptics(page,audit,index,options={}){
 if(!audit.opticsInspection)return null;
 const view=audit.views[index],expected={index,position:view.position,target:view.target},now=options.now??Date.now,deadline=now()+(options.timeoutMs??20000),samples=[];
 let target=null,start=null,poseFence=null;
 while(now()<deadline){
  const sample=await page.evaluate(async()=>{
   const canvases=[];const walk=root=>{for(const e of root.querySelectorAll('*')){if(e.tagName==='CANVAS'&&e.forgeaxFrameProgress)canvases.push({canvas:canvases.length,...e.forgeaxFrameProgress});if(e.shadowRoot)walk(e.shadowRoot);}};walk(document);
   const progress={canvases:canvases.map(c=>({canvas:c.canvas,submitted:c.submitted&&{frameId:c.submitted.frameId,worldIdentity:c.submitted.worldIdentity,deviceGeneration:c.submitted.deviceGeneration},completed:c.completed&&{frameId:c.completed.frameId,worldIdentity:c.completed.worldIdentity,deviceGeneration:c.completed.deviceGeneration,presentation:c.completed.presentation}}))};
   const pose=JSON.parse(document.documentElement.dataset.sceneAudit??'null');
   const worldIdentity=progress.canvases[0]?.completed?.worldIdentity;
   const result=typeof document.documentElement.sceneReadOptics==='function'&&worldIdentity?await document.documentElement.sceneReadOptics(worldIdentity):{ok:false,error:{code:'OPTICS_OBSERVER_MISSING'}};
   const afterPose=JSON.parse(document.documentElement.dataset.sceneAudit??'null');
   return {progress,pose,afterPose,result};
  });
  const completed=acceptedGpuCompletion(sample.progress),value=sample.result?.ok?sample.result.value:null;
  samples.push({canvasFrame:completed?.frameId??null,rendererFrame:value?.frame??null,problems:value?opticsProblems(value,audit.opticsInspection):[sample.result?.error?.code??'inspection-failed']});
  if(completed){
   if(start&&(completed.canvas!==start.canvas||completed.worldIdentity!==start.worldIdentity||completed.deviceGeneration!==start.deviceGeneration||completed.frameId<start.frameId))throw Error('OPTICS_GPU_IDENTITY_CHANGED');
   start??=completed;
  }
  if(completed&&poseMatches(sample.pose,expected)&&poseMatches(sample.afterPose,expected)&&value?.frame?.deviceGeneration===completed.deviceGeneration){
   // The fixed Engine admits at most four publications in flight. A pose ACK
   // can arrive ahead of its picture; retire that bounded prefix before using
   // renderer facts. This counts completed GPU frames, never wall-clock time.
   poseFence??=completed.frameId;
   if(completed.frameId<poseFence+4){await page.waitForTimeout(100);continue;}
   if(target&&resourceIdentity(value)!==resourceIdentity(target.value))target=null;
   if(target&&opticsProblems(value,audit.opticsInspection).length===0&&rendererFrameCompleted(value,target.frame)&&completed.frameId>target.canvasFrame){
    return {version:'completed-renderer-optics-v1',passed:true,index,worldIdentity:completed.worldIdentity,deviceGeneration:completed.deviceGeneration,
     canvasCompletedFrame:completed.frameId,rendererFrame:target.frame.frameId,inspection:target.value,samples,
     scope:'renderer frame retired by completion owner; canvas and renderer counters are independent; pose stable across inspection'};
   }
   if(!target&&opticsProblems(value,audit.opticsInspection).length===0)target={frame:value.frame,value,canvasFrame:completed.frameId};
  }else {target=null;poseFence=null;}
  await page.waitForTimeout(100);
 }
 const error=Error('OPTICS_OBSERVATION_GATE_TIMEOUT');error.evidence={version:'completed-renderer-optics-v1',passed:false,index,samples,target};throw error;
}
