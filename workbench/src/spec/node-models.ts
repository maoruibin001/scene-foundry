import {useModelPermit} from '../concurrency';
/** 每个实际模型节点的冻结配置。程序化构建/渲染没有模型，不能伪装为可换模型。 */
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {callCodex} from '../codex-provider';
import {callClaude10,CLAUDE10_MODEL,claude10Message} from '../claude10-provider';
import {captureCodexProcess} from '../codex-process';
import {modelTimeoutPolicy} from '../model-selection';
import {reconstructionPython} from '../runtime-paths.mjs';
import {VISUAL_PANEL_MODEL,VISUAL_PANEL_SELECTION} from './visual-panel-config';

export const NODE_IDS=['families','objects','staging','parameterRepair','styleReview'] as const;
export const CBC5_MODELS=['hy4flash-dev'] as const;
export const CBC4_MODELS=['hy4-preview-ioa','hy4std'] as const;
export type Cbc4Model=typeof CBC4_MODELS[number];
export type NodeId=typeof NODE_IDS[number];
export type NodeModel={provider:'claude10'|'codex'|'cbc4'|'cbc5';model:string;reasoningEffort:string};
export type NodeModels=Record<NodeId,NodeModel>;
const defaults:NodeModel={provider:'claude10',model:CLAUDE10_MODEL,reasoningEffort:'xhigh'};
export function validateNodeModels(value:unknown):NodeModels{
 if(value!=null&&(typeof value!=='object'||Array.isArray(value)))throw Error('节点模型配置无效');
 const input=(value??{}) as Record<string,unknown>;
 for(const k of Object.keys(input))if(!NODE_IDS.includes(k as NodeId))throw Error('未知模型节点: '+k);
 return Object.fromEntries(NODE_IDS.map(id=>{
  const raw=(input[id]??(id==='styleReview'?VISUAL_PANEL_SELECTION:id==='parameterRepair'?input.families??defaults:defaults)) as any;
  if(raw?.model===VISUAL_PANEL_MODEL){if(id!=='styleReview'||raw.provider!==VISUAL_PANEL_SELECTION.provider||raw.reasoningEffort!==VISUAL_PANEL_SELECTION.reasoningEffort)throw Error('联合评审只能用于视觉节点且配置必须冻结');return [id,{...VISUAL_PANEL_SELECTION}];}
  const efforts=(['cbc4','cbc5'].includes(raw?.provider)||raw?.provider==='codex'&&raw?.model==='gpt-6-luna')?['medium','high','xhigh']:['high','xhigh'];
  if(!raw||!['claude10','codex','cbc4','cbc5'].includes(raw.provider)||typeof raw.model!=='string'||!/^[A-Za-z0-9._:/-]{1,120}$/.test(raw.model)||!efforts.includes(raw.reasoningEffort))throw Error('节点 '+id+' 的模型配置无效');
  if(raw.provider==='claude10'&&raw.model!==CLAUDE10_MODEL)throw Error('claude10 模型必须为 '+CLAUDE10_MODEL);
  if(raw.provider==='cbc4'&&!(CBC4_MODELS as readonly string[]).includes(raw.model))throw Error('cbc4 文本模型必须为 '+CBC4_MODELS.join(' 或 '));
  if(raw.provider==='cbc5'&&!(CBC5_MODELS as readonly string[]).includes(raw.model))throw Error('cbc5 文本模型必须为 '+CBC5_MODELS.join(' 或 '));
  return [id,{provider:raw.provider,model:raw.model,reasoningEffort:raw.reasoningEffort}];
 })) as NodeModels;
}
export function nodeCacheHash(task:string,facts:unknown,doc:string,schema:unknown,model:NodeModel,images:{path:string;mime:string}[]){
 const h=createHash('sha256').update(JSON.stringify({task,facts,doc,schema,model}));
 for(const image of images)h.update(image.mime).update(readFileSync(image.path));
 return h.digest('hex');
}
export type NodeRequest={system:string;text:string;images?:{path:string;mime:string}[];role:string;signal?:AbortSignal};
const isJsonObject=(v:unknown):v is Record<string,unknown>=>Boolean(v)&&typeof v==='object'&&!Array.isArray(v);
/** cbc5 启动器把 --model hy4flash-dev 记成回执键 hy4flash；只放行这一个显式别名，其余模型仍精确匹配。 */
const MODEL_RECEIPT_ALIASES:Record<string,readonly string[]>={'hy4flash-dev':['hy4flash']};
export function parseCbcResult(stdout:string,model:string){
 let result:any=null;
 const trimmed=stdout.trim();
 if(trimmed.startsWith('[')){
  try{const arr=JSON.parse(trimmed);if(Array.isArray(arr))result=arr.findLast((x:any)=>x?.type==='result');}catch{}
 }
 if(!result){
  const rawLines=trimmed.split('\n');
  for(let i=rawLines.length-1;i>=0;i--){
   const line=rawLines[i]!.trim();if(!line)continue;
   try{const parsed=JSON.parse(line);if(parsed?.type==='result'){result=parsed;break;}}catch{}
  }
 }
 if(!result||result.is_error||result.subtype!=='success')throw Error('CBC4_FAILED：模型未返回成功结果');
 const actual=Object.keys(result.modelUsage??{}),accepted=MODEL_RECEIPT_ALIASES[model]??[model];
 if(actual.length&&(actual.length!==1||!accepted.includes(actual[0]!)))throw Error('MODEL_ROUTE_UNVERIFIED：模型回执与所选节点不一致');
 let structured:Record<string,unknown>|null=isJsonObject(result.structured_output)?result.structured_output:null;
 if(result.structured_output==null&&typeof result.result==='string'){
  try{const parsed=JSON.parse(result.result.trim());if(isJsonObject(parsed))structured=parsed;}catch{}
 }
 if(!structured)throw Error('CBC4_INVALID_OUTPUT：缺少结构化结果');
 return {text:JSON.stringify(structured),receipt:{provider:'cbc4',requestedModel:model,returnedModel:actual[0]??null,routeEvidence:actual.length?'provider-receipt':'launcher-selection-only',usage:result.usage??null}};
}
/** 只有"连接卡住"或"几乎没有任何输出"的超时才值得重跑；模型确实跑满上限时再试一次没有收益。 */
export function isTransientCbcTimeout(result:{timedOut?:boolean;trace?:any}){
 return Boolean(result?.timedOut)&&(result?.trace?.timeoutReason==='stalled'||(result?.trace?.stdoutBytes??0)<64*1024);
}
/** cbc4/cbc5 瞬态超时允许重跑一次，带短暂退避；取消信号与其余错误立即照常返回。 */
export async function callCbcWithRetry(options:Parameters<typeof captureCodexProcess>[0],attempts=2,run:typeof captureCodexProcess=captureCodexProcess){
 let last:Awaited<ReturnType<typeof captureCodexProcess>>|undefined;
 for(let attempt=1;attempt<=attempts;attempt++){
  // 每次尝试各写一份执行日志，失败证据不被重跑覆盖。
  last=await run(attempt===1?options:{...options,prefix:options.prefix+'-retry'+attempt});
  if(!isTransientCbcTimeout(last)||options.signal?.aborted||attempt===attempts)break;
  await new Promise(resolve=>setTimeout(resolve,1000*attempt));
 }
 return last!;
}
export async function callSpecNode(input:NodeRequest,dir:string,selection:NodeModel,schema:any){
 if(input.role==='spec-style-judge'&&selection.provider==='codex'&&process.env.PIPELINE_VISUAL_HOLD_REASON)throw Error('VISUAL_REVIEW_HELD：'+process.env.PIPELINE_VISUAL_HOLD_REASON);
 if(input.role==='spec-style-judge'&&selection.model===VISUAL_PANEL_MODEL){const {runVisualPanel}=await import('./visual-panel');return runVisualPanel(input,dir);}
 if(input.role==='spec-style-judge'&&['cbc4','cbc5'].includes(selection.provider))throw Error('VISUAL_ROUTE_UNSUPPORTED：视觉评审已改用 codex1 / codex2 / codex3 原图联合评审');
 return useModelPermit(input.role,input.signal,()=>callSpecNodeInner(input,dir,selection,schema));
}
async function callSpecNodeInner(input:NodeRequest,dir:string,selection:NodeModel,schema:any){
 mkdirSync(dir,{recursive:true});
 const settings={model:selection.model,reasoningEffort:selection.reasoningEffort};
 if(selection.provider==='claude10')return callClaude10({...input,modelSettings:settings},dir,selection.model,schema);
 if(selection.provider==='codex')return callCodex({...input,modelSettings:settings},dir,selection.model,schema);
 const provider=selection.provider,executable=Bun.which((provider==='cbc5'?process.env.PIPELINE_CBC5_BIN:process.env.PIPELINE_CBC4_BIN)?.trim()||provider);
 if(!executable)throw Error('PROVIDER_NOT_CONFIGURED：找不到 cbc4 启动器');
 const schemaText=JSON.stringify(schema);
 const args=[executable,'--permission-mode','dontAsk','--print','--input-format','stream-json','--output-format','stream-json','--include-partial-messages','--max-turns','2','--verbose','--no-session-persistence','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--tools','StructuredOutput','--allowedTools','StructuredOutput','--model',selection.model,'--effort',selection.reasoningEffort,'--json-schema',schemaText];
 const env=Object.fromEntries(['PATH','HOME','TMPDIR','LANG','LC_ALL','USER','LOGNAME','CBC4_BIN','CBC5_BIN','CODEBUDDY_CONFIG_DIR'].filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]!]));
 const imageReceipts:{mime:string;bytes:number;sha256:string}[]=[];
 const validatedImages=(input.images??[]).map(i=>{const b=readFileSync(i.path);const png=i.mime==='image/png'&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpg=i.mime==='image/jpeg'&&b[0]===255&&b[1]===216&&b[2]===255;if(!png&&!jpg)throw Error('PROVIDER_INPUT_INVALID：参考图片格式不符');imageReceipts.push({mime:i.mime,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});return i;});
 // cbc4 多图网关载荷保护:10 张 1600×900 原图 base64 达 ~18MB 会被网关剥离图片块(模型只能看到路径占位而报无画面);
 // 当总字节 > 2MB 时自动用共享 Python PIL 等比缩放到 ≤960px JPEG(quality=85, 总体积 <1MB),单元测试小图保持原样。
 let images=validatedImages;
 const totalImageBytes=imageReceipts.reduce((s,x)=>s+x.bytes,0);
 if(totalImageBytes>2_000_000){
  const thumbDir=join(dir,'.cbc4-vision-thumbs');mkdirSync(thumbDir,{recursive:true});
  const py=reconstructionPython();
  const resized:{path:string;mime:string}[]=[];
  for(let idx=0;idx<validatedImages.length;idx++){
   const src=validatedImages[idx]!.path,dst=join(thumbDir,`img-${idx}.jpg`);
   const r=spawnSync(py,['-c','import sys;from PIL import Image;im=Image.open(sys.argv[1]).convert("RGB");im.thumbnail((960,960),Image.Resampling.LANCZOS);im.save(sys.argv[2],"JPEG",quality=85,optimize=True)',src,dst],{timeout:15000});
   // 原图超过网关载荷会被剥离，模型会"看不到画面"还照常给分；缩图失败必须显式报错，不能静默降级。
   if(r.status!==0)throw Error('CBC4_IMAGE_RESIZE_FAILED：第 '+idx+' 张缩图失败，不发送会被网关剥离的原图：'+String(r.stderr?.toString().slice(-300)??r.error));
   resized.push({path:dst,mime:'image/jpeg'});
  }
  if(resized.length!==validatedImages.length)throw Error('CBC4_IMAGE_RESIZE_FAILED：缩图结果不完整');
  images=resized;
 }
 writeFileSync(join(dir,input.role+'-input-receipt.json'),JSON.stringify({provider,role:input.role,executable,model:selection.model,reasoningEffort:selection.reasoningEffort,permissionMode:'dontAsk',imageCount:images.length,images:imageReceipts,transmittedImages:images.map((im,index)=>({index,mime:im.mime,bytes:readFileSync(im.path).length,sha256:createHash('sha256').update(readFileSync(im.path)).digest('hex'),sourceSha256:imageReceipts[index]!.sha256})),systemSha256:createHash('sha256').update(input.system).digest('hex'),textSha256:createHash('sha256').update(input.text).digest('hex'),schemaSha256:createHash('sha256').update(schemaText).digest('hex')},null,2));
 // cbc4 的 StructuredOutput 在 thinking_delta 结束后会缓冲完整 JSON 再统一 flush(实测约 2–4 分钟静默),stallMs 设为 300s 并在超时失败时允许瞬态重跑 1 次。
 const cbcTimeout=['cbc4','cbc5'].includes(selection.provider)?{timeoutMs:600000,maxTimeoutMs:1500000,activityWindowMs:360000,extensionMs:360000,stallMs:300000}:modelTimeoutPolicy(selection.reasoningEffort,input.role);
 const started=Date.now();
 const result=await callCbcWithRetry({args,cwd:dir,env,input:claude10Message({...input,images}),prefix:join(dir,input.role+'-'),...cbcTimeout,signal:input.signal});
 const durationMs=Date.now()-started;
 if(result.timedOut)throw Error('PROVIDER_TIMEOUT：cbc4 调用超时');
 if(result.code!==0)throw Error('CBC4_FAILED：'+result.stderr.slice(-1000));
 const parsed=parseCbcResult(result.stdout,selection.model);parsed.receipt.provider=provider;
 writeFileSync(join(dir,input.role+'-route.json'),JSON.stringify({...parsed.receipt,executable,role:input.role,durationMs,imageCount:images.length},null,2));
 return parsed;
}
