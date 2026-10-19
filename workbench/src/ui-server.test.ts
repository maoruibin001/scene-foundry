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

test('普通与体素创建和记录入口提供同一个主壳，旧体素index不能覆盖共享界面',async()=>{
 const root=mkdtempSync(join(tmpdir(),'scene-unified-shell-')),shell='<!doctype html><h1>共享场景界面</h1><script type="module" src="/app.js"></script>';
 mkdirSync(join(root,'voxel'));writeFileSync(join(root,'index.html'),shell);writeFileSync(join(root,'voxel/index.html'),'<h1>旧独立体素界面</h1>');
 let requests=0;const upstream=Bun.serve({hostname:'127.0.0.1',port:0,fetch(){requests++;return Response.json({unexpectedProxy:true});}});
 try{
  const handle=uiHandler(root,upstream.url.toString());
  for(const path of ['/','/voxel/','/voxel/index.html']){
   const response=await handle(new Request('http://127.0.0.1:19884'+path));
   expect(response.status).toBe(200);expect(await response.text()).toBe(shell);expect(response.headers.get('Content-Type')).toContain('text/html');
   expect(response.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');expect(response.headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp');
  }
  expect(requests).toBe(0);
 }finally{upstream.stop(true);rmSync(root,{recursive:true,force:true});}
});

test('体素过程静态别名使用本地process真实文件和相对模块，不请求冻结worker静态文件',async()=>{
 const root=mkdtempSync(join(tmpdir(),'scene-unified-process-'));
 mkdirSync(join(root,'process/vendor'),{recursive:true});
 const files={'index.html':'<h1>共同过程页</h1><script type="module" src="./app.js"></script>','app.js':'export const processView="shared";','api-path.js':'export const scope="pathname";','style.css':'.call{display:block}','vendor/xterm.mjs':'export const term=true;'};
 for(const [name,body]of Object.entries(files))writeFileSync(join(root,'process',name),body);
 let requests=0;const upstream=Bun.serve({hostname:'127.0.0.1',port:0,fetch(){requests++;return Response.json({unexpectedProxy:true});}});
 try{
  const handle=uiHandler(root,upstream.url.toString(),undefined,upstream.url.toString());
  for(const [name,body]of Object.entries(files)){
   const suffix=name==='index.html'?'':name;
   for(const prefix of ['/process/','/voxel/process/']){
    const response=await handle(new Request('http://127.0.0.1:19884'+prefix+suffix));expect(response.status).toBe(200);expect(await response.text()).toBe(body);
   }
  }
  expect(requests).toBe(0);
 }finally{upstream.stop(true);rmSync(root,{recursive:true,force:true});}
});

test('体素过程页相对引用scene-context模块可由体素静态别名读取',async()=>{
 const root=mkdtempSync(join(tmpdir(),'scene-unified-context-')),source='export const currentSceneKind=()=>"voxel";';
 writeFileSync(join(root,'scene-context.js'),source);
 let requests=0;const upstream=Bun.serve({hostname:'127.0.0.1',port:0,fetch(){requests++;return Response.json({unexpectedProxy:true});}});
 try{
  const handle=uiHandler(root,upstream.url.toString(),undefined,upstream.url.toString());
  for(const path of ['/scene-context.js','/voxel/scene-context.js']){
   const response=await handle(new Request('http://127.0.0.1:19884'+path));expect(response.status).toBe(200);expect(await response.text()).toBe(source);expect(response.headers.get('Content-Type')).toContain('javascript');
  }
  expect(requests).toBe(0);
 }finally{upstream.stop(true);rmSync(root,{recursive:true,force:true});}
});

test('共享静态壳不混合普通与体素API、文件或过程namespace，上游仍分别接收原始路径',async()=>{
 const root=mkdtempSync(join(tmpdir(),'scene-unified-proxy-')),seen:any[]=[];
 writeFileSync(join(root,'index.html'),'shared shell');
 const serve=(worker:string)=>Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){const url=new URL(req.url),value={worker,path:url.pathname,query:url.search};seen.push(value);return Response.json(value);}});
 const ordinary=serve('ordinary'),voxel=serve('voxel');
 try{
  const handle=uiHandler(root,ordinary.url.toString(),undefined,voxel.url.toString());
  const routes=[['/api/state?compact=1','ordinary'],['/api/jobs?page=2','ordinary'],['/files/uploads/reference.jpg','ordinary'],['/api/voxel/state?compact=1','voxel'],['/api/voxel/jobs?page=2','voxel'],['/voxel/files/uploads/reference.jpg','voxel'],['/api/voxel/process/index','voxel'],['/voxel/process/missing.js','voxel']];
  for(const [path,worker]of routes){const response=await handle(new Request('http://127.0.0.1:19884'+path));expect(response.status).toBe(200);expect(await response.json()).toEqual({worker,path:path.split('?')[0],query:path.includes('?')?'?'+path.split('?')[1]:''});}
  expect(seen).toHaveLength(routes.length);
  const forbidden=await handle(new Request('http://127.0.0.1:19884/api/voxel/jobs',{headers:{origin:'https://example.com'}}));expect(forbidden.status).toBe(403);expect(seen).toHaveLength(routes.length);
 }finally{ordinary.stop(true);voxel.stop(true);rmSync(root,{recursive:true,force:true});}
});

test('体素过程静态别名保留逻辑与真实边界，拒绝目录和外根符号链接读取',async()=>{
 const parent=mkdtempSync(join(tmpdir(),'scene-unified-boundary-')),root=join(parent,'public'),outside=join(parent,'private.txt');
 mkdirSync(join(root,'process/no-index'),{recursive:true});writeFileSync(outside,'MUST_NOT_EXPOSE');symlinkSync(outside,join(root,'process/external.txt'));
 mkdirSync(join(parent,'public-extra'));writeFileSync(join(parent,'public-extra/sibling.txt'),'MUST_NOT_EXPOSE');symlinkSync(join(parent,'public-extra'),join(root,'process/prefix-sibling'),'dir');
 const upstream=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){return Response.json({safeProxy:true,path:new URL(req.url).pathname});}});
 try{
  const handle=uiHandler(root,upstream.url.toString(),undefined,upstream.url.toString());
  for(const path of ['/voxel/process/external.txt','/voxel/process/prefix-sibling/sibling.txt','/voxel/process/%2e%2e%2f%2e%2e%2fprivate.txt','/voxel/process/no-index/','/voxel/process/no-index']){
   const response=await handle(new Request('http://127.0.0.1:19884'+path)),body=await response.text();expect(body).not.toContain('MUST_NOT_EXPOSE');expect(JSON.parse(body).safeProxy).toBe(true);
  }
  expect(()=>uiHandler(root,upstream.url.toString(),undefined,'https://example.com')).toThrow('本机');
 }finally{upstream.stop(true);rmSync(parent,{recursive:true,force:true});}
});
