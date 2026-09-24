import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

export type CodexRoute={providerId:string;definition:Record<string,unknown>|null;launcherSha256:string;configurationSha256:string};
const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
export function routeFromConfig(config:any,launcherSha256:string):CodexRoute{
 const providerId=config?.model_provider??'openai';
 if(!/^[a-zA-Z0-9_-]+$/.test(providerId))throw Error('Codex 供应商 ID 无效');
 const definition=providerId==='openai'?null:config.model_providers?.[providerId];
 if(providerId!=='openai'&&(!definition||typeof definition.base_url!=='string'||typeof definition.env_key!=='string'||definition.wire_api!=='responses'))throw Error('当前启动器须提供 Responses 供应商及凭证环境变量');
 if(definition&&(definition.experimental_bearer_token||definition.auth||Object.keys(definition.http_headers??{}).length))throw Error('管线不复制内联凭证；请保留启动器的环境变量认证');
 const kept=definition?Object.fromEntries(['name','base_url','env_key','wire_api','requires_openai_auth'].filter(k=>definition[k]!==undefined&&definition[k]!==null).map(k=>[k,definition[k]])):null;
 return {providerId,definition:kept,launcherSha256,configurationSha256:sha(JSON.stringify([providerId,kept]))};
}
export function routeSummary(route:CodexRoute){return {providerId:route.providerId,launcherSha256:route.launcherSha256,configurationSha256:route.configurationSha256,authentication:route.definition?.requires_openai_auth===false?'launcher-provider':'chatgpt-subscription'};}
export function routeForSelection(route:CodexRoute|undefined,configuredModel:string|undefined,selectedModel=configuredModel){return route&&route.providerId!=='openai'&&selectedModel&&selectedModel!==configuredModel?routeFromConfig({model_provider:'openai'},route.launcherSha256):route;}
export function routeArguments(route:CodexRoute){
 const result=['-c','model_provider='+JSON.stringify(route.providerId)];
 for(const [key,value] of Object.entries(route.definition??{}))result.push('-c',`model_providers.${route.providerId}.${key}=${JSON.stringify(value)}`);
 return result;
}
/** 只读启动器配置，不发起推理、不读取或保存凭证值。公开回执只保留供应商 ID 与摘要。 */
export async function discoverCodexRoute(executable:string,env:Record<string,string>):Promise<CodexRoute>{
 const cwd=mkdtempSync(join(tmpdir(),'scene-foundry-route-'));
 const p=Bun.spawn([executable,'app-server','--listen','stdio://'],{cwd,env,stdin:'pipe',stdout:'pipe',stderr:'ignore'});
 const timer=setTimeout(()=>p.kill('SIGKILL'),15000),send=(v:any)=>p.stdin.write(JSON.stringify(v)+'\n');
 send({id:0,method:'initialize',params:{clientInfo:{name:'scene_foundry_route',version:'1'}}});
 try{
  let buffer='';const decoder=new TextDecoder();
  for await(const chunk of p.stdout){buffer+=decoder.decode(chunk,{stream:true});let end;
   while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!line.trim())continue;const m=JSON.parse(line);
    if(m.id===0){if(m.error)throw Error('Codex 配置连接初始化失败');send({method:'initialized'});send({id:1,method:'config/read',params:{includeLayers:false}});}
    if(m.id===1){if(m.error)throw Error('无法读取 Codex 启动器配置');return routeFromConfig(m.result.config,sha(readFileSync(executable)));}
   }
  }
  throw Error('Codex 启动器配置读取超时或连接结束');
 }finally{clearTimeout(timer);p.kill();await p.exited;rmSync(cwd,{recursive:true,force:true});}
}
export function assertLauncherUnchanged(executable:string,route:CodexRoute){if(sha(readFileSync(executable))!==route.launcherSha256)throw Error('CODEX_ROUTE_CHANGED：启动器已改变，请重启管线并冻结新版本');}
