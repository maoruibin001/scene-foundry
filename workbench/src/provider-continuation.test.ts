import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {providerFault,automaticContinuationOptions,executionInterrupted,withProviderRecovery} from './provider-recovery';
import {AutomaticResumer} from './automatic-resume';
import {read} from './store';
import {versionStats} from './versions';
import {batchGate,DEFAULT_POLICY} from './quality';
import {automaticRecoveryHTML} from '../public/recovery-ui.js';

test('codex传输结束和空输出可恢复，身份、额度和未知代码故障不能盲重试',()=>{
 for(const error of ['PROVIDER_CODEX_FAILED: stream terminated before completion','PROVIDER_CODEX_FAILED: unexpected EOF','PROVIDER_EMPTY_OUTPUT','socket hang up'])expect(providerFault(error).recoverable).toBe(true);
 for(const error of ['PROVIDER_CODEX_FAILED: command not found','PROVIDER_HTTP_401 stream terminated','MODEL_BUDGET_EXHAUSTED stream closed'])expect(providerFault(error).recoverable).toBe(false);
});
test('新任务默认登记模型中断并只续接一次，不复活历史任务或用户取消',async()=>{
 const d=mkdtempSync(join(tmpdir(),'continuation-')),jobs:any[]=[{id:'active',status:'blocked',error:'PROVIDER_RECOVERY_EXHAUSTED: stream terminated before completion',executionRecoveryPolicy:{enabled:true}},{id:'old',status:'blocked',error:'PROVIDER_TIMEOUT'},{id:'cancel',status:'cancelled',error:'PROVIDER_TIMEOUT',executionRecoveryPolicy:{enabled:true}},{id:'hard',status:'blocked',error:'MODEL_BUDGET_EXHAUSTED',executionRecoveryPolicy:{enabled:true}}];let calls=0;
 try{const x=new AutomaticResumer(join(d,'requests.json'),{list:()=>jobs,executing:()=>false,resume:async s=>{calls++;const j={id:'next',recoverySourceJobId:s.id,...automaticContinuationOptions(s,true)};jobs.push(j);return j;}});await Promise.all([x.tick(),x.tick()]);await x.tick();expect(calls).toBe(1);expect(read(join(d,'requests.json')).requests).toHaveLength(1);expect(jobs.at(-1).attempt).toBe(1);expect(jobs.at(-1).automaticResumeCount).toBe(1);}finally{rmSync(d,{recursive:true,force:true});}
});
test('自动续接保持生成次数，只有人工新尝试才递增',()=>{
 const s={id:'job',attempt:2,retryRoot:'original',automaticResumeCount:1};expect(automaticContinuationOptions(s,true)).toMatchObject({attempt:2,retryRoot:'original',automaticResumeCount:2,validationKind:'execution-continuation'});expect(automaticContinuationOptions(s,false).attempt).toBe(3);
});
test('恢复调度临时断线会自动再试，硬预算直接保留阻塞',async()=>{
 const d=mkdtempSync(join(tmpdir(),'continuation-dispatch-'));try{const file=join(d,'requests.json'),j={id:'job',status:'blocked',error:'PROVIDER_TIMEOUT',executionRecoveryPolicy:{enabled:true}};const x=new AutomaticResumer(file,{list:()=>[j],executing:()=>false,resume:async()=>{throw Error('ECONNRESET')}});await x.tick();expect(read(file).requests[0]).toMatchObject({status:'pending',dispatchAttempts:1});await x.tick();expect(read(file).requests[0].dispatchAttempts).toBe(1);}finally{rmSync(d,{recursive:true,force:true});}
});
test('执行中断不进入质量失败分母，固定认证仍保持未完成不能抬高成功率',()=>{
 const j:any={id:'one',status:'blocked',error:'PROVIDER_TIMEOUT',createdAt:'2026-09-28',profile:{id:'p'},batchId:'b',caseId:'c',attempt:1};expect(executionInterrupted(j)).toBe(true);const stats=versionStats([j]);expect(stats.finished).toBe(0);expect(stats.rate).toBe(null);expect(stats.executionInterruptions).toBe(1);
 const gate=batchGate({id:'b',cases:[{id:'c',mode:'image'}]},[j],DEFAULT_POLICY);expect(gate.complete).toBe(false);expect(gate.status).toBe('unverified');expect(gate.n).toBe(1);
 const failed={...j,error:null,status:'failed',quality:{score:50}};expect(versionStats([failed]).finished).toBe(1);expect(versionStats([failed]).rate).toBe(0);
});
test('恢复UI独立展示原始任务和不递增的生成轮次',()=>{
 const text=automaticRecoveryHTML({id:'new',attempt:1,automaticRecoveryFrom:'original'});expect(text).toContain('沿用第 1 次生成');expect(text).toContain('不计一次场景质量失败');expect(text).toContain('#job/original');
});
test('传输失败后同一逻辑调用继续，完整保留两次执行记录',async()=>{
 const d=mkdtempSync(join(tmpdir(),'continuation-call-'));let n=0;try{const result=await withProviderRecovery({role:'geometry-asset'},d,async()=>{if(++n===1)throw Error('PROVIDER_EMPTY_OUTPUT');return {scene:'saved'};},{wait:async()=>{}});expect(result).toEqual({scene:'saved'});const r=read(join(d,'geometry-asset-recovery.json'));expect(r.status).toBe('completed');expect(r.attempts).toHaveLength(2);}finally{rmSync(d,{recursive:true,force:true});}
});

test('执行输出卡片识别断流为恢复而非未知管线失败',async()=>{const {failureDisposition}=await import('./output-delivery');expect(failureDisposition('PROVIDER_EMPTY_OUTPUT')).toMatchObject({kind:'transient',retryable:true});});
