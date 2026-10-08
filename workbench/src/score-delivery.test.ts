import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {matchingPolicy,productionWindow,remainingProductionMs} from './matching-level';
import {abortDisposition,executionFaultOf,withProviderRecovery} from './provider-recovery';
import {AutomaticResumer} from './automatic-resume';
import {recoveryInfo} from './recovery';
import {read} from './store';
test('旧的一小时时窗只有用户明确继续才扩展，保留原提交与旧截止证据',()=>{
 const source={productionWindow:{version:'first-score-window-v1',startedAt:1000,workDeadlineAt:3001000,scoreDeadlineAt:3601000,targetMs:3600000}};
 const job={matchingPolicy:matchingPolicy('standard'),createdAt:new Date(8001000).toISOString()};
 expect(productionWindow(job,source)).toEqual(source.productionWindow);
 const w=productionWindow(job,source,true,8001000);expect(w.startedAt).toBe(1000);expect(w.targetAt).toBe(3601000);expect(w.preferredAt).toBe(7201000);expect(w.workDeadlineAt).toBe(10401000);expect(w.extensions[0].previousScoreDeadlineAt).toBe(3601000);
 expect(remainingProductionMs({...job,productionWindow:w},'judge',12000000)).toBe(Infinity);expect(source.productionWindow.scoreDeadlineAt).toBe(3601000);
 const child=productionWindow(job,{productionWindow:w});expect(child.extensions).toHaveLength(1);expect(child.workDeadlineAt).toBe(w.workDeadlineAt);
});
test('用户取消、制作到期、父步骤异常独立分类，不伪装用户取消',async()=>{
 expect(abortDisposition(new DOMException('deadline','TimeoutError'))).toMatchObject({status:'blocked',abortCause:'deadline'});
 expect(abortDisposition(new DOMException('user','AbortError'))).toMatchObject({status:'cancelled',abortCause:'user'});
 expect(abortDisposition(Error('MODEL_BUDGET_EXHAUSTED'))).toMatchObject({status:'blocked',abortCause:'parent'});
 const dir=mkdtempSync(join(tmpdir(),'deadline-label-')),ctl=new AbortController();
 try{await expect(withProviderRecovery({role:'judge',signal:ctl.signal},dir,async()=>{ctl.abort(new DOMException('deadline','TimeoutError'));throw ctl.signal.reason;})).rejects.toThrow();expect(read(join(dir,'judge-recovery.json'))).toMatchObject({status:'blocked',abortCause:'deadline'});expect(read(join(dir,'judge-recovery.json')).reason).not.toContain('用户取消');expect(read(join(dir,'judge-recovery.json')).attempts[0]).toMatchObject({status:'blocked',abortCause:'deadline'});}finally{rmSync(dir,{recursive:true,force:true});}
});
test('未评分的真实草稿优先继续评分，已评分草稿才补齐资产',()=>{
 const partial={id:'00000000-0000-0000-0000-000000000001',status:'needs_review',stage:'assets',runtime:{},plan:{},structure:{},partialOutput:{missing:[{id:'window'}]}};
 expect(recoveryInfo(partial,[],undefined,'/missing')).toMatchObject({available:true,mode:'assessment'});
});
test('独立资产瞬态错误保留到任务恢复；硬阻塞和已到制作窗不恢复，历史记录不批量唤醒',async()=>{
 const fresh:any={id:'new',status:'needs_review',error:'资产未齐',partialOutput:{missing:[{id:'window'}]},quality:{score:60},assetFailures:[{error:'PROVIDER_HTTP_429 rate limit exceeded'}],executionRecoveryPolicy:{version:'execution-recovery-v2',enabled:true}};
 expect(executionFaultOf(fresh).recoverable).toBe(true);expect(executionFaultOf({...fresh,assetFailures:[{error:'PROVIDER_RECOVERY_EXHAUSTED: rate limit exceeded'}]}).recoverable).toBe(false);expect(executionFaultOf({...fresh,executionRecoveryPolicy:{version:'execution-recovery-v1',enabled:true}}).recoverable).toBe(false);
 expect(executionFaultOf({...fresh,executionFault:'MODEL_BUDGET_EXHAUSTED'}).recoverable).toBe(false);
 expect(executionFaultOf({...fresh,assetFailures:[...fresh.assetFailures,{error:'PROVIDER_HTTP_401'}]}).recoverable).toBe(false);
 expect(executionFaultOf({...fresh,productionWindow:{workDeadlineAt:1}}).recoverable).toBe(false);
 const d=mkdtempSync(join(tmpdir(),'partial-continuation-'));let n=0;try{const jobs=[fresh],resumer=new AutomaticResumer(join(d,'requests.json'),{list:()=>jobs,executing:()=>false,resume:async j=>{n++;const child={id:'next',recoverySourceJobId:j.id,status:'running'};jobs.push(child);return child;}});await resumer.tick();await resumer.tick();expect(n).toBe(1);}finally{rmSync(d,{recursive:true,force:true});}
});
