import {existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {DATA,read,runDir,listJobs,getJob} from './store';
import {active,terminalTime} from './timing';

const time=(v:any):number|null=>typeof v==='number'&&Number.isFinite(v)?v:typeof v==='string'&&Number.isFinite(Date.parse(v))?Date.parse(v):null;
const parents=(j:any)=>[j.recoverySourceJobId,j.automaticRecoveryFrom,j.reuseAssessmentFrom,j.reuseSceneFrom,j.retryRoot,j.executionRecoveryRoot].filter((id)=>id&&id!==j.id);
const sameInput=(a:any,b:any)=>a.prompt===b.prompt&&JSON.stringify((a.images??[]).map((x:any)=>x.id))===JSON.stringify((b.images??[]).map((x:any)=>x.id));
/** Explicit production ancestry only: material reuse or matching prompt alone never joins two cases. */
export function productionFamily(job:any,jobs:any[]){
 const byId=new Map(jobs.map(j=>[j.id,j])),selected=new Map<string,any>(),missing=new Set<string>();
 const visit=(j:any)=>{if(selected.has(j.id))return;selected.set(j.id,j);for(const id of parents(j)){const p=byId.get(id);if(p)visit(p);else missing.add(id);}};visit(job);
 let changed=true;while(changed){changed=false;for(const j of jobs)if(!selected.has(j.id)&&sameInput(j,job)&&parents(j).some(id=>selected.has(id))){visit(j);changed=true;}}
 return {jobs:[...selected.values()].sort((a,b)=>(time(a.createdAt)??Infinity)-(time(b.createdAt)??Infinity)),missing:[...missing]};
}
export function unionDuration(spans:[number,number][]){let end=-Infinity,total=0;for(const [a,b] of [...spans].sort((x,y)=>x[0]-y[0])){if(b>a){total+=Math.max(0,b-Math.max(a,end));end=Math.max(end,b);}}return total;}
export type Milestone={jobId:string;kind:'graybox'|'partial'|'scene'|'evaluation';scope?:'scene'|'partial';at:number;iteration?:number|null;formalPassed?:boolean;stage70Passed?:boolean;formalScore?:number;diagnosticScore?:number|null};
export function productionTimeline(job:any,jobs:any[],evidence:Milestone[]=[],now=Date.now(),pendingIds:string[]=[]){
 const family=productionFamily(job,jobs),rows=family.jobs,ids=new Set(rows.map(j=>j.id)),stamps=rows.map(j=>time(j.createdAt));
 const startedAt=stamps.every(t=>t!==null)&&!family.missing.length?Math.min(...stamps as number[]):null;
 const marks=evidence.filter(e=>ids.has(e.jobId)&&Number.isFinite(e.at)&&(startedAt===null||e.at>=startedAt)&&e.at<=now).sort((a,b)=>a.at-b.at);
 const first=(fn:(e:Milestone)=>boolean)=>marks.find(fn)??null;
 const success=first(e=>e.kind==='evaluation'&&e.scope!=='partial'&&e.formalPassed===true),stage70=first(e=>e.kind==='evaluation'&&e.scope!=='partial'&&e.stage70Passed===true);
 const running=rows.some(j=>active(j)||pendingIds.includes(j.id));
 const rowEnd=(j:any)=>active(j)?now:time(terminalTime(j));
 const ends=rows.map(rowEnd),endedAt=success?.at??(running?now:ends.every(t=>t!==null)?Math.max(...ends as number[]):null);
 const duration=(a:number|null,b:number|null)=>a!==null&&b!==null&&b>=a?b-a:null;
 const totalMs=duration(startedAt,endedAt),clip=(a:number|null,b:number|null):[number,number]|null=>a!==null&&b!==null&&startedAt!==null&&endedAt!==null&&b>=a?[Math.max(a,startedAt),Math.min(b,endedAt)]:null;
 const runs=rows.filter(j=>endedAt===null||(time(j.createdAt)??Infinity)<=endedAt).map(j=>{
  const submitted=time(j.createdAt),start=time(j.startedAt),rawEnd=rowEnd(j),end=rawEnd===null?null:Math.min(rawEnd,endedAt??rawEnd),queuedEnd=start??(['queued','cancelled','blocked'].includes(j.status)?end:null);
  return {id:j.id,status:j.status,stage:j.stage,version:j.pipelineVersion?.label??null,submittedAt:submitted,startedAt:start,endedAt:end,queueMs:duration(submitted,queuedEnd),executionMs:start===null?(j.status==='queued'?0:null):duration(start,end),estimated:!!j.endTimeEstimated||!active(j)&&!Number.isFinite(j.endedAt),kind:j.reuseAssessmentFrom?'重新评估':j.recoverySourceJobId||j.automaticRecoveryFrom?'执行恢复':j.refineScene?'质量修正':'生成',queueSpan:clip(submitted,queuedEnd),runSpan:clip(start,end)};
 });
 const executionMs=runs.every(r=>r.runSpan||r.executionMs===0)&&totalMs!==null?unionDuration(runs.flatMap(r=>r.runSpan?[r.runSpan]:[])):null;
 const queueMs=runs.every(r=>r.queueSpan)&&totalMs!==null?unionDuration(runs.map(r=>r.queueSpan!)):null;
 // Queue can overlap another branch's execution; use a union, never add parallel spans.
 const occupied=unionDuration(runs.flatMap(r=>[r.runSpan,r.queueSpan].filter(Boolean) as [number,number][]));
 const unexecutedMs=executionMs!==null&&queueMs!==null&&totalMs!==null?Math.max(0,totalMs-occupied):null;
 return {version:'production-timing-v1',jobId:job.id,rootJobId:rows[0]?.id,startedAt,observedAt:now,endedAt,totalMs,successAt:success?.at??null,successMs:success?duration(startedAt,success.at):null,status:success?'passed':running?'running':'stopped',stage70At:stage70?.at??null,stage70Ms:stage70?duration(startedAt,stage70.at):null,firstOutputAt:first(e=>e.kind==='graybox'||e.kind==='partial'||e.kind==='scene')?.at??null,firstSceneAt:first(e=>e.kind==='scene')?.at??null,firstAssessmentAt:first(e=>e.kind==='evaluation'&&e.scope!=='partial')?.at??null,firstPartialAssessmentAt:first(e=>e.kind==='evaluation'&&e.scope==='partial')?.at??null,partialAssessments:marks.filter(e=>e.kind==='evaluation'&&e.scope==='partial').length,executionMs,queueMs,unexecutedMs,estimated:runs.some(r=>r.estimated),missingAncestors:family.missing,executionRecoveries:rows.filter(r=>r.recoverySourceJobId||r.automaticRecoveryFrom).length,assessedRounds:marks.filter(e=>e.kind==='evaluation'&&e.scope!=='partial'&&Number.isInteger(e.iteration)).length,reassessments:runs.filter(r=>r.kind==='重新评估').length,runs:runs.map(({queueSpan,runSpan,...r})=>r),milestones:marks,notes:['总历时从首次提交开始，包含排队、模型等待、恢复与暂停；只有正式验收通过才记录制作成功。','执行阶段历时包含模型等待，重叠区间取并集；不能相加各并行资产耗时作为总耗时。','未执行间隔包含恢复、人工暂停等；没有原因记录时不推断。技术恢复与质量轮次分别统计。','70分阶段达标与正式80分规范通过分别记录。']};
}
const optional=(p:string)=>{try{return read(p);}catch{return null;}};
const HARD=['framing','cameraMotion','nonFlat','multipleViews','entitiesLoaded','frameRate','runtime','noErrors','hudToggle','video','cameraStopped'];
const WEIGHTS={spatial:32,coverage:28,material:20,shape:12,readability:8};
function evaluation(job:any,fields:any,folder:string,at:any,iteration:number|null):Milestone|null{
 const timestamp=time(at),score=fields?.quality?.score;if(timestamp===null||!Number.isFinite(score))return null;
 const runtime=fields.runtime,report=optional(join(folder,'project/evidence/run-report.json'));
 const engine=!!runtime&&/^[a-f0-9]{64}$/.test(runtime.distManifestDigest??'')&&HARD.every(k=>runtime.hard?.[k]===true)&&report?.distManifestDigest===runtime.distManifestDigest&&['engine-build','catalog','asset-verify','asset-ready','engine-status'].every(k=>report?.stages?.[k]?.status==='passed');
 const dimensions=Array.isArray(fields.review?.dimensions)?fields.review.dimensions:[],valid=Object.keys(WEIGHTS).every(k=>{const values=dimensions.filter((d:any)=>d.id===k);return values.length===1&&Number.isFinite(values[0].score)&&values[0].score>=0&&values[0].score<=5;});
 const diagnosticScore=valid?Math.round(Object.entries(WEIGHTS).reduce((n,[k,w])=>n+dimensions.find((d:any)=>d.id===k).score*w/5,0)*100)/100:null;
 const weightsMatch=Object.entries(WEIGHTS).every(([k,w])=>job.policy?.dimensionWeights?.[k]===w);
 const partial=!!fields.partialOutput||fields.assessmentScope==='partial';
 return {jobId:job.id,kind:'evaluation',scope:partial?'partial':'scene',at:timestamp,iteration:partial?null:iteration,formalScore:score,diagnosticScore,formalPassed:!partial&&engine&&fields.quality.status==='passed'&&fields.spec?.status==='passed',stage70Passed:!partial&&engine&&weightsMatch&&score>=70&&diagnosticScore!==null&&diagnosticScore>=70};
}
export function productionTimingSnapshot(id:string,now=Date.now()){
 const job=getJob(id),jobs=listJobs(),family=productionFamily(job,jobs),evidence:Milestone[]=[];
 for(const row of family.jobs){const dir=runDir(row.id),outputs=join(dir,'delivery/outputs');
  if(existsSync(outputs))for(const n of readdirSync(outputs)){if(!/^(scene|graybox|partial)-[a-f0-9]{16}$/.test(n))continue;const o=optional(join(outputs,n,'output.json')),at=time(o?.createdAt);if(at!==null&&['scene','graybox','partial'].includes(o?.kind))evidence.push({jobId:row.id,kind:o.kind,at});}
  const iterations=join(dir,'iterations');let evaluated=false;
  if(existsSync(iterations))for(const n of readdirSync(iterations)){if(!/^\d+$/.test(n))continue;const folder=join(iterations,n),c=optional(join(folder,'candidate.json'));if(c?.jobId!==row.id)continue;const e=evaluation(row,c.fields,folder,c.cycle?.endedAt,row.reuseAssessmentFrom?null:Number(n));if(e){evidence.push(e);evaluated=true;}}
  if(!evaluated&&row.quality){const at=row.stages?.gate?.endedAt??row.endedAt,e=evaluation(row,row,dir,at,row.reuseAssessmentFrom?null:0);if(e)evidence.push(e);}
 }
 const requests=optional(join(DATA,'automatic-recovery-requests-v2.json'))?.requests??[];
 return productionTimeline(job,jobs,evidence,now,requests.filter((r:any)=>r.status==='pending').map((r:any)=>r.jobId));
}
