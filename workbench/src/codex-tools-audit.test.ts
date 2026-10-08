import {test,expect} from 'bun:test';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {serveCodexTools,type CodexToolKit} from './codex-tools';

test('工具异常和工具返回失败均有独立完成记录，图片正文不进入审计且未知入口不能调用',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'codex-tool-audit-')),audit=join(folder,'calls.jsonl');let invoked=0;
 const kit:CodexToolKit={version:'fixture',instructions:'中文',definitions:[{name:'inspect_scene_parts',inputSchema:{type:'object'}}],async call(_name,args){invoked++;if(args.mode==='throw')throw Error('明确的预算校验错误');return args.mode==='error'?{isError:true,content:[{type:'text',text:'结构无效'}]}:{content:[{type:'text',text:'真实结果'},{type:'image',mimeType:'image/png',data:'image-secret-base64'}]};}};
 const server=serveCodexTools(kit,undefined,audit);try{
  const arg=server.args.find(x=>x.startsWith('mcp_servers.scene_feedback.args='))!,[,url]=JSON.parse(arg.slice(arg.indexOf('=')+1));
  const post=(name:string,args:any)=>fetch(url,{method:'POST',body:JSON.stringify({method:'tools/call',params:{name,arguments:args}})});
  expect((await(await post('inspect_scene_parts',{mode:'throw'})).json()).isError).toBe(true);expect((await(await post('inspect_scene_parts',{mode:'error'})).json()).isError).toBe(true);expect((await(await post('inspect_scene_parts',{mode:'ok'})).json()).isError).not.toBe(true);expect((await post('unknown',{})).status).toBe(400);expect(invoked).toBe(3);
  const content=readFileSync(audit,'utf8'),rows=content.trim().split('\n').map(x=>JSON.parse(x));expect(rows.filter(r=>r.event==='started')).toHaveLength(3);expect(rows.filter(r=>r.event==='finished').map(r=>r.error)).toEqual(['Error: 明确的预算校验错误','结构无效',null]);expect(content).not.toContain('image-secret-base64');
 }finally{server.close();rmSync(folder,{recursive:true,force:true});}
});
