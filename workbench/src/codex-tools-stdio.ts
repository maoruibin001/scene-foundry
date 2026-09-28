import {createInterface} from 'node:readline';
// MCP stdio 桥：只转发父进程给定的本地地址，不接受动态 URL、文件路径或命令。
const endpoint=new URL(process.argv[2]);
if(endpoint.protocol!=='http:'||endpoint.hostname!=='127.0.0.1'||!/^\/[a-f0-9-]{36}$/.test(endpoint.pathname))throw Error('非法工具入口');
async function dispatch(message:any){
 if(message.id===undefined)return;
 const reply=(result:any)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result})+'\n');
 try{
  if(message.method==='initialize')return reply({protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'scene_feedback',version:'1.0.0'},instructions:'仅为当前候选提供编译检查与图像反馈；真实预览不等于视觉验收通过。'});
  if(message.method==='ping')return reply({});
  if(!['tools/list','tools/call'].includes(message.method))throw Error('未知方法');
  const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({method:message.method,params:message.params}),signal:AbortSignal.timeout(240000)});
  if(!response.ok)throw Error('工具服务返回 '+response.status);return reply(await response.json());
 }catch(error){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,error:{code:-32603,message:String(error)}})+'\n');}
}
const input=createInterface({input:process.stdin,crlfDelay:Infinity});
for await(const line of input){if(!line.trim())continue;try{await dispatch(JSON.parse(line));}catch{process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:null,error:{code:-32700,message:'非法JSON'}})+'\n');}}
