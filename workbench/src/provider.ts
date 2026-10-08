import {assertStorageAvailable} from './storage-preflight';
import {assertCodexInputSize} from './codex-input';
import {standardJob,remainingProductionMs} from './matching-level';
import {requestJob} from './generation-policy';
import {listJobs} from './store';
import {scoreReserve,requestCallsExcludingSharedReserve} from './score-reserve';
import {otherSceneCallReserve} from './scene-call-reserve';
import {assertExecutionEnabled} from './acceptance-hold';
import {assertRoleTools,type CodexToolKit} from './codex-tools';
import {useModelPermit,assertProviderOpen,pauseProvider} from './concurrency';
import {withProviderRecovery,ACTIVE_RECOVERY_POLICY} from './provider-recovery';
import {reserveModelCall,improvement} from './improvement-governance';
import {PROMPT_CONTRACT} from './prompts';
import {type Complexity} from './complexity';
import {recommendedModelSettings,type ModelSettings} from './model-selection';
import {parseCallLimit,callAllowance,budgetSnapshot,acceptanceBudget} from './call-budget';
import {readFileSync,writeFileSync,existsSync,readdirSync} from 'node:fs';
import {join,dirname,basename} from 'node:path';
import {callCodex,codexLogin,CODEX_EFFORT,CODEX_BIN,codexRouteInfo,codexRouteError} from './codex-provider';
import {modelSchema,normalizeModelValue,type ModelSchemaContext} from './model-schema';
export const PROVIDER=process.env.PIPELINE_PROVIDER??'codex-cli';
if(!['messages-api','codex-cli'].includes(PROVIDER))throw Error('未知模型提供方式');
const explicit=Boolean(process.env.PIPELINE_PROVIDER_URL||process.env.PIPELINE_PROVIDER_API_KEY);
export const BASE=((explicit?process.env.PIPELINE_PROVIDER_URL:process.env.ANTHROPIC_BASE_URL)??'').replace(/\/$/,'');
const KEY=explicit?process.env.PIPELINE_PROVIDER_API_KEY:process.env.ANTHROPIC_API_KEY;
export const MODEL=process.env.PIPELINE_MODEL??(PROVIDER==='codex-cli'?recommendedModelSettings().model:'gemini-2.5-flash');
export const JUDGE_MODEL=process.env.PIPELINE_JUDGE_MODEL??MODEL;
export const defaultModelSettings=(level:Complexity='simple'):ModelSettings=>PROVIDER==='codex-cli'?recommendedModelSettings(level):({model:MODEL,reasoningEffort:CODEX_EFFORT});
export const MODEL_LIMIT=parseCallLimit(process.env.PIPELINE_MAX_CALLS);
export const isConfigured=(model=MODEL)=>PROVIDER==='codex-cli'?codexLogin(model):Boolean(BASE&&KEY);
let used=0,legacyLedger:string|null=null,ownLedger:string|null=null;
function totalUsed(){const historic=legacyLedger&&existsSync(legacyLedger)?JSON.parse(readFileSync(legacyLedger,'utf8')).used??0:0;if(!legacyLedger)return used;const prefix=basename(legacyLedger).replace(/\.json$/,'-concurrent'),others=readdirSync(dirname(legacyLedger)).filter(f=>(f===prefix+'.json'||f.startsWith(prefix+'-')&&f.endsWith('.json'))&&join(dirname(legacyLedger!),f)!==ownLedger);return used+historic+others.reduce((n,f)=>n+(JSON.parse(readFileSync(join(dirname(legacyLedger!),f),'utf8')).used??0),0);}
function scopedBudget(){const acceptance=process.env.PIPELINE_ACCEPTANCE_CONTROL_FILE;if(acceptance)return acceptanceBudget(JSON.parse(readFileSync(acceptance,'utf8')));const file=process.env.PIPELINE_EXECUTION_BUDGET_FILE;if(!file)return null;const v=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{limit:Number(process.env.PIPELINE_EXECUTION_MAX??3),attempts:[]};const max=Number(process.env.PIPELINE_EXECUTION_MAX??3);if(!Number.isInteger(max)||max<1||max>15||v.limit!==max||!Array.isArray(v.attempts))throw Error('本次恢复预算记录无效');return {max,used:v.attempts.length,remaining:Math.max(0,max-v.attempts.length),unlimited:false,limitKind:'subscription-recovery',scope:'本次订阅恢复，含短请求与重试，最多3次'};}
export function budget(selectedModel=MODEL,checkConfigured=true){return {provider:PROVIDER,executable:PROVIDER==='codex-cli'?CODEX_BIN:null,providerLabel:PROVIDER==='codex-cli'?'本地 Codex · '+(codexRouteInfo(selectedModel)?.providerId??'路由未就绪'):'模型 API',reasoningEffort:PROVIDER==='codex-cli'?CODEX_EFFORT:null,...budgetSnapshot(MODEL_LIMIT,totalUsed()),...scopedBudget(),model:MODEL,judgeModel:JUDGE_MODEL,host:PROVIDER==='codex-cli'?'本地 Codex CLI':BASE?new URL(BASE).host:null,configured:checkConfigured?isConfigured(selectedModel):false,executionRoute:codexRouteInfo(selectedModel),routeError:codexRouteError()};}
let outstandingCalls=0;
export function sceneReserve(jobId?:string,role?:string){const jobs=listJobs();return scoreReserve(jobs,jobId,role)+otherSceneCallReserve(jobs,jobId,j=>j.improvementId?improvement.get(j.improvementId).calls:0);}
export function hasSceneBudget(job:any,required=1,role?:string){return hasBudget(required+sceneReserve(job?.id,role));}
const settledListeners=new Set<()=>void>();
function waitForCall(signal?:AbortSignal){return new Promise<void>((resolve,reject)=>{const done=()=>{settledListeners.delete(done);signal?.removeEventListener('abort',abort);resolve();};const abort=()=>{settledListeners.delete(done);reject(signal?.reason);};signal?.throwIfAborted();settledListeners.add(done);signal?.addEventListener('abort',abort,{once:true});});}
export function hasBudget(required=1){const scoped=scopedBudget();return (!scoped||scoped.unlimited===true||scoped.remaining>=required)&&callAllowance(MODEL_LIMIT,totalUsed(),required);}
export function configureLedger(path:string){if(existsSync(path))used=JSON.parse(readFileSync(path,'utf8')).used??0;return ()=>writeFileSync(path,JSON.stringify({used,max:MODEL_LIMIT}));}
let persist=()=>{};export function setLedger(path:string){legacyLedger=PROVIDER==='codex-cli'?path.replace(/\.json$/,'-codex.json'):path;const namespace=process.env.PIPELINE_LEDGER_NAMESPACE??'';if(namespace&&!/^[a-z0-9-]+$/.test(namespace))throw Error('调用账本标识无效');ownLedger=legacyLedger.replace(/\.json$/,'-concurrent'+(namespace?'-'+namespace:'')+'.json');persist=configureLedger(ownLedger);}
export function parseModelJson(text:string){const s=text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');try{return JSON.parse(s)}catch{return JSON.parse(s.replace(/("(?:rotation|radiusBottom|radiusTop|roughness|metallic|sides)"\s*:\s*-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\](?=\s*[,}])/g,'$1'))}}
export async function callModel(input:{system:string,text:string,images?:{path:string,mime:string}[],maxTokens:number,role:string,signal?:AbortSignal,schemaContext?:ModelSchemaContext,modelSettings?:ModelSettings,reservedCalls?:number,tools?:CodexToolKit},dir:string){
 assertExecutionEnabled();assertRoleTools(input.role,input.tools);
 const job=requestJob(dir),remaining=remainingProductionMs(job,input.role);
 if(remaining<=0)throw Error('FIRST_SCORE_WINDOW_EXPIRED：首轮制作时间窗已用尽，保留当前产物；恢复不能重置首次提交时间');
 const deadline=Number.isFinite(remaining)?AbortSignal.timeout(Math.max(1,Math.floor(remaining))):null;
 input={...input,signal:deadline?(input.signal?AbortSignal.any([input.signal,deadline]):deadline):input.signal};
 try{return await withProviderRecovery(input,dir,context=>callModelOnce({...input,...context},dir),{policy:standardJob(job)?{...ACTIVE_RECOVERY_POLICY,maxElapsedMs:Math.min(ACTIVE_RECOVERY_POLICY.maxElapsedMs,remaining)}:ACTIVE_RECOVERY_POLICY});}
 catch(error){if(deadline?.aborted&&!job?.quality)throw Error('FIRST_SCORE_WINDOW_EXPIRED：首轮时间窗已到，保存结果；未完成评分不称为成功');throw error;}
}
async function callModelOnce(input:{system:string;text:string;images?:{path:string,mime:string}[];maxTokens:number;role:string;signal?:AbortSignal;schemaContext?:ModelSchemaContext;modelSettings?:ModelSettings;reservedCalls?:number;tools?:CodexToolKit;recoveryAttempt:number;recoveryRemainingMs:number},dir:string){
 return useModelPermit(dir+':'+input.role,input.signal,async()=>{
 input.signal?.throwIfAborted();assertProviderOpen();assertStorageAvailable(undefined,input.role==='judge'?512*1024**2:2*1024**3);
 if(PROVIDER==='codex-cli')assertCodexInputSize(input,modelSchema(input.role,input.schemaContext));
 if(!isConfigured(input.modelSettings?.model??MODEL))throw Error('PROVIDER_NOT_CONFIGURED：需要配置模型服务或登录本机 Codex');
 const protectedCalls=requestCallsExcludingSharedReserve(requestJob(dir),input.role,input.reservedCalls);
 while(outstandingCalls>0&&hasSceneBudget(requestJob(dir),protectedCalls,input.role)&&!hasBudget(protectedCalls+sceneReserve(requestJob(dir)?.id,input.role)+outstandingCalls))await waitForCall(input.signal);
 if(!hasBudget(1))throw Error('MODEL_BUDGET_EXHAUSTED：累计调用上限已到');
 if(!hasSceneBudget(requestJob(dir),protectedCalls,input.role))throw Error('SCORE_BUDGET_RESERVED：剩余调用已为场景评分保留，停止新增细化');
 writeFileSync(join(dir,input.role+'-prompt.json'),JSON.stringify({language:'zh-CN',engine:'ForgeaX Engine',contract:PROMPT_CONTRACT,system:input.system,input:input.text},null,2));
 reserveModelCall(dir,input.role);used++;persist();outstandingCalls++;try{const model=input.modelSettings?.model??(input.role==='judge'?JUDGE_MODEL:MODEL);
 if(PROVIDER==='codex-cli'){const {text,receipt}=await callCodex(input,dir,model,modelSchema(input.role,input.schemaContext));writeFileSync(join(dir,input.role+'-receipt.json'),JSON.stringify(receipt,null,2));writeFileSync(join(dir,input.role+'-response.txt'),text);const parsed=parseModelJson(text),value=normalizeModelValue(input.role,input.tools?.resolveOutput?input.tools.resolveOutput(parsed):parsed);writeFileSync(join(dir,input.role+'-parsed.json'),JSON.stringify(value,null,2));return {value,receipt};}
 const blocks:any[]=(input.images??[]).map(i=>({type:'image',source:{type:'base64',media_type:i.mime,data:readFileSync(i.path).toString('base64')}}));blocks.push({type:'text',text:input.text});
 const started=Date.now();const response=await fetch(BASE+'/v1/messages',{method:'POST',headers:{'x-api-key':KEY!,'anthropic-version':'2023-06-01','Content-Type':'application/json'},body:JSON.stringify({model,max_tokens:input.maxTokens,thinking:{type:'disabled'},system:PROMPT_CONTRACT+'\n'+input.system,messages:[{role:'user',content:blocks}]}),signal:input.signal?AbortSignal.any([input.signal,AbortSignal.timeout(120000)]):AbortSignal.timeout(120000)});
 if(!response.ok){const body=await response.text();const detail=body.slice(0,1800);throw Error('PROVIDER_HTTP_'+response.status+'：'+detail+'\nRetry-After: '+(response.headers.get('retry-after')??'unknown'));}
 const body:any=await response.json();
 const text=(body.content??[]).filter((b:any)=>b.type==='text').map((b:any)=>b.text).join('\n');
 const receipt={role:input.role,requestedModel:model,returnedModel:body.model??null,id:body.id??null,usage:body.usage??null,durationMs:Date.now()-started,stopReason:body.stop_reason??null,requestedThinking:'disabled'};
 writeFileSync(join(dir,input.role+'-receipt.json'),JSON.stringify(receipt,null,2));writeFileSync(join(dir,input.role+'-response.txt'),text);
 if(!body.model||body.model!==model)throw Error('MODEL_ROUTE_UNVERIFIED：响应模型与请求不一致，停止后续付费调用');
 if(!text||body.stop_reason==='max_tokens')throw Error('MODEL_OUTPUT_INCOMPLETE');
 const value=parseModelJson(text);writeFileSync(join(dir,input.role+'-parsed.json'),JSON.stringify(value,null,2));return {value,receipt};
 }finally{outstandingCalls--;for(const notify of [...settledListeners])notify();}
 }).catch(error=>{pauseProvider(error);throw error;});
}
