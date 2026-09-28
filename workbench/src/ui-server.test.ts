import {test,expect} from 'bun:test';
import {mkdtempSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {uiHandler} from './ui-server';

test('独立界面保留隔离响应头，API 原样转发，不启动生成器；私有目录不可作为 UI 文件读取',async()=>{
 const root=mkdtempSync(join(tmpdir(),'scene-ui-'));
 writeFileSync(join(root,'index.html'),'<h1>新界面</h1>');
 symlinkSync('/etc/hosts',join(root,'outside.txt'));
 const upstream=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){return Response.json({path:new URL(req.url).pathname,method:req.method,body:req.method==='POST'?await req.text():null},{status:201});}});
 try{
  const handle=uiHandler(root,upstream.url.toString());
  const page=await handle(new Request('http://127.0.0.1/'));
  expect(await page.text()).toContain('新界面');expect(page.headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp');
  const api=await handle(new Request('http://127.0.0.1/api/jobs/id/action',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"example":true}'}));
  expect(api.status).toBe(201);expect(await api.json()).toEqual({path:'/api/jobs/id/action',method:'POST',body:'{"example":true}'});
  const external=await handle(new Request('http://127.0.0.1/outside.txt'));expect((await external.json()).path).toBe('/outside.txt');
  expect(()=>uiHandler(root,'https://example.com')).toThrow('本机');
 }finally{upstream.stop(true);rmSync(root,{recursive:true,force:true});}
});

test('制作耗时仅补充成功的只读 timing 请求，写操作原样转发，统计失败保留原耗时',async()=>{
 const root=mkdtempSync(join(tmpdir(),'scene-ui-timing-')),id='11111111-1111-1111-1111-111111111111';let calls=0;
 const upstream=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){return Response.json({totalMs:700,method:req.method},{headers:{'Cache-Control':'no-cache'}});}});
 try{
  const handle=uiHandler(root,upstream.url.toString(),jobId=>{calls++;expect(jobId).toBe(id);return {totalMs:1200};});
  const timing=await handle(new Request('http://127.0.0.1/api/jobs/'+id+'/timing'));
  expect(await timing.json()).toEqual({totalMs:700,method:'GET',production:{totalMs:1200}});expect(calls).toBe(1);expect(timing.headers.get('Cache-Control')).toBe('no-store');
  await handle(new Request('http://127.0.0.1/api/jobs/'+id+'/timing',{method:'POST',body:'{}'}));expect(calls).toBe(1);
  const broken=uiHandler(root,upstream.url.toString(),()=>{throw Error('记录缺失')});
  expect(await (await broken(new Request('http://127.0.0.1/api/jobs/'+id+'/timing'))).json()).toEqual({totalMs:700,method:'GET',productionError:true});
 }finally{upstream.stop(true);rmSync(root,{recursive:true,force:true});}
});
