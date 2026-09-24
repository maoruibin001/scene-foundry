import {test,expect} from 'bun:test';
import {rmSync,mkdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {recoveryInfo,registerRecovery,dispatchRecovery} from './recovery';
import {checkpointFixture} from './geometry/checkpoint-fixture';
import {read,save} from './store';
import {executionSettings} from './execution-settings';
import {automaticGeneration} from './quality';
function setup(){const f=checkpointFixture();mkdirSync(join(f.root,'materials'));save(join(f.root,'materials/texture-registry.json'),{});Object.assign(f.job,{status:'cancelled',stage:'generate',policy:{score:90},attempt:2});return f;}
test('取消后的磁盘产物不依赖已有索引，恢复前校验且不修改原记录',()=>{const f=setup();try{const before=JSON.stringify(f.job),info=recoveryInfo(f.job,[],f.store,f.root);expect(info).toMatchObject({available:true,mode:'generation',completed:1,total:1});const id=registerRecovery(f.job,info,f.store,f.root);const restored=f.store.restore(id,{...f.job,pipelineVersion:{id:'new'}},join(f.root,'restored'));expect(restored.assets).toHaveLength(1);expect(restored.assets[0].value).toEqual(f.geometry);expect(JSON.stringify(f.job)).toBe(before);}finally{rmSync(f.root,{recursive:true,force:true})}});
test('损坏资产剔除，取消前没产物可手动重新开始；已有合法快照优先保留',()=>{const f=setup();try{const cp=f.store.register(f.registration);save(join(f.registration.generationDir,'assets/shape/geometry.json'),{});let info=recoveryInfo(f.job,[],f.store,f.root);expect(info.completed).toBe(1);expect(info.source).toBe('checkpoint');rmSync(f.store.path(cp.id),{recursive:true});info=recoveryInfo(f.job,[],f.store,f.root);expect(info.completed).toBe(0);expect(info.missing).toBe(1);expect(info.issues.length).toBe(1);rmSync(join(f.root,'generation/layout.json'));expect(recoveryInfo(f.job,[],f.store,f.root)).toMatchObject({available:true,mode:'restart'});}finally{rmSync(f.root,{recursive:true,force:true})}});
test('完整运行证据直接继续评分；运行中的源任务不能恢复',()=>{const f=setup();try{expect(recoveryInfo({...f.job,stage:'judge',runtime:{},plan:{},structure:{}},[],f.store,f.root).mode).toBe('assessment');expect(recoveryInfo({...f.job,status:'running'},[],f.store,f.root).available).toBe(false);}finally{rmSync(f.root,{recursive:true,force:true})}});
test('并发点击与刷新后再点只派发一次，保留输入模型政策，仍在清理时拒绝',async()=>{const f=setup();try{let count=0;const jobs:any[]=[f.job],deps={getJob:(id:string)=>jobs.find(j=>j.id===id),listJobs:()=>jobs,isExecuting:()=>false,inspect:(j:any,all:any[])=>recoveryInfo(j,all,f.store,f.root),resolveSettings:async(j:any)=>{await Bun.sleep(5);return j.modelSettings;},register:(j:any,i:any)=>registerRecovery(j,i,f.store,f.root),create:(source:any,info:any,settings:any,cp:string|null)=>{count++;const next={...source,id:'continued',status:'queued',recoverySourceJobId:source.id,reuseCheckpoint:cp,modelSettings:settings,validationKind:'checkpoint-continuation'};jobs.push(next);return next;}};
 const [a,b]=await Promise.all([dispatchRecovery(f.job.id,deps),dispatchRecovery(f.job.id,deps)]);expect(a.id).toBe(b.id);expect(count).toBe(1);expect((await dispatchRecovery(f.job.id,deps)).id).toBe(a.id);expect(count).toBe(1);expect(f.job.status).toBe('cancelled');expect(a.prompt).toBe(f.job.prompt);expect(a.images).toEqual(f.job.images);expect(a.policy).toEqual(f.job.policy);expect(automaticGeneration(a)).toBe(false);
 jobs.pop();await expect(dispatchRecovery(f.job.id,{...deps,isExecuting:()=>true})).rejects.toThrow();expect(count).toBe(1);
 }finally{rmSync(f.root,{recursive:true,force:true})}});
test('并发设置默认 6，随任务值复用且拒绝无界输入',()=>{expect(executionSettings().assetConcurrency).toBe(6);expect(executionSettings({assetConcurrency:3}).assetConcurrency).toBe(3);for(const n of [0,7,1.5,'6',Infinity])expect(()=>executionSettings({assetConcurrency:n})).toThrow();});

test('修正被取消后保留修正语义，有完整产物则不重复模型修正',()=>{const f=setup();try{const j={...f.job,refineScene:true,reuseSceneFrom:'original'};expect(recoveryInfo(j,[],f.store,f.root).mode).toBe('refinement');expect(recoveryInfo({...j,sceneProgram:{}},[],f.store,f.root).mode).toBe('scene');expect(recoveryInfo({...j,stage:'judge',sceneProgram:{},runtime:{},plan:{},structure:{}},[],f.store,f.root).mode).toBe('assessment');}finally{rmSync(f.root,{recursive:true,force:true})}});
test('再次恢复已完成的场景时不退回旧资产检查点',()=>{const f=setup();try{
 const restored={...f.job,stage:'runtime',refineScene:false,reuseSceneFrom:'refined',recoverySourceJobId:'refined',sceneProgram:{templates:[{id:'updated'}]}};
 expect(recoveryInfo(restored,[],f.store,f.root).mode).toBe('scene');
 expect(recoveryInfo({...restored,reuseSceneFrom:null,recoverySourceJobId:null},[],f.store,f.root).mode).toBe('scene');
 expect(recoveryInfo({...restored,status:'running'},[],f.store,f.root).available).toBe(false);
 }finally{rmSync(f.root,{recursive:true,force:true})}});
