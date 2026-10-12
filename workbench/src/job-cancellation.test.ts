import {test,expect} from 'bun:test';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {JsonReadCache} from './read-cache';
import {cancelJob,type JobExecution} from './job-cancellation';
import {abortDisposition,executionInterrupted} from './provider-recovery';
import {SceneQueue} from './concurrency';

function fixture(status='running'){
 const root=mkdtempSync(join(tmpdir(),'job-cancellation-')),file=join(root,'job.json'),artifact=join(root,'retained-output.json'),cache=new JsonReadCache();
 const quality={score:74.9,rawWeightedScore:67.04},initial={id:'one',status,events:[{type:'stage',message:'已完成资产',at:'2026-10-12T00:00:00.000Z'}],quality,retainedGraybox:{round:0,score:3.2}};
 writeFileSync(file,JSON.stringify(initial));writeFileSync(artifact,JSON.stringify({geometry:'immutable retained output'}));
 const hash=()=>createHash('sha256').update(readFileSync(artifact)).digest('hex'),before=hash(),job=cache.read(file),ctl=new AbortController(),executions=new Map<string,JobExecution>(),dequeued:string[]=[];
 const persist=(value:any)=>writeFileSync(file,JSON.stringify(value));
 const deps={read:()=>cache.read(file),dequeue:(id:string)=>dequeued.push(id),now:()=>12345,event:(value:any,type:string,message:string)=>{value.events.push({type,message,at:new Date(12345).toISOString()});persist(value);}};
 return {job,ctl,executions,dequeued,deps,persist,read:()=>JSON.parse(readFileSync(file,'utf8')),hash,before,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}

test('运行取消修改同一执行对象，之后阶段与最终保存不丢取消时间和事件',()=>{
 const f=fixture();try{
  f.executions.set('one',{job:f.job,controller:f.ctl});
  expect(f.deps.read()).not.toBe(f.job); // The production read cache returns independent clones.
  const cancelled=cancelJob('one',f.executions,f.deps);
  expect(cancelled).toBe(f.job);expect(f.ctl.signal.aborted).toBe(true);expect(f.dequeued).toEqual(['one']);
  f.job.error='AbortError: This operation was aborted';f.deps.event(f.job,'error',f.job.error);
  f.job.endedAt=12400;f.persist(f.job); // The running callback saves its existing object in finally.
  expect(f.read()).toMatchObject({status:'cancelled',cancelRequestedAt:12345,endedAt:12400});
  expect(f.read().events.map((e:any)=>e.type)).toEqual(['stage','cancel','error']);
  expect(f.read().quality).toEqual({score:74.9,rawWeightedScore:67.04});expect(f.hash()).toBe(f.before);
  expect(f.executions.has('one')).toBe(true); // Acknowledgement must not pretend execution cleanup has finished.
  f.executions.delete('one');expect(f.executions.has('one')).toBe(false);
 }finally{f.cleanup();}
});

test('复评执行对象也保留取消记录与已有评分，不复制或改写成品',()=>{
 const f=fixture();try{
  f.job.assessmentAttempt=1;f.job.stages={judge:{status:'running'}};
  f.executions.set('one',{job:f.job,controller:f.ctl});cancelJob('one',f.executions,f.deps);
  f.job.stages.judge.status='cancelled';f.persist(f.job);
  expect(f.read()).toMatchObject({status:'cancelled',cancelRequestedAt:12345,assessmentAttempt:1,stages:{judge:{status:'cancelled'}}});
  expect(f.read().events.filter((e:any)=>e.type==='cancel')).toHaveLength(1);expect(f.hash()).toBe(f.before);
 }finally{f.cleanup();}
});

test('排队取消从真实队列移除，零工作启动，保留已有文件',async()=>{
 const f=fixture('queued'),queue=new SceneQueue(0);let started=0;try{
  queue.enqueue('one','one',async()=>{started++;});
  cancelJob('one',f.executions,{...f.deps,dequeue:id=>queue.cancel(id)});queue.setLimit(1);await Promise.resolve();
  expect(started).toBe(0);expect(queue.pending).toHaveLength(0);expect(f.read()).toMatchObject({status:'cancelled',cancelRequestedAt:12345,endedAt:12345});expect(f.hash()).toBe(f.before);
 }finally{f.cleanup();}
});

test('默认 AbortError 仍是用户取消且不能被自动执行恢复复活',()=>{
 const f=fixture();try{
  f.executions.set('one',{job:f.job,controller:f.ctl});cancelJob('one',f.executions,f.deps);
  expect(abortDisposition(f.ctl.signal.reason)).toMatchObject({status:'cancelled',abortCause:'user'});
  expect(executionInterrupted({...f.read(),error:'PROVIDER_TIMEOUT',autoResumeEligible:true,executionRecoveryPolicy:{enabled:true}})).toBe(false);
 }finally{f.cleanup();}
});

test('重复取消和各终态拒绝，不中止其他任务或再写事件',()=>{
 for(const status of ['passed','failed','needs_review','blocked','cancelled']){
  const f=fixture(status);try{
   f.executions.set('one',{job:f.job,controller:f.ctl});
   expect(()=>cancelJob('one',f.executions,f.deps)).toThrow('任务已结束');
   expect(f.ctl.signal.aborted).toBe(false);expect(f.dequeued).toHaveLength(0);expect(f.read().events).toHaveLength(1);expect(f.read().status).toBe(status);
  }finally{f.cleanup();}
 }
});

test('无活动执行时只取消所请求的排队任务，不触碰其他控制器',()=>{
 const f=fixture('queued'),other={job:{id:'other',status:'running'},controller:new AbortController()};try{
  f.executions.set('other',other);cancelJob('one',f.executions,f.deps);
  expect(other.controller.signal.aborted).toBe(false);expect(other.job.status).toBe('running');expect(f.executions.size).toBe(1);expect(f.dequeued).toEqual(['one']);
 }finally{f.cleanup();}
});
