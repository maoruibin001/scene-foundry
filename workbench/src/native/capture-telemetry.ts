/** Small camera messages and exact Render Worker timing in a recording-only window. */
export class PartCheckCache {
 parts:any[]=[];revision=0;dirty=true;lastCheck=-Infinity;
 invalidate(){this.dirty=true;}
 sample(now:number,resolve:()=>any[]){
  const check=this.dirty||(this.parts.some(p=>!p.loaded)&&now-this.lastCheck>=1000);
  if(check){this.parts=resolve();this.revision++;this.dirty=false;this.lastCheck=now;}
  return {partsRevision:this.revision,...(check?{parts:this.parts}:{})};
 }
}
export const recordingBitrate=(width:number,height:number,fps=30)=>Math.min(8_000_000,Math.max(4_000_000,Math.round(width*height*fps*.16)));
export class RenderRecordingWindow {
 active=false;startAt=0;endAt=0;startFrame:number|null=null;endFrame:number|null=null;lastFrame:number|null=null;
 identity:any;submittedEvents=0;times:number[]=[];missingIntervals=0;error:string|null=null;observations:any[]=[];
 begin(at:number,frame:any){this.active=true;this.startAt=at;this.endAt=0;this.startFrame=Number.isSafeInteger(frame?.frameId)?frame.frameId:null;this.endFrame=this.startFrame;this.lastFrame=this.startFrame;this.identity=frame?.worldIdentity;this.times=[];this.submittedEvents=0;this.observations=[];this.missingIntervals=0;this.error=this.startFrame===null?'submitted-frame-missing':null;}
 submitted(frame:any){
  if(!this.active||!Number.isSafeInteger(frame?.frameId))return;
  if(this.identity!=null&&frame.worldIdentity!==this.identity)this.error='render-world-changed';
  if(this.lastFrame!==null&&frame.frameId<=this.lastFrame){if(frame.frameId<this.lastFrame)this.error='render-frame-reset';return;}
  // The first new draw can straddle the start boundary; exclude its interval.
  if(this.endFrame!==this.startFrame){if(Number.isFinite(frame.renderDrawIntervalMs)&&frame.renderDrawIntervalMs>0)this.times.push(frame.renderDrawIntervalMs);else this.missingIntervals++;}
  if(this.times.length>6000)this.error='recording-window-overflow';
  this.submittedEvents++;this.lastFrame=frame.frameId;this.endFrame=frame.frameId;
 }
 observe(state:any){if(this.active){if(this.observations.length>=3000){this.error='pose-window-overflow';return;}this.observations.push(state);}}
 finish(at:number){this.endAt=at;this.active=false;return this.snapshot();}
 snapshot(){return {version:'engine-render-recording-window-v1',source:'forgeax:frame-submitted/renderDrawIntervalMs',startAt:this.startAt,endAt:this.endAt,startFrame:this.startFrame,endFrame:this.endFrame,frameTimes:this.times,submittedEvents:this.submittedEvents,missingIntervals:this.missingIntervals,error:this.error};}
}
