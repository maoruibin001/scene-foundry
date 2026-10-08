import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {AutomaticResumer} from './automatic-resume';
import {save,read} from './store';
test('自动恢复已登记的超时任务，运行中不打断，已恢复记录不重复提交',async()=>{const dir=mkdtempSync(join(tmpdir(),'auto-resume-')),file=join(dir,'requests.json');const jobs:any[]=[{id:'one',status:'blocked',error:'PROVIDER_TIMEOUT'},{id:'two',status:'running'}];let n=0;try{save(file,{requests:jobs.map(j=>({jobId:j.id,status:'pending'}))});const worker=new AutomaticResumer(file,{list:()=>jobs,executing:id=>jobs.find(j=>j.id===id)?.status==='running',resume:async j=>{n++;const child={id:'child-'+j.id,recoverySourceJobId:j.id};jobs.push(child);return child;}});await Promise.all([worker.tick(),worker.tick()]);expect(n).toBe(1);await worker.tick();expect(n).toBe(1);expect(read(file).requests.map(x=>x.status)).toEqual(['resumed','pending']);jobs[1].status='blocked';jobs[1].error='PROVIDER_HTTP_503';await worker.tick();expect(n).toBe(2);}finally{rmSync(dir,{recursive:true,force:true})}});
test('重启中断自动恢复，取消、硬阻塞和历史失败不会被批量重跑',async()=>{const dir=mkdtempSync(join(tmpdir(),'resume-scope-')),file=join(dir,'requests.json');let n=0;const jobs:any[]=[{id:'interrupted',status:'blocked',autoResumeEligible:true,error:'服务重启中断'},{id:'cancel',status:'cancelled'},{id:'quota',status:'blocked',error:'PROVIDER_HTTP_429 insufficient_quota'},{id:'historical',status:'blocked',error:'PROVIDER_TIMEOUT'}];try{save(file,{requests:[{jobId:'cancel',status:'pending'},{jobId:'quota',status:'pending'}]});const worker=new AutomaticResumer(file,{list:()=>jobs,executing:()=>false,resume:async j=>{n++;return {id:'child-'+j.id}}});await worker.tick();expect(n).toBe(1);expect(read(file).requests).toHaveLength(3);expect(read(file).requests.find(r=>r.jobId==='quota').status).toBe('blocked');await worker.tick();expect(n).toBe(1);}finally{rmSync(dir,{recursive:true,force:true})}});
test('连续中断上限和恢复异常保存明确阻塞，重启不重复付费',async()=>{const dir=mkdtempSync(join(tmpdir(),'resume-error-')),file=join(dir,'requests.json');let n=0;const jobs=[{id:'loop',status:'blocked',autoResumeEligible:true,automaticResumeCount:3},{id:'error',status:'blocked',autoResumeEligible:true}];try{const worker=new AutomaticResumer(file,{list:()=>jobs,executing:()=>false,resume:async()=>{n++;throw Error('MODEL_BUDGET_EXHAUSTED')}});await worker.tick();expect(n).toBe(1);await worker.tick();expect(n).toBe(1);expect(read(file).requests.every(r=>r.status==='blocked')).toBe(true);}finally{rmSync(dir,{recursive:true,force:true})}});


test('调用已耗尽时挂起恢复请求；重启标记和多次tick不重置调用上限',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'resume-exhausted-')),file=join(dir,'requests.json');let dispatched=0;
 const jobs=[{id:'exhausted',status:'blocked',error:'PROVIDER_RECOVERY_EXHAUSTED：最后错误：PROVIDER_TIMEOUT',autoResumeEligible:true,executionRecoveryPolicy:{enabled:true}},{id:'explicit',status:'blocked',error:'PROVIDER_RECOVERY_EXHAUSTED：最后错误：PROVIDER_HTTP_503'}];
 try{save(file,{requests:[{jobId:'explicit',status:'pending'}]});const worker=new AutomaticResumer(file,{list:()=>jobs,executing:()=>false,resume:async()=>{dispatched++;return {id:'bad'}}});await worker.tick();await worker.tick();
 expect(dispatched).toBe(0);expect(read(file).requests).toHaveLength(2);expect(read(file).requests.every(r=>r.status==='blocked'&&r.requiresDiagnosis)).toBe(true);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
