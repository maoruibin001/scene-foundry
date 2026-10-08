import {join} from 'node:path';
import {appendFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export type ToolContent={type:'text';text:string}|{type:'image';data:string;mimeType:string};
export type CodexToolKit={version:string;instructions:string;definitions:any[];call:(name:string,args:any)=>Promise<{content:ToolContent[];isError?:boolean}>;outputSchema?:any;resolveOutput?:(value:any)=>any;continuation?:()=>{text:string;images:{path:string;mime:string}[]}};
const REPAIR_TOOLS=['inspect_visual_region','inspect_scene_parts','check_scene_patch','render_scene_patch'];
const ASSET_TOOLS=['preview_asset'];
const SPACE_TOOLS=['preview_graybox_space','measure_graybox_space'];
function toolNames(kit:CodexToolKit){
 const names=kit.definitions.map(t=>t.name);
 if(!names.length||new Set(names).size!==names.length||names.some(n=>![...REPAIR_TOOLS,...ASSET_TOOLS,...SPACE_TOOLS].includes(n)))throw Error('PROVIDER_TOOLS_INVALID：未审核或重复的本地工具');
 return names;
}
/** Validate role capability before temporary files, model budgeting or subprocess launch. */
export function assertRoleTools(role:string,kit?:CodexToolKit){
 if(!kit)return;const names=toolNames(kit);
 const allowed=role==='scene-refine'?REPAIR_TOOLS:role==='geometry-asset'&&['asset-preview-v1','asset-preview-context-v2'].includes(kit.version)?ASSET_TOOLS:role==='scene-space'&&['graybox-space-preview-v3','graybox-space-preview-v4','graybox-space-preview-v5','graybox-space-preview-v6','graybox-space-preview-v7','graybox-space-preview-v8'].includes(kit.version)?SPACE_TOOLS:role==='scene-space'&&kit.version==='graybox-space-preview-v2'?['preview_graybox_space']:[];
 if(names.some(n=>!allowed.includes(n)))throw Error('PROVIDER_TOOLS_INVALID：角色 '+role+' 不允许这组反馈工具');
}
/** Fresh CLI attempts must receive retained tool state; limits never reset on retry. */
export function withToolContinuation<T extends {text:string;images?:{path:string;mime:string}[];tools?:CodexToolKit}>(input:T):T{
 const context=input.tools?.continuation?.();if(!context)return input;
 return {...input,text:input.text+'\n已保存的本轮工具状态（真实产物，不是新评分）：\n'+context.text,images:[...(input.images??[]),...context.images]};
}
/** 每次模型调用独立监听，仅接受随机令牌、本次白名单工具和有限大小的参数。 */
export function serveCodexTools(kit:CodexToolKit,signal?:AbortSignal,auditFile?:string){
 const names=toolNames(kit),token=crypto.randomUUID();
 let calls=0;
 if(auditFile)writeFileSync(auditFile,JSON.stringify({event:'contract',version:kit.version,names,at:new Date().toISOString()})+'\n');
 const record=(row:any)=>{if(auditFile)appendFileSync(auditFile,JSON.stringify(row)+'\n');};
 const server=Bun.serve({hostname:'127.0.0.1',port:0,idleTimeout:255,maxRequestBodySize:2*1024*1024,async fetch(req){
  if(req.method!=='POST'||new URL(req.url).pathname!=='/'+token)return new Response('Not found',{status:404});
  if(signal?.aborted)return Response.json({error:'已取消'},{status:409});
  try{const body=await req.json();
   if(body.method==='tools/list')return Response.json({tools:kit.definitions});
   if(body.method!=='tools/call'||!kit.definitions.some(t=>t.name===body.params?.name))return Response.json({error:'未知工具'},{status:400});
   const name=body.params.name,args=body.params.arguments??{},startedAt=Date.now(),index=++calls;
   record({event:'started',index,name,startedAt,argumentsSha256:createHash('sha256').update(JSON.stringify(args)).digest('hex'),arguments:args});
   let result;
   try{result=await kit.call(name,args);}catch(error){result={content:[{type:'text',text:String(error)}],isError:true};}
   // Keep pre-render rejections as well as successful calls; never duplicate image/base64 payloads.
   record({event:'finished',index,name,endedAt:Date.now(),durationMs:Date.now()-startedAt,isError:result.isError===true,error:result.isError?result.content.filter(c=>c.type==='text').map(c=>c.text).join('\n'):null,contentTypes:result.content.map(c=>c.type)});
   return Response.json(result);
  }catch(e){return Response.json({content:[{type:'text',text:String(e)}],isError:true});}
 }});
 const url=`http://127.0.0.1:${server.port}/${token}`;
 const args=['-c',`mcp_servers.scene_feedback.enabled_tools=${JSON.stringify(names)}`,'-c','mcp_servers.scene_feedback.default_tools_approval_mode="approve"','-c','features.shell_tool=false','-c','features.unified_exec=false','-c',`mcp_servers.scene_feedback.command=${JSON.stringify(process.execPath)}`,
  '-c',`mcp_servers.scene_feedback.args=${JSON.stringify([join(import.meta.dirname,'codex-tools-stdio.ts'),url])}`,
  '-c','mcp_servers.scene_feedback.required=true','-c','mcp_servers.scene_feedback.startup_timeout_sec=15','-c','mcp_servers.scene_feedback.tool_timeout_sec=240'];
 return {args,close:()=>server.stop(true)};
}
