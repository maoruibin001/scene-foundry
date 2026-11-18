import {createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {assertRoleTools,serveCodexTools,withToolContinuation,type CodexToolKit} from './codex-tools';
import {assertCodexInputSize,CODEX_WORKER_INSTRUCTIONS} from './codex-input';
import {codexPrompt} from './prompts';
import {captureCodexProcess} from './codex-process';
import {modelTimeoutPolicy,type ModelSettings} from './model-selection';

export const CLAUDE10_MODEL='claude-opus-5-5';
export const isClaude10=(model?:string)=>model===CLAUDE10_MODEL;
export function claude10Executable(){return Bun.which(process.env.PIPELINE_CLAUDE10_BIN?.trim()||'claude10')??null;}
export function claude10Environment(source:Record<string,string|undefined>=process.env){return Object.fromEntries(['PATH','HOME','TMPDIR','LANG','LC_ALL','USER','LOGNAME','CLAUDE_CONFIG_DIR','CLAUDE_REAL_BIN','ANTHROPIC_BASE_URL','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','CLAUDE_CODE_USE_BEDROCK','CLAUDE_CODE_USE_VERTEX'].filter(k=>source[k]!==undefined).map(k=>[k,source[k]!]));}
export function claude10Configured(){const bin=claude10Executable();if(!bin)return false;try{const r=Bun.spawnSync([bin,'auth','status','--json'],{env:claude10Environment(),timeout:5000,stderr:'ignore'});return r.exitCode===0&&JSON.parse(new TextDecoder().decode(r.stdout)).loggedIn===true;}catch{return false;}}
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
function inspectClaude10Route(){
 const executable=claude10Executable();if(!executable||!existsSync(executable))return null;
 const launcherSha256=hash(readFileSync(executable)),delegate=join(executable,'..','clauded');
 const delegateSha256=existsSync(delegate)?hash(readFileSync(delegate)):null;
 return {providerId:'claude10',launcherSha256,configurationSha256:hash(JSON.stringify(['claude10',CLAUDE10_MODEL,launcherSha256,delegateSha256,process.env.ANTHROPIC_BASE_URL??null,process.env.CLAUDE_CONFIG_DIR??null,process.env.CLAUDE_REAL_BIN??null])),authentication:'launcher-provider'};
}
const frozenRoute=inspectClaude10Route();
export function claude10Route(){return frozenRoute;}
export function assertClaude10RouteUnchanged(){if(JSON.stringify(inspectClaude10Route())!==JSON.stringify(frozenRoute))throw Error('CLAUDE_ROUTE_CHANGED：启动器已变化，请冻结新版本');}
export function claude10Option(){return {model:CLAUDE10_MODEL,displayName:'Claude Opus 5.5 · claude10',description:'本地 Claude Code 启动器',defaultReasoningEffort:'high',supportedReasoningEfforts:[{reasoningEffort:'high',description:'深入'},{reasoningEffort:'xhigh',description:'更深入'}]};}
export function claude10Message(input:{system:string,text:string,images:{path:string,mime:string}[],tools?:CodexToolKit}){
 const worker=input.tools?CODEX_WORKER_INSTRUCTIONS.replace('不使用工具、网络、终端或文件读写，不修改环境，不调用其他代理。','只允许调用本次 scene_feedback 的专用反馈工具；不使用网络、终端、通用文件读写或其他代理，不修改环境。')+'\n'+input.tools.instructions:CODEX_WORKER_INSTRUCTIONS;
 const content:any[]=input.images.map(i=>({type:'image',source:{type:'base64',media_type:i.mime,data:readFileSync(i.path).toString('base64')}}));
 content.push({type:'text',text:worker+'\n\n'+codexPrompt(input.system,input.text,!!input.tools)});
 return JSON.stringify({type:'user',message:{role:'user',content}})+'\n';
}
export function parseClaude10Result(stdout:string,model:string){
 let result:any;try{const lines=stdout.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));result=lines.findLast((line:any)=>line.type==='result');if(!result)throw Error('missing result');}catch{throw Error('PROVIDER_CLAUDE_INVALID_OUTPUT：Claude CLI 未返回完整结果');}
 if(result.is_error||result.subtype!=='success'){const detail=String(result.result??result.subtype??'未知错误').slice(0,1000),code=result.subtype==='error_max_budget_usd'?'MODEL_BUDGET_EXHAUSTED':/not logged in|please run .login/i.test(detail)?'PROVIDER_NOT_CONFIGURED':'PROVIDER_CLAUDE_FAILED';throw Error(code+'：'+detail);}
 const observed=Object.keys(result.modelUsage??{});if(observed.length!==1||observed[0]!==model)throw Error('MODEL_ROUTE_UNVERIFIED：Claude CLI 未确认仅使用所选模型');
 const value=result.structured_output;if(!value||typeof value!=='object')throw Error('PROVIDER_EMPTY_OUTPUT：Claude 未返回结构化输出');
 return {text:JSON.stringify(value),receipt:{provider:'claude-cli',cliProvider:'claude10',requestedModel:model,returnedModel:observed.length===1?observed[0]:null,modelsUsed:observed,id:result.session_id??null,usage:result.usage??null,stopReason:result.stop_reason??null}};
}
export async function callClaude10(input:{system:string,text:string,images?:{path:string,mime:string}[],role:string,signal?:AbortSignal,modelSettings?:ModelSettings,recoveryAttempt?:number,recoveryRemainingMs?:number,tools?:CodexToolKit,maxBudgetUsd?:number},dir:string,model:string,schema:any){
 assertRoleTools(input.role,input.tools);const size=assertCodexInputSize(input,schema);input=withToolContinuation(input);schema=input.tools?.outputSchema??schema;input.signal?.throwIfAborted();
 const route=claude10Route(),executable=claude10Executable();if(!route||!executable)throw Error('PROVIDER_NOT_CONFIGURED：找不到 claude10 启动器');assertClaude10RouteUnchanged();
 const images=(input.images??[]).map(i=>{const b=readFileSync(i.path);const ok=i.mime==='image/png'?b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):i.mime==='image/jpeg'&&b[0]===255&&b[1]===216&&b[2]===255;if(!ok)throw Error('PROVIDER_INPUT_INVALID：参考图片格式不符');return {...i,bytes:b.length,sha256:hash(b)};});
 const effort=input.modelSettings?.reasoningEffort??'high',timeout=modelTimeoutPolicy(effort,input.role,input.recoveryAttempt,input.recoveryRemainingMs,input.tools?.version);
 const toolServer=input.tools?serveCodexTools(input.tools,input.signal,join(dir,input.role+'-tool-calls.jsonl')):null;
 if(input.maxBudgetUsd!==undefined&&(!Number.isFinite(input.maxBudgetUsd)||input.maxBudgetUsd<=0))throw Error('测试预算无效');
 const args=[executable,'--print','--input-format','stream-json','--output-format','stream-json','--verbose','--no-session-persistence','--strict-mcp-config','--tools','','--no-chrome','--disable-slash-commands','--effort',effort,...(input.maxBudgetUsd!==undefined?['--max-budget-usd',String(input.maxBudgetUsd)]:[]),'--json-schema',JSON.stringify(schema),...(toolServer?['--mcp-config',JSON.stringify(toolServer.claudeConfig),'--allowedTools',toolServer.claudeAllowedTools]:[])];
 const env=claude10Environment();
 const started=Date.now();writeFileSync(join(dir,input.role+'-input-receipt.json'),JSON.stringify({executable,executionRoute:route,requestedModel:model,requestedReasoning:effort,role:input.role,images,inputSize:size,startedAt:new Date(started).toISOString(),schemaSha256:hash(JSON.stringify(schema)),toolsContract:input.tools?.version??null},null,2));
 try{const r=await captureCodexProcess({args,cwd:dir,env,input:claude10Message({...input,images}),prefix:join(dir,input.role+'-'),...timeout,signal:input.signal});input.signal?.throwIfAborted();
  if(r.timedOut)throw Error('PROVIDER_TIMEOUT：Claude 调用超时');if(r.code!==0){try{parseClaude10Result(r.stdout,model);}catch(error){if(!String(error).includes('PROVIDER_CLAUDE_INVALID_OUTPUT'))throw error;}throw Error('PROVIDER_CLAUDE_FAILED：'+r.stderr.slice(-1800));}
  assertClaude10RouteUnchanged();
  const parsed=parseClaude10Result(r.stdout,model);return {text:parsed.text,receipt:{...parsed.receipt,executable,executionRoute:route,requestedReasoning:effort,role:input.role,durationMs:Date.now()-started,toolsContract:input.tools?.version??null}};
 }finally{toolServer?.close();}
}
