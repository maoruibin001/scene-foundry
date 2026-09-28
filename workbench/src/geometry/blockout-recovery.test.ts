import {test,expect} from 'bun:test';
import {join} from 'node:path';
import {mkdirSync,rmSync} from 'node:fs';
import {repairBlockoutContours} from './blockout-contours';
import {compileGeometryProgram,shapeTriangles} from './program';
import {checkpointFixture} from './checkpoint-fixture';
import {read,save,runDir} from '../store';
import {generateBlockoutTemplates,BLOCKOUT_MATERIALS} from './blockout-assets';
import {recoverBlockoutTemplates} from './blockout-recovery';
import {matchingPolicy} from '../matching-level';
import {limitBlockoutTessellation} from './blockout-tessellation';

const crossing=[[-.022,0],[-.11,.49],[-.24,1.02],[-.45,1.47],[-.69,1.6],[-.51,1.59],[-.32,1.25],[-.19,.78],[.025,.13],[.018,0]];
test('真实叶片交叉边解交叉后可编译；顶点、尺寸和原始输出保留',()=>{
 const shape:any={type:'extrusion',outline:crossing,depth:.009};expect(()=>shapeTriangles(shape)).toThrow('轮廓自交');
 const value={templates:[{id:'shore_growth',parts:[{id:'leaf',shape}]}]},before=JSON.stringify(value),fixed=repairBlockoutContours(value);
 expect(fixed.repairs).toHaveLength(1);expect(fixed.repairs[0].reversals).toBeGreaterThan(0);
 expect(JSON.stringify(value)).toBe(before);expect(fixed.value.templates[0].parts[0].shape.outline.map(JSON.stringify).sort()).toEqual(crossing.map(JSON.stringify).sort());
 expect(()=>shapeTriangles(fixed.value.templates[0].parts[0].shape)).not.toThrow();expect(repairBlockoutContours(fixed.value).repairs).toHaveLength(0);
});
test('自接触与零长度边继续拒绝；不使用凸包或删点掩盖无效几何',()=>{
 for(const points of [[[0,0],[1,0],[1,1],[0,0],[0,1]],[[0,0],[1,0],[1,0],[0,1]]]){
  const input={templates:[{id:'t',parts:[{id:'p',shape:{type:'extrusion',outline:points,depth:.1}}]}]};const fixed=repairBlockoutContours(input);
  expect(fixed.repairs).toHaveLength(0);expect(fixed.value).toEqual(input);expect(()=>shapeTriangles(fixed.value.templates[0].parts[0].shape as any)).toThrow();
 }
});
test('灰模仅限制曲面细分，保留形状参数与部件；无效分段仍拒绝',()=>{
 const shape:any={type:'cushion',size:[1,2,3],roundness:2.5,seamDepth:.02,segments:24},input={templates:[{id:'t',parts:[{id:'p',position:[2,3,4],shape}]}]};
 const out=limitBlockoutTessellation(input);expect(out.value.templates[0].parts[0]).toEqual({...input.templates[0].parts[0],shape:{...shape,segments:8}});expect(shape.segments).toBe(24);expect(out.adjustments).toHaveLength(1);
 expect(()=>limitBlockoutTessellation({templates:[{parts:[{shape:{...shape,segments:999}}]}]})).toThrow();
});
test('从头首轮恢复同链已生成批次，零模型调用并通过严格编译；不同来源和空间不得恢复',async()=>{
 const f=checkpointFixture(),sourceId=crypto.randomUUID(),id=crypto.randomUUID(),folder=join(runDir(id),'generation/blockout/0');
 try{
  const space=read(join(f.registration.generationDir,'layout.json')),brief=space.program.templates[0];space.program.templates=['a','b','c','d'].map(id=>({...brief,id}));space.program.instances=space.program.templates.map(t=>({...space.program.instances[0],id:t.id,template:t.id}));
  const plan={requirements:[]},source={...f.job,id:sourceId,reuseMode:'fresh',executionRecoveryRoot:sourceId,prompt:'test',images:[{id:'ref'}],plan,modelSettings:{model:'fixture',reasoningEffort:'medium'}};
  const sourceFolder=join(runDir(sourceId),'generation/blockout/0');mkdirSync(join(sourceFolder,'batches/0'),{recursive:true});save(join(runDir(sourceId),'job.json'),source);save(join(sourceFolder,'space.json'),space);
  const value={templates:space.program.templates.map(b=>({...f.geometry.template,id:b.id,parts:f.geometry.template.parts.map(p=>({...p,material:'blockout'}))}))};
  save(join(sourceFolder,'batches/0/scene-blockout-parsed.json'),value);save(join(sourceFolder,'batches/0/scene-blockout-receipt.json'),{requestedModel:'fixture'});
  const job={...source,id,recoverySourceJobId:sourceId,blockout:{},matchingPolicy:matchingPolicy('standard'),optimizationPolicy:{matchingLevel:'standard'},executionSettings:{assetConcurrency:2}};
  const ctx={job,plan,images:[],signal:new AbortController().signal};mkdirSync(folder,{recursive:true});let calls=0;
  const result=await generateBlockoutTemplates(space,ctx,folder,(async()=>{calls++;throw Error('should reuse own chain')}) as any);
  expect(calls).toBe(0);expect(job.blockout.templateProgress.completed).toBe(4);expect(job.blockout.templateProgress.reused).toBe(4);
  expect(compileGeometryProgram({...space.program,materials:BLOCKOUT_MATERIALS,templates:result.value.templates}).triangles).toBeGreaterThan(0);
  expect(recoverBlockoutTemplates(space,{...ctx,job:{...job,executionRecoveryRoot:'other'}},v=>v).size).toBe(0);
  expect(recoverBlockoutTemplates({...space,cameras:[]},ctx,v=>v).size).toBe(0);
  expect(recoverBlockoutTemplates(space,{...ctx,job:{...job,modelSettings:{model:'other'}}},v=>v).size).toBe(0);
 }finally{rmSync(f.root,{recursive:true,force:true});rmSync(runDir(sourceId),{recursive:true,force:true});rmSync(runDir(id),{recursive:true,force:true});}
});
