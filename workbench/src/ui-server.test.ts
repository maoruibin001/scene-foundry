import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {uiHandler} from './ui-server';

test('执行过程目录入口提供index.html及相对模块，目录不能作为Bun.file响应',async()=>{
 const root=mkdtempSync(join(tmpdir(),'scene-ui-process-'));mkdirSync(join(root,'process'));mkdirSync(join(root,'no-index'));
 writeFileSync(join(root,'index.html'),'<h1>生成记录</h1>');writeFileSync(join(root,'process/index.html'),'<h1>生成过程</h1><script type="module" src="./app.js"></script>');writeFileSync(join(root,'process/app.js'),'export const viewer=true;');
 let forwarded=0;const upstream=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){forwarded++;return Response.json({path:new URL(req.url).pathname});}});
 try{
  const handle=uiHandler(root,upstream.url.toString());
  for(const path of ['/','/process/']){const response=await handle(new Request('http://127.0.0.1:19774'+path));expect(response.status).toBe(200);expect(response.headers.get('Content-Type')).toContain('text/html');expect(await response.text()).toContain(path==='/'?'生成记录':'生成过程');}
  expect(await(await handle(new Request('http://127.0.0.1:19774/process/app.js'))).text()).toContain('viewer=true');expect(forwarded).toBe(0);
  expect(await(await handle(new Request('http://127.0.0.1:19774/no-index/'))).json()).toEqual({path:'/no-index/'});
  expect(await(await handle(new Request('http://127.0.0.1:19774/process'))).json()).toEqual({path:'/process'});
 }finally{upstream.stop(true);rmSync(root,{recursive:true,force:true});}
});

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
test('新版独立界面更新旧 worker 的只读统计，失败时保留原统计',async()=>{
 const root=mkdtempSync(join(tmpdir(),'scene-ui-timing-current-')),id='11111111-1111-1111-1111-111111111111';
 const upstream=Bun.serve({hostname:'127.0.0.1',port:0,fetch(){return Response.json({production:{totalMs:1200,reassessments:0},totalMs:700});}});
 try{
  const url='http://127.0.0.1/api/jobs/'+id+'/timing',handle=uiHandler(root,upstream.url.toString(),()=>({totalMs:1200,reassessments:1}));
  expect(await(await handle(new Request(url))).json()).toEqual({production:{totalMs:1200,reassessments:1},totalMs:700});
  const broken=uiHandler(root,upstream.url.toString(),()=>{throw Error('missing');});
  expect(await(await broken(new Request(url))).json()).toEqual({production:{totalMs:1200,reassessments:0},totalMs:700,productionError:true});
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

test('隔离只读观察器覆盖冻结体素worker的过程读取，写入拒绝且普通API仍走原后端',async()=>{
 const root=mkdtempSync(join(tmpdir(),'voxel-observer-ui-')),data=mkdtempSync(join(tmpdir(),'voxel-observer-data-')),id='11111111-1111-1111-1111-111111111111';
 const folder=join(data,'runs',id,'generation','space-repair-0');mkdirSync(folder,{recursive:true});
 const job=join(data,'runs',id,'job.json'),bytes=JSON.stringify({id,status:'failed',stage:'space',events:[],stages:{}});writeFileSync(job,bytes);
 writeFileSync(join(folder,'scene-space-execution.json'),JSON.stringify({status:'completed',role:'scene-space',startedAt:new Date().toISOString()}));writeFileSync(join(folder,'scene-space-stdout.log'),'frozen producer output');
 let requests=0;const upstream=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){requests++;return Response.json({path:new URL(req.url).pathname});}});
 try{const handle=uiHandler(root,upstream.url.toString(),undefined,upstream.url.toString(),data),base='http://127.0.0.1:19774';
  const detail=await(await handle(new Request(base+'/api/voxel/process/detail?key=run%3A'+id))).json();expect(detail.calls.map((c:any)=>c.id)).toContain('generation/space-repair-0/scene-space');expect(requests).toBe(0);
  expect((await handle(new Request(base+'/api/voxel/process/detail',{method:'POST',body:'{}'}))).status).toBe(405);expect(requests).toBe(0);
  const ordinary=await(await handle(new Request(base+'/api/jobs'))).json();expect(ordinary.path).toBe('/api/jobs');expect(requests).toBe(1);
  const forbidden=await handle(new Request(base+'/api/voxel/process/detail?key=run%3A'+id,{headers:{origin:'https://example.com'}}));expect(forbidden.status).toBe(403);
  expect(await Bun.file(job).text()).toBe(bytes);
 }finally{upstream.stop(true);rmSync(root,{recursive:true,force:true});rmSync(data,{recursive:true,force:true});}
});
