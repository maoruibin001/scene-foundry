import {test,expect} from 'bun:test';
import {join} from 'node:path';
import {mkdirSync,rmSync,readFileSync} from 'node:fs';
import {repairBlockoutContours} from './blockout-contours';
import {compileGeometryProgram,shapeTriangles} from './program';
import {checkpointFixture} from './checkpoint-fixture';
import {read,save,runDir} from '../store';
import {generateBlockoutTemplates,BLOCKOUT_MATERIALS} from './blockout-assets';
import {recoverBlockoutTemplates} from './blockout-recovery';
import {matchingPolicy} from '../matching-level';
import {limitBlockoutTessellation} from './blockout-tessellation';

function localFixture(){
 const f=checkpointFixture(),id=crypto.randomUUID(),root=runDir(id),folder=join(root,'generation/blockout/1');
 const space=read(join(f.registration.generationDir,'layout.json')),brief=space.program.templates[0];
 space.program.templates=Array.from({length:10},(_,i)=>({...brief,id:'t'+i}));space.program.instances=space.program.templates.map(t=>({...space.program.instances[0],id:t.id,template:t.id}));
 const job:any={...f.job,id,reuseMode:'fresh',executionRecoveryRoot:id,plan:{requirements:[]},blockout:{},matchingPolicy:matchingPolicy('standard'),optimizationPolicy:{matchingLevel:'standard'},executionSettings:{assetConcurrency:2}};
 const value={templates:space.program.templates.map(t=>({...f.geometry.template,id:t.id,parts:f.geometry.template.parts.map(p=>({...p,material:'blockout'}))}))};
 const seed=(round:number,nextSpace=space,model=job.modelSettings.model)=>{const d=join(root,'generation/blockout',String(round));mkdirSync(join(d,'batches/0'),{recursive:true});save(join(d,'space.json'),nextSpace);save(join(d,'batches/0/scene-blockout-parsed.json'),value);save(join(d,'batches/0/scene-blockout-receipt.json'),{requestedModel:model});};
 mkdirSync(folder,{recursive:true});save(join(root,'job.json'),job);seed(0);
 return {f,id,root,folder,space,job,value,seed,ctx:{job,plan:job.plan,images:[],signal:new AbortController().signal},close:()=>{rmSync(f.root,{recursive:true,force:true});rmSync(root,{recursive:true,force:true});}};
}

test('同任务空间修正只重建6个改变的局部契约，4个原样复用并按当前空间校验',async()=>{
 const x=localFixture();try{
  const source=join(x.root,'generation/blockout/0/batches/0/scene-blockout-parsed.json'),before=readFileSync(source,'utf8'),next=structuredClone(x.space);let calls=0;
  for(const brief of next.program.templates.slice(4))brief.description+='改变轮廓';next.cameras[0].position=[50,-6,4];next.program.instances[0].position=[20,0,0];
  const result=await generateBlockoutTemplates(next,x.ctx,x.folder,(async(input,_dir,validate)=>{calls++;return {value:validate({templates:JSON.parse(input.text).items.map(i=>x.value.templates.find(t=>t.id===i.brief.id))})};}) as any);
  expect(calls).toBe(2);expect(x.job.blockout.templateProgress.reused).toBe(4);expect(result.value.templates).toEqual(x.value.templates);
  expect(compileGeometryProgram({...next.program,materials:BLOCKOUT_MATERIALS,templates:result.value.templates}).triangles).toBeGreaterThan(0);
  expect(readFileSync(source,'utf8')).toBe(before);const proof=read(join(x.folder,'templates/t0/recovery-source.json'));expect(proof.sourceJobId).toBe(x.id);expect(proof.sourceRound).toBe(0);expect(proof.localContractSha256).toMatch(/^[a-f0-9]{64}$/);
 }finally{x.close();}
});

test('开口变化及当前实例校验失败不复用；当前轮和未来轮不得作为来源',()=>{
 const x=localFixture();try{
  const next=structuredClone(x.space);next.spatialOpenings=[{id:'door',instanceId:'t0',center:[1,1,1]}];
  expect(recoverBlockoutTemplates(next,x.ctx,v=>v,x.folder).size).toBe(9);
  expect(recoverBlockoutTemplates(x.space,x.ctx,(v,b)=>{if(b.id==='t1')throw Error('current instance bounds');return v;},x.folder).size).toBe(9);
  x.seed(1,next);x.seed(2,next);for(const b of next.program.templates)b.description+='not previously generated';
  x.seed(1,next);x.seed(2,next);expect(recoverBlockoutTemplates(next,x.ctx,v=>v,x.folder).size).toBe(0);
 }finally{x.close();}
});

test('原始输入、计划、模型或执行根改变不得跨恢复来源复用；错误模型收据亦拒绝',()=>{
 const x=localFixture(),child=crypto.randomUUID();try{
  const ctx={...x.ctx,job:{...x.job,id:child,recoverySourceJobId:x.id}};expect(recoverBlockoutTemplates(x.space,ctx,v=>v).size).toBe(10);
  for(const change of [{prompt:'changed'},{images:[{id:'different'}]},{modelSettings:{model:'different'}},{executionRecoveryRoot:child},{reuseMode:'reuse'}])expect(recoverBlockoutTemplates(x.space,{...ctx,job:{...ctx.job,...change}},v=>v).size).toBe(0);
  expect(recoverBlockoutTemplates(x.space,{...ctx,plan:{requirements:[{id:'changed'}]}},v=>v).size).toBe(0);
  x.seed(0,x.space,'wrong-route');expect(recoverBlockoutTemplates(x.space,x.ctx,v=>v,x.folder).size).toBe(0);
 }finally{x.close();}
});

test('新空间机制沿同一执行根复用已校验局部灰模，不混成跨输入缓存或执行恢复',()=>{
 const x=localFixture(),child=crypto.randomUUID();try{
  const ctx={...x.ctx,job:{...x.job,id:child,spatialRepairSource:{jobId:x.id,round:0}}};
  const recovered=recoverBlockoutTemplates(x.space,ctx,v=>v);expect(recovered.size).toBe(10);expect([...recovered.values()].every(r=>r.proof.sourceJobId===x.id)).toBe(true);
  expect(ctx.job.recoverySourceJobId).toBeUndefined();expect(recoverBlockoutTemplates(x.space,{...ctx,job:{...ctx.job,executionRecoveryRoot:child}},v=>v).size).toBe(0);
  x.seed(1);const later=join(x.root,'generation/blockout/1/batches/0/scene-blockout-parsed.json'),value=read(later);value.templates[0].parts[0].position[0]+=.1;save(later,value);
  const picked=recoverBlockoutTemplates(x.space,ctx,v=>v);expect(picked.get('t0').proof.sourceRound).toBe(0);expect(picked.get('t0').value.templates[0]).toEqual(x.value.templates[0]);
 }finally{x.close();}
});

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
test('从头首轮恢复同链已生成批次，零模型调用并通过严格编译；不同来源或模型不得恢复',async()=>{
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
  expect(recoverBlockoutTemplates({...space,cameras:[]},ctx,v=>v).size).toBe(4);
  expect(recoverBlockoutTemplates(space,{...ctx,job:{...job,modelSettings:{model:'other'}}},v=>v).size).toBe(0);
 }finally{rmSync(f.root,{recursive:true,force:true});rmSync(runDir(sourceId),{recursive:true,force:true});rmSync(runDir(id),{recursive:true,force:true});}
});
