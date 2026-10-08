import {existsSync,copyFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {read,save} from './store';
import {rateLimitDelay} from './provider-pressure';
import {externalProviderBlock} from './provider-external-block';

export const RECOVERY_POLICY={version:'provider-recovery-v1',maxAttempts:3,maxTimeouts:2,maxElapsedMs:60*60*1000,delaysMs:[5000,15000]};
export const ACTIVE_RECOVERY_POLICY=process.env.PIPELINE_PROVIDER_RECOVERY==='single-attempt'?{...RECOVERY_POLICY,maxAttempts:1,maxTimeouts:1,maxElapsedMs:Number(process.env.PIPELINE_EXECUTION_MAX??3)>3?30*60*1000:15*60*1000}:RECOVERY_POLICY;
export function providerFault(error:unknown){
 const s=String(error);
 if(/PROVIDER_RECOVERY_EXHAUSTED/.test(s))return {kind:'exhausted',recoverable:false,reason:'当前逻辑调用已用尽有界恢复；保留尝试，先诊断或改变已验证条件，不能换任务重置重试次数'};
 if(/PROVIDER_INPUT_TOO_LARGE|input_too_large|Input exceeds the maximum length/i.test(s))return {kind:'input',recoverable:false,reason:'模型输入超过接口容量；需修复输入组织后再恢复，不重试同一请求'};
 if(externalProviderBlock(error))return {kind:'hard',recoverable:false,reason:'供应商额度或授权不可用，需要外部恢复后才能继续；不重试同一请求'};
 if(/IMPROVEMENT_STOPPED|MODEL_BUDGET_EXHAUSTED|MODEL_ROUTE_UNVERIFIED|CODEX_ROUTE_UNVERIFIED|NOT_CONFIGURED|PROVIDER_PAUSED|PROVIDER_INPUT_INVALID|PROVIDER_HTTP_(?:400|404|413|422)/i.test(s))return {kind:'hard',recoverable:false,reason:'预算、认证、输入或模型路由需要修复后才能继续'};
 if(rateLimitDelay(error)!==null)return {kind:'transient',recoverable:true,reason:'供应商限流；等待请求窗口恢复并统一降低并发'};
 if(/PROVIDER_TIMEOUT|^TimeoutError:/.test(s))return {kind:'timeout',recoverable:true,reason:'模型调用超时；保留已完成步骤，使用延长后的时限恢复当前调用'};
 if(/PROVIDER_HTTP_(?:408|429|500|502|503|504)|fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|connection (?:reset|closed)|network|stream (?:disconnected|closed|terminated)|stream.*before completion|unexpected (?:eof|end of (?:file|stream))|socket hang up|connection (?:aborted|terminated)|PROVIDER_EMPTY_OUTPUT|reconnecting|temporarily unavailable|rate limit|overloaded/i.test(s))return {kind:'transient',recoverable:true,reason:'临时网络、限流或服务异常；退避后恢复当前调用'};
 return {kind:'unknown',recoverable:false,reason:'没有可验证的自动恢复方式，保留错误与产物供诊断'};
}
export function recoveryWait(ms:number,signal?:AbortSignal){signal?.throwIfAborted();return new Promise<void>((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(signal?.reason??Error('CANCELLED'));};const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);signal?.addEventListener('abort',abort,{once:true});});}
const suffixes=['prompt.json','response.txt','partial-response.txt','parsed.json','receipt.json','input-receipt.json','execution.json','failure.json','stdout.log','cli.log','tool-calls.jsonl'];
/** Retry only recoverable provider faults. Each request reacquires its permit and budget. */
export async function withProviderRecovery<T>(input:{role:string;signal?:AbortSignal},dir:string,request:(context:{recoveryAttempt:number;recoveryRemainingMs:number;signal:AbortSignal})=>Promise<T>,deps:{wait?:typeof recoveryWait;now?:()=>number;policy?:typeof RECOVERY_POLICY}={}){
 const policy=deps.policy??RECOVERY_POLICY,now=deps.now??Date.now,wait=deps.wait??recoveryWait,file=join(dir,input.role+'-recovery.json');
 const previous=existsSync(file)?read(file):null,state:any={version:policy.version,role:input.role,policy,cycle:(previous?.cycle??0)+1,startedAt:now(),status:'running',attempt:0,attempts:previous?.attempts??[],nextRetryAt:null,reason:null};
 const started=now(),deadline=new AbortController(),timer=setTimeout(()=>deadline.abort(Error('PROVIDER_RECOVERY_EXHAUSTED：当前逻辑调用及排队已达恢复总时长上限')),Math.max(1,policy.maxElapsedMs));timer.unref?.();input={...input,signal:input.signal?AbortSignal.any([input.signal,deadline.signal]):deadline.signal};let timeouts=0;save(file,state);
 try{for(let i=0;i<policy.maxAttempts;i++){
  input.signal?.throwIfAborted();const remaining=policy.maxElapsedMs-(now()-started);
  if(remaining<=0)throw Error('PROVIDER_RECOVERY_EXHAUSTED：当前步骤自动恢复已达到总时长上限；已有产物已保留');
  const record:any={index:state.attempts.length+1,cycle:state.cycle,startedAt:now(),status:'running'};state.attempts.push(record);state.attempt=i+1;state.status=i?'retrying':'running';state.nextRetryAt=null;save(file,state);
  try{const result=await request({recoveryAttempt:i,recoveryRemainingMs:remaining,signal:input.signal!});record.status='passed';state.status='completed';state.reason=i?'已自动恢复，继续后续步骤':null;return result;}
  catch(error){
   record.error=String(error);const fault=providerFault(error);record.fault=fault.kind;if(input.signal?.aborted)Object.assign(record,abortDisposition(input.signal.reason));else record.status='failed';
   if(input.signal?.aborted)throw error;
   if(!fault.recoverable){state.status='blocked';state.reason=fault.reason;throw error;}
   if(fault.kind==='timeout')timeouts++;
   const delay=rateLimitDelay(error,i,now())??(policy.delaysMs[i]??policy.delaysMs.at(-1)!);
   if(i+1>=policy.maxAttempts||timeouts>=policy.maxTimeouts||now()-started+delay>=policy.maxElapsedMs){state.status='exhausted';state.reason='自动恢复后仍无法完成当前调用；已保留全部尝试，停止重复消耗';throw Error('PROVIDER_RECOVERY_EXHAUSTED：'+state.reason+'；最后错误：'+String(error));}
   state.status='waiting';state.reason=fault.reason;state.nextRetryAt=now()+delay;record.retryDelayMs=delay;record.recoveryAction=fault.kind==='timeout'?'extended-timeout':'backoff';save(file,state);
   await wait(delay,input.signal);
  }finally{record.endedAt=now();record.durationMs=record.endedAt-record.startedAt;const archive=join(dir,'provider-attempts',input.role,String(record.index));mkdirSync(archive,{recursive:true});save(join(archive,'attempt.json'),record);for(const suffix of suffixes){const source=join(dir,input.role+'-'+suffix);if(existsSync(source))copyFileSync(source,join(archive,suffix));}save(file,state);}
 }}catch(error){if(input.signal?.aborted){Object.assign(state,abortDisposition(input.signal.reason));}else if(state.status==='running'||state.status==='retrying'){state.status='blocked';state.reason=String(error);}throw input.signal?.aborted?input.signal.reason:error;}
 finally{clearTimeout(timer);state.endedAt=now();state.nextRetryAt=null;save(file,state);}
 throw Error('PROVIDER_RECOVERY_EXHAUSTED');
}

