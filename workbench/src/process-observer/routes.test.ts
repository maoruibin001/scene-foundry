import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createProcessRoutes} from './routes';
test('mounted observer leaves pipeline mutations alone and confines its own routes',async()=>{
 const root=mkdtempSync(join(tmpdir(),'record-process-'));
 try{
  mkdirSync(join(root,'runs'));writeFileSync(join(root,'index.html'),'<main>process</main>');
  const route=createProcessRoutes(root,root),req=(path:string,init?:RequestInit)=>new Request('http://127.0.0.1:19774'+path,init);
  expect(route(req('/api/jobs',{method:'POST'}))).toBeNull();
  expect(route(req('/api/process/index',{method:'POST'}))?.status).toBe(405);
  expect(route(req('/api/process/index',{headers:{origin:'https://foreign.example'}}))?.status).toBe(403);
  expect((await route(req('/api/process/index'))?.json()).total).toBe(0);
  const page=route(req('/process/'))!;expect(await page.text()).toContain('<main>process</main>');
  expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'self'");
  expect(route(req('/process/server.ts'))?.status).toBe(404);
  expect(route(req('/api/process/media?path=../secret'))?.status).toBe(400);
 }finally{rmSync(root,{recursive:true,force:true});}
});
