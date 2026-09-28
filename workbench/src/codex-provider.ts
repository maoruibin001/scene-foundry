import {assertRoleTools,serveCodexTools,withToolContinuation,type CodexToolKit} from './codex-tools';
import {discoverCodexRoute,routeArguments,routeSummary,routeForSelection,assertLauncherUnchanged,type CodexRoute} from './codex-route';
import {codexPrompt} from './prompts';
import {modelTimeoutPolicy,type ModelSettings} from './model-selection';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,statSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {captureCodexProcess} from './codex-process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

export function resolveCodexBin(value?:string){const requested=value?.trim()||'codex';return Bun.which(requested)??requested;}
export const CODEX_BIN=resolveCodexBin(process.env.PIPELINE_CODEX_BIN);
let activeRoute:CodexRoute|undefined;let routeFailure:string|undefined;
export async function initializeCodexRoute(){try{activeRoute=await discoverCodexRoute(CODEX_BIN,codexEnvironment());routeFailure=undefined;}catch(error){activeRoute=undefined;routeFailure=String(error);}}
function routeForModel(model=process.env.PIPELINE_MODEL){return routeForSelection(activeRoute,process.env.PIPELINE_MODEL,model);}
export function codexRouteInfo(model?:string){const route=routeForModel(model);return route?routeSummary(route):null;}
export function codexRouteError(){return routeFailure??null;}
export const CODEX_EFFORT=process.env.PIPELINE_CODEX_EFFORT??'high';
export const CODEX_WORKER_INSTRUCTIONS=readFileSync(join(import.meta.dirname,'codex-worker.zh.md'),'utf8');
// Reuse the CLI's login. Never pass API keys, endpoint overrides or provider credentials.
export function codexEnvironment(source=process.env){return Object.fromEntries(['PATH','HOME','CODEX_HOME','TMPDIR','LANG','LC_ALL','USER','LOGNAME'].filter(k=>source[k]!==undefined).map(k=>[k,source[k]!]));}
export function codexLogin(model?:string){if(routeFailure)return false;if(routeForModel(model)?.definition?.requires_openai_auth===false)return true;try{const p=Bun.spawnSync([CODEX_BIN,'login','status'],{env:codexEnvironment(),timeout:5000});const status=new TextDecoder().decode(p.stdout)+new TextDecoder().decode(p.stderr);return p.exitCode===0&&/Logged in using ChatGPT/.test(status)}catch{return false}}
export function validateCodexImages(images:{path:string,mime:string}[]=[]){return images.map(image=>{
 try{if(!statSync(image.path).isFile())throw Error('不是文件');const bytes=readFileSync(image.path),png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;if(!(png&&image.mime==='image/png'||jpeg&&image.mime==='image/jpeg'))throw Error('图片格式与声明不符');return {path:image.path,mime:image.mime,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};}
 catch(error){throw Error('PROVIDER_INPUT_INVALID：参考图片不可用：'+image.path+'；'+String(error));}
});}
export function cliReceipt(log:string,model:string,effort=CODEX_EFFORT,expectedProvider='openai'){
 const selected=log.match(/^model: (.+)$/m)?.[1]?.trim(),provider=log.match(/^provider: (.+)$/m)?.[1]?.trim(),cliReasoningEffort=log.match(/^reasoning effort: (.+)$/m)?.[1]?.trim();
 if(selected!==model||provider!==expectedProvider||cliReasoningEffort!==effort)throw Error('MODEL_ROUTE_UNVERIFIED：Codex CLI 未确认所选模型与供应商');
 return {requestedModel:model,cliModel:selected,returnedModel:null,routeEvidence:'official Codex CLI execution header; server does not echo model',provider:'codex-cli',authentication:expectedProvider==='openai'?'chatgpt-subscription':'launcher-provider',cliProvider:provider,cliSandbox:log.match(/^sandbox: (.+)$/m)?.[1]?.trim()??null,cliVersion:log.match(/^OpenAI Codex (.+)$/m)?.[1]??null,id:log.match(/^session id: (.+)$/m)?.[1]??null,usage:{cliReportedTokens:Number(log.match(/tokens used\s*\n([\d,]+)/)?.[1]?.replaceAll(',','')??0)},requestedReasoning:effort,cliReasoningEffort};
}
export async function callCodex(input:{system:string,text:string,images?:{path:string,mime:string}[],role:string,signal?:AbortSignal,modelSettings?:ModelSettings,recoveryAttempt?:number,recoveryRemainingMs?:number,tools?:CodexToolKit},dir:string,model:string,schema:any){
 assertRoleTools(input.role,input.tools);input=withToolContinuation(input);schema=input.tools?.outputSchema??schema;
 input.signal?.throwIfAborted();const images=validateCodexImages(input.images);
 if(!activeRoute)throw Error('CODEX_ROUTE_UNVERIFIED：启动器路由尚未初始化');assertLauncherUnchanged(CODEX_BIN,activeRoute);const route=routeForModel(model)!;
 if(!codexLogin(model))throw Error('PROVIDER_NOT_CONFIGURED：请检查本地 Codex CLI 登录状态和启动器配置');
 const effort=input.modelSettings?.reasoningEffort??CODEX_EFFORT,timeoutPolicy=modelTimeoutPolicy(effort,input.role,input.recoveryAttempt,input.recoveryRemainingMs),{timeoutMs}=timeoutPolicy;
 const scratch=mkdtempSync(join(tmpdir(),'scene-foundry-codex-')),schemaPath=join(scratch,'schema.json'),output=join(scratch,'response.json'),workerPath=join(scratch,'worker.zh.md');
 const worker=input.tools?CODEX_WORKER_INSTRUCTIONS.replace('不使用工具、网络、终端或文件读写，不修改环境，不调用其他代理。','只允许调用本次 scene_feedback 的专用反馈工具；不使用网络、终端、通用文件读写或其他代理，不修改环境。')+'\n'+input.tools.instructions:CODEX_WORKER_INSTRUCTIONS;
 writeFileSync(workerPath,worker);const workerInstructionsSha256=createHash('sha256').update(worker).digest('hex');
 writeFileSync(schemaPath,JSON.stringify(schema));const started=Date.now();
 writeFileSync(join(dir,input.role+'-input-receipt.json'),JSON.stringify({executable:CODEX_BIN,executionRoute:routeSummary(route),requestedModel:model,requestedReasoning:effort,reasoningSummary:'auto',timeoutMs,images,workerInstructionsSha256,toolsContract:input.tools?.version??null,startedAt:new Date(started).toISOString(),schemaSha256:createHash('sha256').update(JSON.stringify(schema)).digest('hex')},null,2));
 const toolServer=input.tools?serveCodexTools(input.tools,input.signal):null;
 const args=[CODEX_BIN,'exec',...routeArguments(route),'--ignore-user-config','--ephemeral','--sandbox','read-only','--skip-git-repo-check','--model',model,'-c',`model_reasoning_effort="${effort}"`,'-c','model_reasoning_summary="auto"','-c','web_search="disabled"','-c',`model_instructions_file=${JSON.stringify(workerPath)}`,...(toolServer?.args??[]),'--output-schema',schemaPath,'-o',output,...(input.images??[]).flatMap(i=>['--image',i.path]),'-'];
 try{
  const {code,timedOut,stderr:log,trace}=await captureCodexProcess({args,cwd:scratch,env:codexEnvironment(),input:codexPrompt(input.system,input.text,!!input.tools),prefix:join(dir,input.role+'-'),...timeoutPolicy,signal:input.signal});input.signal?.throwIfAborted();
  if(timedOut)throw Error('PROVIDER_TIMEOUT：Codex 本次调用在 '+Math.round(trace.durationMs/1000)+' 秒后超时（'+trace.timeoutReason+'）；交由自动恢复处理');
  if(code!==0)throw Error('PROVIDER_CODEX_FAILED：'+log.slice(-1800));
  const receipt={executable:CODEX_BIN,...cliReceipt(log,model,effort,route.providerId),executionRoute:routeSummary(route),workerInstructionsSha256,toolsContract:input.tools?.version??null,reasoningSummary:'auto',timeoutMs,role:input.role,durationMs:Date.now()-started,stopReason:'completed'};
  if(!existsSync(output)||!readFileSync(output,'utf8').trim())throw Error('PROVIDER_EMPTY_OUTPUT：Codex 已退出但没有返回完整输出；按执行中断自动恢复');
  const text=readFileSync(output,'utf8');return {text,receipt};
 }catch(error){
  if(existsSync(output))writeFileSync(join(dir,input.role+'-partial-response.txt'),readFileSync(output));
  writeFileSync(join(dir,input.role+'-failure.json'),JSON.stringify({error:String(error),requestedModel:model,requestedReasoning:effort,durationMs:Date.now()-started,usage:null,partialResponse:existsSync(output),inputReceipt:input.role+'-input-receipt.json',execution:input.role+'-execution.json'},null,2));throw error;
 }finally{toolServer?.close();rmSync(scratch,{recursive:true,force:true});}
}
