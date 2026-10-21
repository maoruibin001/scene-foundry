import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {uiHandler} from './ui-server';
import {referenceImageAdvice} from '../public/reference-guidance.js';

test('ordinary and voxel normal output preview responses receive live FPS URLs; other actions are unchanged',async()=>{
 const root=mkdtempSync(join(tmpdir(),'preview-fps-ui-')),seen:string[]=[],wrapped:string[]=[];
 const upstream=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){seen.push(new URL(req.url).pathname);return Response.json({url:'http://localhost:19775/',kept:'candidate'},{headers:{'Cache-Control':'max-age=99'}});}});
 try{
  const handler=uiHandler(root,upstream.url.toString(),undefined,upstream.url.toString(),undefined,{async wrapURL(url){wrapped.push(url);return 'http://127.0.0.1:54321/';}});
  const id='11111111-1111-1111-1111-111111111111';
  for(const prefix of ['/api/','/api/voxel/']){
   const response=await handler(new Request('http://127.0.0.1:19884'+prefix+'jobs/'+id+'/preview-output',{method:'POST',body:'{}'}));
   expect(await response.json()).toEqual({url:'http://127.0.0.1:54321/',sourceUrl:'http://localhost:19775/',liveFps:true,kept:'candidate'});expect(response.headers.get('Cache-Control')).toBe('no-store');
  }
  expect(wrapped).toEqual(['http://localhost:19775/','http://localhost:19775/']);
  const other=await handler(new Request('http://127.0.0.1:19884/api/jobs/'+id+'/cancel',{method:'POST',body:'{}'}));
  expect(await other.json()).toEqual({url:'http://localhost:19775/',kept:'candidate'});expect(seen).toHaveLength(3);expect(wrapped).toHaveLength(2);
 }finally{upstream.stop(true);rmSync(root,{recursive:true,force:true});}
});

test('FPS decoration failure preserves the existing preview and explicitly reports unavailable metrics',async()=>{
 const root=mkdtempSync(join(tmpdir(),'preview-fps-fallback-'));
 const upstream=Bun.serve({hostname:'127.0.0.1',port:0,fetch(){return Response.json({url:'http://localhost:19775/'});}});
 try{
  const handler=uiHandler(root,upstream.url.toString(),undefined,undefined,undefined,{async wrapURL(){throw Error('proxy unavailable');}});
  const response=await handler(new Request('http://127.0.0.1/api/jobs/11111111-1111-1111-1111-111111111111/preview-output',{method:'POST',body:'{}'}));
  const value=await response.json();expect(value.url).toBe('http://localhost:19775/');expect(value.liveFps).toBe(false);expect(value.fpsWarning).toContain('实时帧率暂不可用');
 }finally{upstream.stop(true);rmSync(root,{recursive:true,force:true});}
});

test('reference advice recommends multiple views without changing text or single-image contracts',()=>{
 expect(referenceImageAdvice(0)).toContain('至少选择 2 张');expect(referenceImageAdvice(1)).toContain('也可继续使用单张');expect(referenceImageAdvice(2)).toContain('已上传 2 张');
 const page=readFileSync(new URL('../public/index.html',import.meta.url),'utf8'),app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 expect(page).toContain('推荐 2–5 张');expect(page).toContain('id="image" type="file" multiple');expect(app).toContain('referenceImageAdvice(imageIds.length)');expect(app).toContain('!imageIds.length');expect(app).not.toContain('imageIds.length<2');
});
