import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CODEX_BIN,codexEnvironment,codexRouteInfo} from './codex-provider';
import {modelOptions,validateModelSettings,type ModelOption,type ModelSettings} from './model-selection';
let cached:{models:ModelOption[],fetchedAt:string}|undefined;
let pending:Promise<NonNullable<typeof cached>>|undefined;
let cachedAt=0;
/** A short-lived, read-only app-server connection. No thread or inference is started. */
export async function codexModels(){
 if(cached&&Date.now()-cachedAt<300000)return cached;
 if(pending)return pending;
 pending=discover();try{cached=await pending;cachedAt=Date.now();return cached;}finally{pending=undefined;}
}
async function discover(){
 const route=codexRouteInfo(),custom:ModelOption[]=[];
 if(route&&route.providerId!=='openai'){const model=process.env.PIPELINE_MODEL;if(!model)throw Error('自定义 Codex 启动器需要明确配置 PIPELINE_MODEL；不回退到官方订阅模型');custom.push({model,displayName:model+' · '+route.providerId,description:'本地启动器供应商；凭证由启动器管理',defaultReasoningEffort:'high',supportedReasoningEfforts:[{reasoningEffort:'high',description:'深入'},{reasoningEffort:'xhigh',description:'更深入'}]});}
 const scratch=mkdtempSync(join(tmpdir(),'scene-foundry-models-'));
 const p=Bun.spawn([CODEX_BIN,'app-server','--listen','stdio://','-c','model_provider="openai"'],{cwd:scratch,env:codexEnvironment(),stdin:'pipe',stdout:'pipe',stderr:'ignore'});
 let timedOut=false;const timeout=setTimeout(()=>{timedOut=true;p.kill('SIGKILL');},15000);
 const send=(message:any)=>p.stdin.write(JSON.stringify(message)+'\n');
 send({id:0,method:'initialize',params:{clientInfo:{name:'scene_foundry',version:'0.1.0'}}});
 try{
  let buffer='',requestId=0;const rows:any[]=[],decoder=new TextDecoder();
  for await(const chunk of p.stdout){buffer+=decoder.decode(chunk,{stream:true});let end;
   while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!line.trim())continue;
    const message=JSON.parse(line);if(message.id!==requestId)continue;
    if(message.error)throw Error('读取 Codex 模型列表失败：'+message.error.message);
    if(requestId===0){send({method:'initialized'});send({id:++requestId,method:'model/list',params:{limit:100,includeHidden:false}});continue;}
    rows.push(...message.result.data);
    if(message.result.nextCursor){send({id:++requestId,method:'model/list',params:{limit:100,includeHidden:false,cursor:message.result.nextCursor}});continue;}
    const models=modelOptions(rows);if(custom.some(c=>models.some(m=>m.model===c.model)))throw Error('不同供应商使用了相同模型 ID，需明确区分后再生成');if(!models.length)throw Error('本机 Codex 没有可用于场景生成和图片验收的模型');
    return {models:[...custom,...models.filter(m=>!custom.some(c=>c.model===m.model)).map(m=>({...m,displayName:m.displayName+' · OpenAI 订阅'}))],fetchedAt:new Date().toISOString()};
   }
  }
  throw Error(timedOut?'读取 Codex 模型列表超时，请稍后刷新':'Codex 模型列表连接提前结束');
 }finally{clearTimeout(timeout);p.kill();await p.exited;rmSync(scratch,{recursive:true,force:true});}
}
export async function resolveCodexSettings(value:any,defaults:ModelSettings){return validateModelSettings(value===undefined?defaults:value,(await codexModels()).models);}