/** Execution transport interruptions are tracked separately from scene quality failures. */
export function executionFaultOf(job:any){
 const top=providerFault(job.executionFault??job.error);
 if(job.partialOutput&&job.quality&&job.productionWindow?.version!=='quality-delivery-window-v3'&&job.productionWindow?.workDeadlineAt<=Date.now())return {kind:'time-window',recoverable:false,reason:'制作时间窗已结束，保留草稿评分；补齐资产需要用户继续'};
 if(['hard','exhausted'].includes(top.kind)||/FIRST_SCORE_WINDOW_EXPIRED|PRODUCTION_WINDOW_EXPIRED/.test(String(job.error)))return top;
 if(top.recoverable)return top;
 if(job.executionRecoveryPolicy?.version==='execution-recovery-v2'&&job.partialOutput&&job.assetFailures?.length){
  const faults=job.assetFailures.map((f:any)=>providerFault(f.error));
  if(faults.some((f:any)=>['hard','exhausted'].includes(f.kind)))return faults.find((f:any)=>['hard','exhausted'].includes(f.kind));
  if(faults.every((f:any)=>f.recoverable))return faults[0];
 }
 return top;
}
export function executionInterrupted(job:any){const fault=executionFaultOf(job);return !['passed','cancelled'].includes(job.status)&&!['hard','exhausted'].includes(fault.kind)&&(!!job.autoResumeEligible||fault.recoverable);}
export function abortDisposition(reason:any){
 const s=String(reason);
 if(reason?.name==='TimeoutError'||/FIRST_SCORE_WINDOW_EXPIRED|PRODUCTION_WINDOW_EXPIRED/.test(s))return {status:'blocked',reason:'执行时间窗到期；保留已完成产物，评分和恢复按各自策略处理',abortCause:'deadline'};
 if(reason?.name==='AbortError'||/^(?:Error: )?(?:CANCELLED|USER_CANCELLED)$/.test(s))return {status:'cancelled',reason:'用户取消，停止恢复',abortCause:'user'};
 return {status:'blocked',reason:'父步骤中断：'+s,abortCause:'parent'};
}
export function automaticContinuationOptions(source:any,automatic:boolean){return {attempt:automatic?(source.attempt??1):(source.attempt??1)+1,retryRoot:source.retryRoot??source.id,executionRecoveryRoot:source.executionRecoveryRoot??source.id,automaticResumeCount:automatic?(source.automaticResumeCount??0)+1:source.automaticResumeCount??0,executionRecoveryPolicy:{version:'execution-recovery-v2',enabled:true,maxContinuations:source.generationMode==='qualified'?null:3},...(automatic?{validationKind:'execution-continuation'}:{})};}
