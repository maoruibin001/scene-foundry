import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {externalProviderBlock} from './provider-external-block';
import {providerFault,withProviderRecovery,executionFaultOf,executionInterrupted} from './provider-recovery';
import {rateLimitDelay,ProviderPressure} from './provider-pressure';
import {failureDisposition} from './output-delivery';
import {AutomaticResumer} from './automatic-resume';
import {collectAssetWorkers} from './geometry/asset-workers';
import {read,save} from './store';

// The observed CLI envelope, without private endpoint or billing-account details.
const cliBudget='PROVIDER_CODEX_FAILED: ERROR: Reconnecting... 1/5\nERROR: unexpected status 402 Payment Required: {"error":{"message":"insufficient budget: there is no sufficient budget for module","type":"UserBudgetExhausted","code":"2005"},"status":402}';

test('CLI预算与权限错误优先于重连、超时、限流提示，三条消费路径一致',()=>{
 const failures=[cliBudget,'UserBudgetExhausted','insufficient budget','no sufficient budget','PROVIDER_HTTP_429 insufficient_quota','unexpected status 402','HTTP/1.1 403 Forbidden','HTTP 401','status code: 402','{"status":402}','quota exceeded','usage limit','invalid api key','authentication failed','额度耗尽','余额不足'];
 for(const text of failures){const error=Error('Reconnecting... PROVIDER_TIMEOUT rate limit\n'+text);
  expect(externalProviderBlock(error)).toBe(true);
  expect(providerFault(error)).toMatchObject({kind:'hard',recoverable:false});
  expect(failureDisposition(error)).toMatchObject({kind:'external',retryable:false});
  expect(rateLimitDelay(error)).toBeNull();
  const pressure=new ProviderPressure();expect(pressure.limited(error,4)).toBe(false);expect(pressure.events).toBe(0);
 }
});

test('真实临时故障和普通内容不误判为外部预算，内部预算仍独立展示',()=>{
 for(const text of ['Reconnecting... stream terminated','PROVIDER_HTTP_503','PROVIDER_HTTP_429 rate limit','PROVIDER_TIMEOUT','预算最多402个三角形','step 402 succeeded','budget: 402','budget within limit'])expect(externalProviderBlock(text)).toBe(false);
 expect(providerFault('PROVIDER_HTTP_503')).toMatchObject({kind:'transient',recoverable:true});
 expect(rateLimitDelay('PROVIDER_HTTP_429 rate limit')).toBe(60000);
 expect(providerFault('PROVIDER_TIMEOUT')).toMatchObject({kind:'timeout',recoverable:true});
 expect(failureDisposition('MODEL_BUDGET_EXHAUSTED')).toMatchObject({kind:'budget',retryable:false});
 expect(providerFault('PROVIDER_RECOVERY_EXHAUSTED: '+cliBudget)).toMatchObject({kind:'exhausted',recoverable:false});
});

test('CLI余额耗尽只执行当前一次请求，零退避，保存失败和硬阻塞原因',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'external-budget-stop-'));let calls=0,waits=0;
 try{
  await expect(withProviderRecovery({role:'plan'},dir,async()=>{calls++;throw Error(cliBudget);},{wait:async()=>{waits++;}})).rejects.toThrow('UserBudgetExhausted');
  expect(calls).toBe(1);expect(waits).toBe(0);
  const saved=read(join(dir,'plan-recovery.json'));expect(saved).toMatchObject({status:'blocked',attempt:1,nextRetryAt:null});expect(saved.attempts).toHaveLength(1);expect(saved.attempts[0]).toMatchObject({status:'failed',fault:'hard'});
  expect(read(join(dir,'provider-attempts/plan/1/attempt.json')).error).toContain('UserBudgetExhausted');
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('旧服务恢复标记及已排队的恢复请求不能覆盖供应商硬阻塞',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'external-budget-resumer-'));let calls=0;
 const jobs=[
  {id:'ordinary',status:'blocked',error:cliBudget,executionRecoveryPolicy:{enabled:true}},
  {id:'stale-service',status:'blocked',error:cliBudget,autoResumeEligible:true},
  {id:'partial',status:'needs_review',error:'部分资产失败',autoResumeEligible:true,executionRecoveryPolicy:{version:'execution-recovery-v2',enabled:true},partialOutput:{completed:3,total:4},assetFailures:[{error:cliBudget}]},
 ];
 const before=JSON.stringify(jobs);
 try{const file=join(dir,'requests.json');save(file,{requests:[{jobId:'ordinary',status:'pending',reason:'service-interrupted'}]});
  const resumer=new AutomaticResumer(file,{list:()=>jobs,executing:()=>false,resume:async()=>{calls++;return {id:'unexpected'};}});
  await resumer.tick();await resumer.tick();expect(calls).toBe(0);expect(JSON.stringify(jobs)).toBe(before);
  expect(read(file).requests).toHaveLength(3);
  for(const request of read(file).requests)expect(request).toMatchObject({status:'blocked',requiresDiagnosis:true});
  for(const job of jobs){expect(executionFaultOf(job)).toMatchObject({kind:'hard',recoverable:false});expect(executionInterrupted(job)).toBe(false);}
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('并发资产遇到CLI硬阻塞停止新派发，在途清理后保留原错误',async()=>{
 const started:number[]=[];let cleaned=false;
 const result=await collectAssetWorkers([0,1,2,3],2,new AbortController().signal,async(n,_i,signal)=>{
  started.push(n);if(n===1)throw Error(cliBudget);
  await new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true}));cleaned=true;signal.throwIfAborted();return n;
 },error=>['budget','external','configuration'].includes(failureDisposition(error).kind));
 expect(started).toEqual([0,1]);expect(cleaned).toBe(true);expect(result.fatal).toContain('UserBudgetExhausted');expect(result.values).toHaveLength(0);
});
