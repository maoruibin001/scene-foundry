import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {withProviderRecovery,providerFault,recoveryWait,RECOVERY_POLICY,executionFaultOf,executionInterrupted} from './provider-recovery';
import {read,save} from './store';
import {PermitPool} from './concurrency';
import {recoveryStatus} from './recovery-status';
import {automaticRecoveryHTML} from '../public/recovery-ui.js';
import {modelTimeoutPolicy} from './model-selection';

test('临时断线自动退避继续，释放全局名额，每次调用与日志独立保存',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'provider-recovery-')),pool=new PermitPool(1);let n=0;const delays:number[]=[];
 try{const result=await withProviderRecovery({role:'scene-space'},dir,ctx=>pool.use('one',undefined,async()=>{n++;writeFileSync(join(dir,'scene-space-cli.log'),'真实测试子调用 '+n);writeFileSync(join(dir,'scene-space-tool-calls.jsonl'),JSON.stringify({index:n,error:n===1?'原始工具拒绝':null})+'\n');expect(ctx.recoveryAttempt).toBe(n-1);if(n===1)throw Error('PROVIDER_CODEX_FAILED: stream disconnected');return '完成';}),{wait:async(ms)=>{delays.push(ms);expect(pool.active.size).toBe(0);const state=read(join(dir,'scene-space-recovery.json'));expect(state.status).toBe('waiting');expect(automaticRecoveryHTML({id:'test',automaticRecovery:recoveryStatus(dir)})).toContain('等待自动恢复');}});
 expect(result).toBe('完成');expect(n).toBe(2);expect(delays).toEqual([5000]);expect(pool.active.size).toBe(0);const r=read(join(dir,'scene-space-recovery.json'));expect(r.status).toBe('completed');expect(r.attempts.map(a=>a.status)).toEqual(['failed','passed']);expect(await Bun.file(join(dir,'provider-attempts/scene-space/1/cli.log')).text()).toBe('真实测试子调用 1');expect(await Bun.file(join(dir,'provider-attempts/scene-space/2/cli.log')).text()).toBe('真实测试子调用 2');expect(automaticRecoveryHTML({id:'test',automaticRecovery:recoveryStatus(dir)})).toContain('已自动恢复');expect(JSON.parse(await Bun.file(join(dir,'provider-attempts/scene-space/1/tool-calls.jsonl')).text()).error).toBe('原始工具拒绝');expect(JSON.parse(await Bun.file(join(dir,'provider-attempts/scene-space/2/tool-calls.jsonl')).text()).error).toBeNull();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('超时恢复改变时限，仍超时则保留证据停止；不无限循环',async()=>{const dir=mkdtempSync(join(tmpdir(),'timeout-recovery-'));let n=0;try{await expect(withProviderRecovery({role:'scene-space'},dir,async ctx=>{n++;const p=modelTimeoutPolicy('xhigh','scene-space',ctx.recoveryAttempt,ctx.recoveryRemainingMs);expect(p.timeoutMs).toBe(n===1?1200000:1800000);throw Error('PROVIDER_TIMEOUT');},{wait:async()=>{}})).rejects.toThrow('PROVIDER_RECOVERY_EXHAUSTED');expect(n).toBe(2);expect(read(join(dir,'scene-space-recovery.json')).status).toBe('exhausted');}finally{rmSync(dir,{recursive:true,force:true})}});
test('503 和瞬时 429 可恢复；额度、权限、路由及未知错误不会付费重试',async()=>{expect(providerFault('PROVIDER_HTTP_503').recoverable).toBe(true);expect(providerFault('PROVIDER_HTTP_429 rate limit').recoverable).toBe(true);for(const msg of ['PROVIDER_HTTP_429 insufficient_quota','PROVIDER_HTTP_401','MODEL_ROUTE_UNVERIFIED','MODEL_BUDGET_EXHAUSTED','PROVIDER_INPUT_INVALID','unsupported schema']){const dir=mkdtempSync(join(tmpdir(),'hard-stop-'));let n=0;try{await expect(withProviderRecovery({role:'test'},dir,async()=>{n++;throw Error(msg)},{wait:async()=>{throw Error('不应等待')}})).rejects.toThrow(msg);expect(n).toBe(1);}finally{rmSync(dir,{recursive:true,force:true})}}});
test('取消会立刻终止退避，不产生下一次调用',async()=>{const dir=mkdtempSync(join(tmpdir(),'cancel-recovery-')),ctl=new AbortController();let n=0;try{await expect(withProviderRecovery({role:'test',signal:ctl.signal},dir,async()=>{n++;throw Error('PROVIDER_HTTP_503')},{wait:async(ms,signal)=>{setTimeout(()=>ctl.abort(),10);await recoveryWait(5000,signal)}})).rejects.toThrow();expect(n).toBe(1);expect(read(join(dir,'test-recovery.json')).status).toBe('cancelled');}finally{rmSync(dir,{recursive:true,force:true})}});
test('临时故障达到恢复上限即停止，累计预算错误不重复请求',async()=>{const dir=mkdtempSync(join(tmpdir(),'retry-limit-'));let n=0;try{await expect(withProviderRecovery({role:'test'},dir,async()=>{n++;throw Error('PROVIDER_HTTP_503')},{wait:async()=>{}})).rejects.toThrow('PROVIDER_RECOVERY_EXHAUSTED');expect(n).toBe(RECOVERY_POLICY.maxAttempts);n=0;await expect(withProviderRecovery({role:'budget'},dir,async()=>{n++;throw Error(n===1?'PROVIDER_HTTP_503':'MODEL_BUDGET_EXHAUSTED')},{wait:async()=>{}})).rejects.toThrow('MODEL_BUDGET_EXHAUSTED');expect(n).toBe(2);}finally{rmSync(dir,{recursive:true,force:true})}});
test('超过总时长不再请求，状态展示转义错误且不扫描导出项目',async()=>{const dir=mkdtempSync(join(tmpdir(),'recovery-time-'));let clock=100,n=0;try{await expect(withProviderRecovery({role:'test'},dir,async()=>{n++;clock+=RECOVERY_POLICY.maxElapsedMs;throw Error('PROVIDER_HTTP_503')},{now:()=>clock,wait:async()=>{}})).rejects.toThrow('PROVIDER_RECOVERY_EXHAUSTED');expect(n).toBe(1);const html=automaticRecoveryHTML({id:'job',automaticRecovery:[{role:'test',status:'exhausted',attempt:1,path:'test-recovery.json',reason:'<script>bad</script>',attempts:[]}]});expect(html).not.toContain('<script>');mkdirSync(join(dir,'project'));save(join(dir,'project/secret-recovery.json'),{version:'provider-recovery-v1',status:'blocked',role:'secret'});expect(recoveryStatus(dir).every(x=>x.role!=='secret')).toBe(true);}finally{rmSync(dir,{recursive:true,force:true})}});
test('热升级只接受指定旧调度器和指定新源码目录，不接管无关服务',async()=>{const {authorizedHandover}=await import('./concurrency');const owner={id:'old',pid:123},h={ownerId:'old',pid:123,successorRoot:'/new/src',endpoint:'http://127.0.0.1:19774'};expect(authorizedHandover(owner,h,'/new/src')).toBe(true);expect(authorizedHandover(owner,{...h,ownerId:'someone-else'},'/new/src')).toBe(false);expect(authorizedHandover(owner,h,'/wrong/src')).toBe(false);expect(authorizedHandover(owner,{...h,endpoint:'https://elsewhere'},'/new/src')).toBe(false);});

test('等待共享供应商名额也计入本次调用恢复上限，不会无限悬挂',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'queued-recovery-')),pool=new PermitPool(1),release=await pool.acquire('busy');let emitted=0;
 try{await expect(withProviderRecovery({role:'judge'},dir,ctx=>pool.use('waiting',ctx.signal,async()=>{emitted++;return '不应发出';}),{policy:{...RECOVERY_POLICY,maxElapsedMs:30}})).rejects.toThrow('PROVIDER_RECOVERY_EXHAUSTED');expect(emitted).toBe(0);expect(pool.waiting.length).toBe(0);expect(read(join(dir,'judge-recovery.json')).abortCause).toBe('parent');}
 finally{release();rmSync(dir,{recursive:true,force:true});}
});


test('内层恢复耗尽优先于嵌套超时或503，不能被外层任务识别为可再次恢复',()=>{
 for(const tail of ['PROVIDER_TIMEOUT','PROVIDER_HTTP_503','PROVIDER_HTTP_429 rate limit']){
  const error='Error: PROVIDER_RECOVERY_EXHAUSTED：停止；最后错误：Error: '+tail;
  expect(providerFault(error)).toMatchObject({kind:'exhausted',recoverable:false});
  const job={status:'blocked',error,autoResumeEligible:true,partialOutput:{completed:2},assetFailures:[{error:tail}],executionRecoveryPolicy:{version:'execution-recovery-v2',enabled:true}};
  expect(executionFaultOf(job).kind).toBe('exhausted');expect(executionInterrupted(job)).toBe(false);
  const partial={...job,error:'部分资产失败',assetFailures:[{error}]};expect(executionFaultOf(partial).kind).toBe('exhausted');expect(executionInterrupted(partial)).toBe(false);
 }
 expect(providerFault('PROVIDER_TIMEOUT').recoverable).toBe(true);
});
