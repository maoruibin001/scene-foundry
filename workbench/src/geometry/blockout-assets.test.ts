import {test,expect} from 'bun:test';
import {rmSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {checkpointFixture} from './checkpoint-fixture';
import {read,runDir} from '../store';
import {OPTIMIZATION_POLICY} from '../generation-policy';
import {blockoutTemplateInput,generateBlockoutTemplates,validateBlockoutTemplate} from './blockout-assets';
import {ValidatedCache,validatedKey} from '../validated-cache';
test('灰模按模板有界并行；移动相机和实例全量复用；局部改动只重建一项',async()=>{
 const f=checkpointFixture(),id=crypto.randomUUID(),folder=runDir(id),cache=new ValidatedCache(join(f.root,'cache'));mkdirSync(folder,{recursive:true});let calls=0,active=0,peak=0;
 try{const space=read(join(f.registration.generationDir,'layout.json')),brief=space.program.templates[0];space.program.templates=['a','b','c','d'].map(id=>({...brief,id}));space.program.instances=space.program.templates.map(t=>({...space.program.instances[0],id:t.id,template:t.id}));
  const job={...f.job,id,blockout:{},optimizationPolicy:OPTIMIZATION_POLICY,executionSettings:{assetConcurrency:2}},ctx={job,images:[],signal:new AbortController().signal};
  const request=async(input:any,_dir:string,validate:any)=>{const key=validatedKey(input,{version:1});const row=await cache.use(key,validate,async()=>{active++;calls++;peak=Math.max(peak,active);await Bun.sleep(5);active--;const brief=JSON.parse(input.text).brief;return {value:{templates:[{...f.geometry.template,id:brief.id,parts:f.geometry.template.parts.map(p=>({...p,material:'blockout'}))}]},receipt:{}};},{jobId:id},input.signal);return {...row.result,reuse:row.reuse};};
  const first=await generateBlockoutTemplates(space,ctx,folder,request as any);expect(first.value.templates).toHaveLength(4);expect(calls).toBe(4);expect(peak).toBe(2);
  space.cameras[0].position=[100,0,0];space.program.instances[0].position=[15,0,0];await generateBlockoutTemplates(space,ctx,folder,request as any);expect(calls).toBe(4);expect(job.blockout.templateProgress.reused).toBe(4);
  space.program.templates[1].description='改变轮廓要求';await generateBlockoutTemplates(space,ctx,folder,request as any);expect(calls).toBe(5);expect(job.blockout.templateProgress.reused).toBe(3);
  expect(()=>validateBlockoutTemplate({templates:[]},space,brief)).toThrow();const before=blockoutTemplateInput(space,space.program.templates[0]);space.spatialOpenings=[{id:'opening',instanceId:'a',center:[1,1,1]}];expect(blockoutTemplateInput(space,space.program.templates[0])).not.toEqual(before);
 }finally{rmSync(f.root,{recursive:true,force:true});rmSync(folder,{recursive:true,force:true});}
});

test('标准9类灰模只发3批并行调用；每项仍独立验证并可编译',async()=>{
 const f=checkpointFixture(),id=crypto.randomUUID(),folder=runDir(id);mkdirSync(folder,{recursive:true});let calls=0,active=0,peak=0;
 try{const {matchingPolicy}=await import('../matching-level'),{compileGeometryProgram}=await import('./program');
 const space=read(join(f.registration.generationDir,'layout.json')),brief=space.program.templates[0];space.program.templates=Array.from({length:9},(_,i)=>({...brief,id:'t'+i}));space.program.instances=space.program.templates.map(t=>({...space.program.instances[0],id:t.id,template:t.id}));
 const job={...f.job,id,blockout:{},matchingPolicy:matchingPolicy('standard'),optimizationPolicy:{...OPTIMIZATION_POLICY,matchingLevel:'standard'},executionSettings:{assetConcurrency:2}};
 const request=async(input:any,_dir:string,validate:any)=>{calls++;active++;peak=Math.max(peak,active);await Bun.sleep(2);active--;const items=JSON.parse(input.text).items;expect(items.length).toBeLessThanOrEqual(4);const value={templates:items.map(x=>({...f.geometry.template,id:x.brief.id,parts:f.geometry.template.parts.map(p=>({...p,material:'blockout'}))}))};expect(()=>validate({templates:[]})).toThrow();expect(()=>validate({templates:value.templates.map(t=>({...t,id:'bad'}))})).toThrow();return {value:validate(value),receipt:{}};};
 const result=await generateBlockoutTemplates(space,{job,images:[],signal:new AbortController().signal},folder,request as any);expect(calls).toBe(3);expect(peak).toBe(2);expect(result.value.templates.map(t=>t.id)).toEqual(space.program.templates.map(t=>t.id));
 const {BLOCKOUT_MATERIALS}=await import('./blockout-assets');expect(compileGeometryProgram({...space.program,materials:BLOCKOUT_MATERIALS,templates:result.value.templates},{}).triangles).toBeGreaterThan(0);for(const t of result.value.templates)expect(read(join(folder,'templates',t.id,'geometry.json')).templates[0]).toEqual(t);
 }finally{rmSync(f.root,{recursive:true,force:true});rmSync(folder,{recursive:true,force:true});}
});
