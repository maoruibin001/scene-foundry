import {join} from 'node:path';
import {read} from './store';
import {active,terminalTime,elapsedTime} from './timing';
const optional=(p:string)=>{try{return read(p)}catch{return null}};
export const STAGE_NAMES={input:'接收输入',plan:'理解需求',graybox:'空间灰模与关系验收',generate:'生成与组装',repair:'自动视觉修正',export:'导出资源',build:'Engine 构建',verify:'校验资产',runtime:'运行与录制',judge:'视觉验收',spec:'制作规范',gate:'最终判定'};
export function timingSnapshot(job:any,dir:string,now=Date.now()){
 const end=active(job)?now:terminalTime(job),steps=optional(join(dir,'generation/checkpoints.json'))?.steps??[];
 const interval=(v:any,isCurrent=false)=>{const start=v?.startedAt,stop=v?.endedAt??(Number.isFinite(start)&&Number.isFinite(v?.durationMs)?start+v.durationMs:((v?.status==='running'||isCurrent)&&Number.isFinite(end)?end:null));return {start:start??null,end:stop,durationMs:v?.durationMs??(Number.isFinite(start)&&Number.isFinite(stop)?Math.max(0,stop-start):null)};};
 const stages=Object.entries(STAGE_NAMES).map(([id,label])=>{const s=job.stages?.[id],attempts=[...(job.stageAttempts?.[id]??[]),...(s?[s]:[])].map((a,i)=>({...a,...interval(a,a===s&&job.stage===id),index:i})),current=interval(s,job.stage===id);const durationMs=attempts.length?(attempts.every(a=>Number.isFinite(a.durationMs))?attempts.reduce((n,a)=>n+a.durationMs,0):null):current.durationMs;return {id,label,status:job.stage===id&&job.status==='cancelled'&&s?.status==='failed'?'cancelled':s?.status??'pending',reused:s?.reused??false,...current,durationMs,attempts,estimated:!!s&&!Number.isFinite(s.durationMs)&&!active(job)&&job.stage===id};});
 const inherited=new Set((optional(join(dir,'generation/resumed-from.json'))?.assets??[]).map((a:any)=>a.id));
 const assets=steps.map((s:any)=>{const folder=join(dir,'generation/assets',s.id),c=optional(join(folder,'checkpoint.json'))??{},reused=s.status==='reused'||!!c.reusedFrom||inherited.has(s.id);
 const attempts=optional(join(folder,'geometry-asset-attempts.json'))??['invalid-',''].flatMap(prefix=>{const r=optional(join(folder,'geometry-asset-'+prefix+'receipt.json'));return r?[{status:prefix?'failed':'passed',durationMs:r.durationMs,estimated:true}]:[]});
 return {id:s.id,label:s.label,status:reused?'reused':c.status??s.status,reused,readyAt:c.readyAt??null,queueMs:reused?0:Number.isFinite(c.readyAt)&&Number.isFinite(c.startedAt)?Math.max(0,c.startedAt-c.readyAt):null,...(reused?{start:null,end:null,durationMs:0}:interval(c)),historicalDurationMs:reused?c.durationMs:null,attempts:reused?[]:attempts,error:c.error??null};});
 const spans=assets.filter((a:any)=>!a.reused&&Number.isFinite(a.start)&&Number.isFinite(a.end));
 const wallMs=spans.length?Math.max(...spans.map((a:any)=>a.end))-Math.min(...spans.map((a:any)=>a.start)):null;
 const points=spans.flatMap((a:any)=>[{at:a.start,delta:1},{at:a.end,delta:-1}]).sort((a:any,b:any)=>a.at-b.at||a.delta-b.delta);let peak=0,n=0;for(const p of points){n+=p.delta;peak=Math.max(peak,n);}
 return {jobId:job.id,status:job.status,now,totalMs:elapsedTime(job,now),estimated:!!job.endTimeEstimated,concurrency:job.generationLimits?.assetConcurrency??job.executionSettings?.assetConcurrency??null,stages,phases:(job.generationTimeline??[]).map((p:any)=>({...p,...interval(p)})),assets,assetWallMs:wallMs,assetWorkMs:spans.reduce((n:number,a:any)=>n+a.durationMs,0),peakConcurrency:peak};
}
