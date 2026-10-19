import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {currentSceneKind,scenePath,sceneHTML,sceneGenerationSettings} from '../public/scene-context.js';
import {requestJSON} from '../public/request.js';
import {ReferenceBaselines} from './reference-baseline';
import {digest} from './store';

function withLocation(pathname:string,run:()=>Promise<void>){
 const previous=Object.getOwnPropertyDescriptor(globalThis,'location');
 Object.defineProperty(globalThis,'location',{value:{pathname},configurable:true});
 return run().finally(()=>{if(previous)Object.defineProperty(globalThis,'location',previous);else delete (globalThis as any).location;});
}

test('场景上下文按完整路径识别，两类API与本地文件分别绑定，重复映射不叠加',()=>{
 for(const path of ['/','/create','/voxels/'])expect(currentSceneKind(path)).toBe('ordinary');
 for(const path of ['/voxel','/voxel/','/voxel/process/'])expect(currentSceneKind(path)).toBe('voxel');
 for(const path of ['/api/jobs?id=one','/api/uploads','/files/runs/job/a.png','/process/#job=run:one']){
  expect(scenePath(path,'ordinary')).toBe(path);
  const mapped=scenePath(path,'voxel');expect(mapped).toBe(path.startsWith('/api/')?'/api/voxel/'+path.slice(5):'/voxel'+path);
  expect(scenePath(mapped,'voxel')).toBe(mapped);
 }
 for(const path of ['https://127.0.0.1:19900/preview','http://127.0.0.1:19900/preview','#job/same','/app.js','/style.css'])expect(scenePath(path,'voxel')).toBe(path);
});

test('详情只转换实际URL属性，保留参考文字、证据JSON和引擎绝对预览地址',()=>{
 const html='<p>原文 /api/jobs/same 与 /files/scene</p><a href="/api/jobs/same/download">包</a><iframe data-src="/process/#job=run:same"></iframe><img src="/files/uploads/a.png"><iframe src="http://127.0.0.1:19900/preview"></iframe><pre>{"path":"/files/a"}</pre>';
 const scoped=sceneHTML(html,'voxel');
 expect(scoped).toContain('href="/api/voxel/jobs/same/download"');expect(scoped).toContain('data-src="/voxel/process/#job=run:same"');expect(scoped).toContain('src="/voxel/files/uploads/a.png"');
 expect(scoped).toContain('<p>原文 /api/jobs/same 与 /files/scene</p>');expect(scoped).toContain('src="http://127.0.0.1:19900/preview"');expect(scoped).toContain('<pre>{"path":"/files/a"}</pre>');
 expect(sceneHTML(scoped,'voxel')).toBe(scoped);expect(sceneHTML(html,'ordinary')).toBe(html);
});

test('共享请求的GET、JSON和图片上传都采用当前worker，失败的写入不自动重放',async()=>withLocation('/voxel/',async()=>{
 const calls:any[]=[];
 const fetcher=async(path:string,init:any)=>{calls.push({path,init});return Response.json({ok:true});};
 await requestJSON('/api/state',undefined,{fetch:fetcher});
 await requestJSON('/api/references/ref/approve',{}, {fetch:fetcher});
 const form=new FormData();form.append('file',new Blob(['image']),'photo.jpg');await requestJSON('/api/uploads',form,{fetch:fetcher});
 expect(calls.map(c=>c.path)).toEqual(['/api/voxel/state','/api/voxel/references/ref/approve','/api/voxel/uploads']);
 expect(calls[1].init.method).toBe('POST');expect(calls[1].init.body).toBe('{}');expect(calls[2].init.body).toBe(form);
 let writes=0;await expect(requestJSON('/api/jobs/one/cancel',{}, {fetch:async()=>{writes++;return Response.json({error:'已停止，回执异常'},{status:409});}})).rejects.toThrow('已停止，回执异常');expect(writes).toBe(1);
}));

test('普通模式共享请求保持原API，避免体素上下文污染普通列表',async()=>withLocation('/',async()=>{
 const calls:string[]=[];await requestJSON('/api/jobs?status=running',undefined,{fetch:async(path:string)=>{calls.push(path);return Response.json({jobs:[]});}});
 expect(calls).toEqual(['/api/jobs?status=running']);
}));

test('共享参考确认到启动保留体素类型与原图顺序，普通预设不写入体素，重复开始不新建',()=>{
 const root=mkdtempSync(join(tmpdir(),'shared-ui-reference-')),uploads=join(root,'uploads');mkdirSync(uploads);
 try{
  const ids=['view-one','view-two'].map(text=>{const bytes=Buffer.from(text),id=digest(bytes),file=id+'.jpg';writeFileSync(join(uploads,file),bytes);writeFileSync(join(uploads,id+'.json'),JSON.stringify({id,file,name:text,mime:'image/jpeg'}));return id;});
  const references=new ReferenceBaselines(join(root,'references'),uploads),input={pipelinePreset:'effects',scoreWeights:{lighting:30},complexity:'complex',reuseMode:'fresh',modelSettings:{model:'frozen-model'},policy:{deliveryStandard:'basic70'}};
  const original=JSON.stringify(input),settings=sceneGenerationSettings(input,'voxel'),ref=references.create({prompt:'同一场景的两个机位',imageIds:ids,generationSettings:settings});
  expect(JSON.stringify(input)).toBe(original);expect(settings.sceneKind).toBe('voxel');expect(settings).not.toHaveProperty('pipelinePreset');expect(settings).not.toHaveProperty('scoreWeights');
  references.approve(ref.id);let creations=0;
  const start=()=>references.start({baselineId:ref.id,prompt:ref.prompt,imageIds:ids},()=>{creations++;return {id:'created-voxel',...references.get(ref.id).generationSettings};});
  const job=start();expect(job.sceneKind).toBe('voxel');expect(job.modelSettings).toEqual(input.modelSettings);expect(references.get(ref.id).imageIds).toEqual(ids);expect(start()).toEqual({id:'created-voxel',reused:true});expect(creations).toBe(1);
  expect(sceneGenerationSettings(input,'ordinary')).toEqual(input);
 }finally{rmSync(root,{recursive:true,force:true});}
});
