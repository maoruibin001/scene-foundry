export const active=(j:any)=>['queued','running'].includes(j.status);
export function terminalTime(j:any){if(Number.isFinite(j.endedAt))return j.endedAt;const e=[...(j.events??[])].reverse().find(e=>['complete','error','cancel','blocked'].includes(e.type));return e?Date.parse(e.at):Date.parse(j.updatedAt??'');}
export function elapsedTime(j:any,now=Date.now()){const start=Date.parse(j.createdAt??''),end=active(j)?now:terminalTime(j);return Number.isFinite(start)&&Number.isFinite(end)?Math.max(0,end-start):null;}
export function finishStage(step:any,status:string,now=Date.now(),error?:unknown){return {...step,status,endedAt:now,durationMs:Number.isFinite(step?.startedAt)?Math.max(0,now-step.startedAt):null,...(error===undefined?{}:{error:String(error)})};}
export function finishInterrupted(job:any,now=Date.now()){
 for(const [key,s] of Object.entries(job.stages??{}) as any)if(s.status==='running')job.stages[key]=finishStage(s,'interrupted',now,'服务重启，结束时间为发现中断的时间');
 for(const p of job.generationTimeline??[])if(p.status==='running')Object.assign(p,finishStage(p,'interrupted',now));
 job.endedAt=now;job.endTimeEstimated=true;
}
export function generationPhase(job:any,label:string,now=Date.now()){
 job.generationTimeline??=[];const previous=job.generationTimeline.at(-1);if(previous?.label===label&&previous.status==='running')return;
 if(previous?.status==='running')Object.assign(previous,finishStage(previous,'passed',now));
 job.generationTimeline.push({label,status:'running',startedAt:now});
}
export function finishGeneration(job:any,status:string,now=Date.now()){const last=job.generationTimeline?.at(-1);if(last?.status==='running')Object.assign(last,finishStage(last,status,now));}
