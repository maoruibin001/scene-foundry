import {reserveModelCall} from './improvement-governance';
import {PROMPT_CONTRACT} from './prompts';
import {type Complexity} from './complexity';
import {recommendedModelSettings,type ModelSettings} from './model-selection';
import {parseCallLimit,callAllowance,budgetSnapshot} from './call-budget';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
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
let used=0;
export function budget(selectedModel=MODEL,checkConfigured=true){return {provider:PROVIDER,executable:PROVIDER==='codex-cli'?CODEX_BIN:null,providerLabel:PROVIDER==='codex-cli'?'本地 Codex · '+(codexRouteInfo(selectedModel)?.providerId??'路由未就绪'):'模型 API',reasoningEffort:PROVIDER==='codex-cli'?CODEX_EFFORT:null,...budgetSnapshot(MODEL_LIMIT,used),model:MODEL,judgeModel:JUDGE_MODEL,host:PROVIDER==='codex-cli'?'本地 Codex CLI':BASE?new URL(BASE).host:null,configured:checkConfigured?isConfigured(selectedModel):false,executionRoute:codexRouteInfo(selectedModel),routeError:codexRouteError()};}
export function hasBudget(required=1){return callAllowance(MODEL_LIMIT,used,required);}
export function configureLedger(path:string){if(existsSync(path))used=JSON.parse(readFileSync(path,'utf8')).used??0;return ()=>writeFileSync(path,JSON.stringify({used,max:MODEL_LIMIT}));}
let persist=()=>{};export function setLedger(path:string){persist=configureLedger(PROVIDER==='codex-cli'?path.replace(/\.json$/,'-codex.json'):path);}
export function parseModelJson(text:string){const s=text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');try{return JSON.parse(s)}catch{return JSON.parse(s.replace(/("(?:rotation|radiusBottom|radiusTop|roughness|metallic|sides)"\s*:\s*-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\](?=\s*[,}])/g,'$1'))}}
export async function callModel(input:{system:string,text:string,images?:{path:string,mime:string}[],maxTokens:number,role:string,signal?:AbortSignal,schemaContext?:ModelSchemaContext,modelSettings?:ModelSettings},dir:string){
 input.signal?.throwIfAborted();
 if(!isConfigured())throw Error('PROVIDER_NOT_CONFIGURED：需要配置模型服务或登录本机 Codex');
 if(!hasBudget())throw Error('MODEL_BUDGET_EXHAUSTED：本轮模型调用上限已到');
 writeFileSync(join(dir,input.role+'-prompt.json'),JSON.stringify({language:'zh-CN',engine:'ForgeaX Engine',contract:PROMPT_CONTRACT,system:input.system,input:input.text},null,2));
 reserveModelCall(dir,input.role);used++;persist();const model=input.modelSettings?.model??(input.role==='judge'?JUDGE_MODEL:MODEL);
 if(PROVIDER==='codex-cli'){const {text,receipt}=await callCodex(input,dir,model,modelSchema(input.role,input.schemaContext));writeFileSync(join(dir,input.role+'-receipt.json'),JSON.stringify(receipt,null,2));writeFileSync(join(dir,input.role+'-response.txt'),text);const value=normalizeModelValue(input.role,parseModelJson(text));writeFileSync(join(dir,input.role+'-parsed.json'),JSON.stringify(value,null,2));return {value,receipt};}
 const blocks:any[]=(input.images??[]).map(i=>({type:'image',source:{type:'base64',media_type:i.mime,data:readFileSync(i.path).toString('base64')}}));blocks.push({type:'text',text:input.text});
 const started=Date.now();const response=await fetch(BASE+'/v1/messages',{method:'POST',headers:{'x-api-key':KEY!,'anthropic-version':'2023-06-01','Content-Type':'application/json'},body:JSON.stringify({model,max_tokens:input.maxTokens,thinking:{type:'disabled'},system:PROMPT_CONTRACT+'\n'+input.system,messages:[{role:'user',content:blocks}]}),signal:input.signal?AbortSignal.any([input.signal,AbortSignal.timeout(120000)]):AbortSignal.timeout(120000)});
 if(!response.ok){await response.body?.cancel();throw Error('PROVIDER_HTTP_'+response.status);}
 const body:any=await response.json();
 const text=(body.content??[]).filter((b:any)=>b.type==='text').map((b:any)=>b.text).join('\n');
 const receipt={role:input.role,requestedModel:model,returnedModel:body.model??null,id:body.id??null,usage:body.usage??null,durationMs:Date.now()-started,stopReason:body.stop_reason??null,requestedThinking:'disabled'};
 writeFileSync(join(dir,input.role+'-receipt.json'),JSON.stringify(receipt,null,2));writeFileSync(join(dir,input.role+'-response.txt'),text);
 if(!body.model||body.model!==model)throw Error('MODEL_ROUTE_UNVERIFIED：响应模型与请求不一致，停止后续付费调用');
 if(!text||body.stop_reason==='max_tokens')throw Error('MODEL_OUTPUT_INCOMPLETE');
 const value=parseModelJson(text);writeFileSync(join(dir,input.role+'-parsed.json'),JSON.stringify(value,null,2));return {value,receipt};
}
