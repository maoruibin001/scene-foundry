import {assertRoleTools,serveCodexTools,withToolContinuation,type CodexToolKit} from './codex-tools';
import {assertCodexInputSize,CODEX_WORKER_INSTRUCTIONS} from './codex-input';
export {CODEX_WORKER_INSTRUCTIONS} from './codex-input';
import {discoverCodexRoute,routeArguments,routeSummary,routeForSelection,assertLauncherUnchanged,type CodexRoute} from './codex-route';
import {codexPrompt} from './prompts';
import {modelTimeoutPolicy,type ModelSettings} from './model-selection';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,statSync,existsSync} from 'node:fs';
import {deflateSync,inflateSync} from 'node:zlib';
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
/** Address used only for a credential-free reachability probe after a network outage; never a model request. */
export function codexProbeUrl(model?:string){const base=routeForModel(model)?.definition?.base_url;return typeof base==='string'?base:'https://chatgpt.com/backend-api/codex';}
export const CODEX_EFFORT=process.env.PIPELINE_CODEX_EFFORT??'high';
// Reuse the CLI's login. Never pass API keys, endpoint overrides or provider credentials.
export function codexEnvironment(source=process.env){return Object.fromEntries(['PATH','HOME','CODEX_HOME','TMPDIR','LANG','LC_ALL','USER','LOGNAME','PIPELINE_ACCEPTANCE_CONTROL_FILE','PIPELINE_VALIDATION_CONTROL_FILE'].filter(k=>source[k]!==undefined).map(k=>[k,source[k]!]));}
export function codexLogin(model?:string){if(routeFailure)return false;if(routeForModel(model)?.definition?.requires_openai_auth===false)return true;try{const p=Bun.spawnSync([CODEX_BIN,'login','status'],{env:codexEnvironment(),timeout:5000});const status=new TextDecoder().decode(p.stdout)+new TextDecoder().decode(p.stderr);return p.exitCode===0&&/Logged in using ChatGPT/.test(status)}catch{return false}}
export function validateCodexImages(images:{path:string,mime:string}[]=[]){return images.map(image=>{
 try{if(!statSync(image.path).isFile())throw Error('不是文件');const bytes=readFileSync(image.path),png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;if(!(png&&image.mime==='image/png'||jpeg&&image.mime==='image/jpeg'))throw Error('图片格式与声明不符');return {path:image.path,mime:image.mime,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};}
 catch(error){throw Error('PROVIDER_INPUT_INVALID：参考图片不可用：'+image.path+'；'+String(error));}
});}
const PNG_SIGNATURE=Buffer.from([137,80,78,71,13,10,26,10]);
const pngChunk=(type:string,data:Buffer)=>{const head=Buffer.alloc(8),tail=Buffer.alloc(4);head.writeUInt32BE(data.length);head.write(type,4,'latin1');tail.writeUInt32BE(Bun.hash.crc32(Buffer.concat([head.subarray(4),data]))>>>0);return Buffer.concat([head,data,tail]);};
/** Same chunks and the same filtered scanlines under another deflate stream, so the decoded pixels are identical; checked before use. */
export function losslessPngReencode(bytes:Buffer){
 if(!bytes.subarray(0,8).equals(PNG_SIGNATURE))throw Error('不是 PNG');
 const chunks:{type:string,data:Buffer}[]=[];for(let pos=8;pos<bytes.length;){const n=bytes.readUInt32BE(pos);chunks.push({type:bytes.toString('latin1',pos+4,pos+8),data:bytes.subarray(pos+8,pos+8+n)});pos+=12+n;}
 const idat=Buffer.concat(chunks.filter(c=>c.type==='IDAT').map(c=>c.data)),raw=inflateSync(idat);
 let packed=deflateSync(raw,{level:9});if(packed.equals(idat))packed=deflateSync(raw,{level:1});
 if(packed.equals(idat)||!inflateSync(packed).equals(raw))throw Error('无损重编码未得到不同且像素一致的图片');
 const first=chunks.findIndex(c=>c.type==='IDAT');
 return Buffer.concat([PNG_SIGNATURE,...chunks.flatMap((c,i)=>c.type!=='IDAT'?[pngChunk(c.type,c.data)]:i===first?[pngChunk('IDAT',packed)]:[])]);
}
/** Recovery copies for a gateway that rejected a verified image's encoding; JPEG has no pixel-identical re-encode and is sent unchanged. */
function reencodedImages(images:ReturnType<typeof validateCodexImages>,folder:string){
 mkdirSync(folder,{recursive:true});
 return images.map((image,i)=>{
  if(image.mime!=='image/png')return image;
  const bytes=losslessPngReencode(readFileSync(image.path)),path=join(folder,(i+1)+'.png');writeFileSync(path,bytes);
  return {path,mime:image.mime,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),reencodedFrom:{path:image.path,bytes:image.bytes,sha256:image.sha256},pixels:'identical'};
 });
}
export function cliReceipt(log:string,model:string,effort=CODEX_EFFORT,expectedProvider='openai'){
 const selected=log.match(/^model: (.+)$/m)?.[1]?.trim(),provider=log.match(/^provider: (.+)$/m)?.[1]?.trim(),cliReasoningEffort=log.match(/^reasoning effort: (.+)$/m)?.[1]?.trim();
 if(selected!==model||provider!==expectedProvider||cliReasoningEffort!==effort)throw Error('MODEL_ROUTE_UNVERIFIED：Codex CLI 未确认所选模型与供应商');
 return {requestedModel:model,cliModel:selected,returnedModel:null,routeEvidence:'official Codex CLI execution header; server does not echo model',provider:'codex-cli',authentication:expectedProvider==='openai'?'chatgpt-subscription':'launcher-provider',cliProvider:provider,cliSandbox:log.match(/^sandbox: (.+)$/m)?.[1]?.trim()??null,cliVersion:log.match(/^OpenAI Codex (.+)$/m)?.[1]??null,id:log.match(/^session id: (.+)$/m)?.[1]??null,usage:{cliReportedTokens:Number(log.match(/tokens used\s*\n([\d,]+)/)?.[1]?.replaceAll(',','')??0)},requestedReasoning:effort,cliReasoningEffort};
}
export async function callCodex(input:{system:string,text:string,images?:{path:string,mime:string}[],role:string,signal?:AbortSignal,modelSettings?:ModelSettings,recoveryAttempt?:number,recoveryRemainingMs?:number,reencodeImages?:boolean,tools?:CodexToolKit},dir:string,model:string,schema:any){
 assertRoleTools(input.role,input.tools);const inputSize=assertCodexInputSize(input,schema);input=withToolContinuation(input);schema=input.tools?.outputSchema??schema;
 input.signal?.throwIfAborted();const verified=validateCodexImages(input.images),images=input.reencodeImages?reencodedImages(verified,join(dir,input.role+'-reencoded-images')):verified;
 if(!activeRoute)throw Error('CODEX_ROUTE_UNVERIFIED：启动器路由尚未初始化');assertLauncherUnchanged(CODEX_BIN,activeRoute);const route=routeForModel(model)!;
 if(!codexLogin(model))throw Error('PROVIDER_NOT_CONFIGURED：请检查本地 Codex CLI 登录状态和启动器配置');
 const effort=input.modelSettings?.reasoningEffort??CODEX_EFFORT,timeoutPolicy=modelTimeoutPolicy(effort,input.role,input.recoveryAttempt,input.recoveryRemainingMs,input.tools?.version),{timeoutMs}=timeoutPolicy;
 const scratch=mkdtempSync(join(tmpdir(),'scene-foundry-codex-')),schemaPath=join(scratch,'schema.json'),output=join(scratch,'response.json'),workerPath=join(scratch,'worker.zh.md');
 const worker=input.tools?CODEX_WORKER_INSTRUCTIONS.replace('不使用工具、网络、终端或文件读写，不修改环境，不调用其他代理。','只允许调用本次 scene_feedback 的专用反馈工具；不使用网络、终端、通用文件读写或其他代理，不修改环境。')+'\n'+input.tools.instructions:CODEX_WORKER_INSTRUCTIONS;
 writeFileSync(workerPath,worker);const workerInstructionsSha256=createHash('sha256').update(worker).digest('hex');
 writeFileSync(schemaPath,JSON.stringify(schema));const started=Date.now();
 writeFileSync(join(dir,input.role+'-input-receipt.json'),JSON.stringify({executable:CODEX_BIN,executionRoute:routeSummary(route),requestedModel:model,requestedReasoning:effort,reasoningSummary:'auto',timeoutMs,images,inputSize,workerInstructionsSha256,toolsContract:input.tools?.version??null,startedAt:new Date(started).toISOString(),schemaSha256:createHash('sha256').update(JSON.stringify(schema)).digest('hex')},null,2));
 const toolServer=input.tools?serveCodexTools(input.tools,input.signal,join(dir,input.role+'-tool-calls.jsonl'),input.reencodeImages?(b:string)=>losslessPngReencode(Buffer.from(b,'base64')).toString('base64'):undefined):null;
 const args=[CODEX_BIN,'exec',...routeArguments(route),'--ignore-user-config','--ephemeral','--sandbox','read-only','--skip-git-repo-check','--model',model,'-c',`model_reasoning_effort="${effort}"`,'-c','model_reasoning_summary="auto"','-c','web_search="disabled"','-c',`model_instructions_file=${JSON.stringify(workerPath)}`,...(toolServer?.args??[]),'--output-schema',schemaPath,'-o',output,...images.flatMap(i=>['--image',i.path]),'-'];
 try{
  const {code,timedOut,stderr:log,trace}=await captureCodexProcess({args,cwd:scratch,env:{...codexEnvironment(),PIPELINE_VALIDATION_JOB_ID:dir.match(/[/\\]runs[/\\]([a-f0-9-]{36})(?:[/\\]|$)/)?.[1]??'',PIPELINE_VALIDATION_ROLE:input.role},input:codexPrompt(input.system,input.text,!!input.tools),prefix:join(dir,input.role+'-'),...timeoutPolicy,signal:input.signal});input.signal?.throwIfAborted();
  if(timedOut&&trace.timeoutReason==='stalled')throw Error('PROVIDER_STALLED：Codex 连续 '+Math.round(timeoutPolicy.stallMs!/60000)+' 分钟没有任何输出（连接卡住），已在 '+Math.round(trace.durationMs/1000)+' 秒处停止；按临时连接故障重新发起当前调用');
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
