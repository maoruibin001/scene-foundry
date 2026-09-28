import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {read,save} from './store';
import {providerFault,executionFaultOf} from './provider-recovery';
/** Explicit migration requests and service interruptions only; never replay old failures wholesale. */
export class AutomaticResumer{
 busy=false;
 constructor(readonly file:string,readonly deps:{list:()=>any[];executing:(id:string)=>boolean;resume:(job:any)=>Promise<any>}){}
 async tick(){if(this.busy)return;this.busy=true;try{
  const state=existsSync(this.file)?read(this.file):{requests:[]},jobs=this.deps.list();
  for(const job of jobs)if((job.autoResumeEligible||(job.executionRecoveryPolicy?.enabled&&!['running','queued','passed','cancelled'].includes(job.status)&&executionFaultOf(job).recoverable))&&!state.requests.some(r=>r.jobId===job.id))state.requests.push({jobId:job.id,reason:job.autoResumeEligible?'service-interrupted':'provider-interrupted',status:'pending',requestedAt:Date.now()});
  for(const request of state.requests){if(request.status!=='pending'||request.nextRetryAt>Date.now())continue;const source=jobs.find(j=>j.id===request.jobId);if(!source){request.status='blocked';request.reason='来源记录不存在';continue;}
   const existing=jobs.find(j=>j.recoverySourceJobId===source.id);if(existing){request.status='resumed';request.continuationId=existing.id;continue;}
   if(this.deps.executing(source.id)||['running','queued'].includes(source.status))continue;
   if(source.status==='cancelled'||source.status==='passed'){request.status='not-needed';continue;}
   const interrupted=source.autoResumeEligible||/服务重启中断/.test(source.error??'');
   if(!interrupted&&!executionFaultOf(source).recoverable){request.status='blocked';request.reason='此错误需要诊断或质量修正，不能通过重复提交恢复';continue;}
   if((source.automaticResumeCount??0)>=3){request.status='blocked';request.reason='执行恢复已达到三次连续续接上限；保留结果与中断记录，不计场景质量失败';continue;}
   try{const next=await this.deps.resume(source);request.status='resumed';request.continuationId=next.id;request.resumedAt=Date.now();}
   catch(error){request.dispatchAttempts=(request.dispatchAttempts??0)+1;request.error=String(error);const retry=providerFault(error).recoverable&&request.dispatchAttempts<3;request.status=retry?'pending':'blocked';request.nextRetryAt=retry?Date.now()+15000:null;request.reason=retry?'恢复准备临时中断，15秒后自动继续':'无法从已有产物自动恢复，保留来源与错误；不计场景质量失败';}
   save(this.file,state);
  }save(this.file,state);
 }finally{this.busy=false;}}
 start(){void this.tick();const timer=setInterval(()=>void this.tick().catch(error=>console.error('AUTOMATIC_RESUME_ERROR',String(error))),10000);timer.unref();return timer;}
}
