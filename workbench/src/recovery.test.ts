import {test,expect} from 'bun:test';
import {rmSync,mkdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {recoveryInfo,registerRecovery,dispatchRecovery,continuationSceneSource,spatialRecoveryOptions} from './recovery';
import {checkpointFixture} from './geometry/checkpoint-fixture';
import {read,save} from './store';
import {executionSettings} from './execution-settings';
import {automaticGeneration} from './quality';
import {improvement} from './improvement-governance';
function setup(){const f=checkpointFixture();mkdirSync(join(f.root,'materials'));save(join(f.root,'materials/texture-registry.json'),{});Object.assign(f.job,{status:'cancelled',stage:'generate',policy:{score:90},attempt:2});return f;}
test('取消后的磁盘产物不依赖已有索引，恢复前校验且不修改原记录',()=>{const f=setup();try{const before=JSON.stringify(f.job),info=recoveryInfo(f.job,[],f.store,f.root);expect(info).toMatchObject({available:true,mode:'generation',completed:1,total:1});const id=registerRecovery(f.job,info,f.store,f.root);const restored=f.store.restore(id,{...f.job,pipelineVersion:{id:'new'}},join(f.root,'restored'));expect(restored.assets).toHaveLength(1);expect(restored.assets[0].value).toEqual(f.geometry);expect(JSON.stringify(f.job)).toBe(before);}finally{rmSync(f.root,{recursive:true,force:true})}});
test('损坏资产剔除，取消前没产物可手动重新开始；已有合法快照优先保留',()=>{const f=setup();try{const cp=f.store.register(f.registration);save(join(f.registration.generationDir,'assets/shape/geometry.json'),{});let info=recoveryInfo(f.job,[],f.store,f.root);expect(info.completed).toBe(1);expect(info.source).toBe('checkpoint');rmSync(f.store.path(cp.id),{recursive:true});info=recoveryInfo(f.job,[],f.store,f.root);expect(info.completed).toBe(0);expect(info.missing).toBe(1);expect(info.issues.length).toBe(1);rmSync(join(f.root,'generation/layout.json'));expect(recoveryInfo(f.job,[],f.store,f.root)).toMatchObject({available:true,mode:'restart'});}finally{rmSync(f.root,{recursive:true,force:true})}});
test('完整运行证据直接继续评分；完整执行但质量未通过也能复评，运行中的源任务不能恢复',()=>{const f=setup();try{for(const stage of ['judge','spec','gate','complete'])expect(recoveryInfo({...f.job,status:'failed',stage,runtime:{},plan:{},structure:{}},[],f.store,f.root).mode).toBe('assessment');expect(recoveryInfo({...f.job,status:'running'},[],f.store,f.root).available).toBe(false);expect(recoveryInfo({...f.job,status:'passed',stage:'complete',runtime:{},plan:{},structure:{}},[],f.store,f.root).available).toBe(false);}finally{rmSync(f.root,{recursive:true,force:true})}});
test('无改善停止后已有完整分数不会被继续验收入口绕过，尚无分数的中断仍可恢复',async()=>{
 const f=setup(),id=improvement.enter({prompt:'停止入口回归 '+f.root,images:[]},'test-job');
 try{
  improvement.markStopped(id,'连续两轮无有效改善');
  const j={...f.job,status:'failed',stage:'gate',improvementId:id,runtime:{},plan:{},structure:{},quality:{score:85}};
  expect(recoveryInfo(j,[],f.store,f.root)).toMatchObject({available:false,mode:'diagnosis'});
  let creates=0;await expect(dispatchRecovery(j.id,{getJob:()=>j,listJobs:()=>[j],isExecuting:()=>false,inspect:(job)=>recoveryInfo(job,[],f.store,f.root),resolveSettings:async()=>({}),create:()=>{creates++;}})).rejects.toThrow('不能原样续跑');expect(creates).toBe(0);
  expect(recoveryInfo({...j,quality:undefined,stage:'judge'},[],f.store,f.root)).toMatchObject({available:true,mode:'assessment'});
 }finally{rmSync(improvement.path(id),{force:true});rmSync(f.root,{recursive:true,force:true});}
});
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

 test('已评分草稿继续缺失资产，未评分草稿先交付评分',()=>{const f=setup();try{const j={...f.job,status:'needs_review',stage:'assets',sceneProgram:{file:'generated-scene.json'},partialOutput:{missing:[{id:'shape'}]},quality:{score:60},runtime:{},structure:{},plan:read(f.registration.planFile)};const info=recoveryInfo(j,[],f.store,f.root);expect(info.mode).toBe('generation');expect(info.available).toBe(true);}finally{rmSync(f.root,{recursive:true,force:true})}});

test('再次中断的续接保留祖先完整场景与原始链路，不退回从头生成',()=>{const f=setup();try{
 const source={...f.job,id:'saved',status:'failed',stage:'runtime',executionRecoveryRoot:'root',sceneProgram:{file:'generated-scene.json'},plan:read(f.registration.planFile)};
 const current={...source,id:'interrupted',stage:'graybox',sceneProgram:null,recoverySourceJobId:source.id,reuseSceneFrom:source.id,refineScene:false};
 save(join(f.root,'generated-scene.json'),{program:{templates:[{id:'shape'}],instances:[{id:'one'}]},cameras:[{id:'view'}]});
 const info=recoveryInfo(current,[source,current],f.store,f.root,()=>f.root);
 expect(info).toMatchObject({available:true,mode:'scene',sceneSourceJobId:'saved'});
 const twice={...current,id:'twice',recoverySourceJobId:current.id};
 expect(continuationSceneSource(twice,[source,current,twice],()=>f.root)).toBe('saved');
 expect(recoveryInfo(current,[source,current,{id:'active',status:'queued',recoverySourceJobId:current.id}],f.store,f.root,()=>f.root).mode).toBe('active');
 for(const changed of [{executionRecoveryRoot:'other'},{prompt:'changed'},{policy:{score:50}},{recoverySourceJobId:'unrelated'},{profile:{...source.profile,engineSha:'different'}}]){
  expect(recoveryInfo({...current,...changed},[source],f.store,f.root,()=>f.root)).toMatchObject({available:false,mode:'invalid-continuation'});
 }
 rmSync(join(f.root,'generated-scene.json'));
 expect(recoveryInfo(current,[source],f.store,f.root,()=>f.root)).toMatchObject({available:false,mode:'invalid-continuation'});
 }finally{rmSync(f.root,{recursive:true,force:true})}});

test('待修正和部分场景不借祖先完整场景跳过尚未完成的工作',()=>{const f=setup();try{
 const j={...f.job,reuseSceneFrom:'saved',executionRecoveryRoot:'root',recoverySourceJobId:'saved'};
 expect(continuationSceneSource({...j,refineScene:true},[],()=>f.root)).toBe(null);
 expect(continuationSceneSource({...j,partialOutput:{missing:['asset']}},[],()=>f.root)).toBe(null);
 expect(recoveryInfo({...j,refineScene:true},[],f.store,f.root,()=>f.root).mode).toBe('refinement');
 expect(recoveryInfo({...j,partialOutput:{missing:['asset']}},[],f.store,f.root,()=>f.root).mode).toBe('generation');
 }finally{rmSync(f.root,{recursive:true,force:true})}});

function spatialContinuationFixture(){
 const seed:any={id:'11111111-1111-4111-8111-111111111111',prompt:'保留原图的贯通门洞、板桥空域及水道可见宽度',images:[{id:'a'.repeat(64)},{id:'b'.repeat(64)}],complexity:'complex',matchingLevel:'standard',sceneKind:'voxel',generationMode:'qualified',status:'failed',stage:'graybox',executionRecoveryRoot:'fixed-execution-root',improvementId:'d'.repeat(64),
  policy:{version:'scene-quality-v7',deliveryStandard:'basic70',score:80},modelSettings:{model:'gpt-6-astra',reasoningEffort:'xhigh'},profile:{engineSha:'fixed-engine',generatorSha:'fixed-generator',provider:'codex-cli',model:'gpt-6-astra',judgeModel:'gpt-6-astra',executionRoute:{providerId:'local',launcherSha256:'same-launcher'},assessmentProtocolSha256:'same-assessment'},
  blockout:{status:'stopped',rounds:[{round:0,passed:false,endedAt:100,review:{score:3.3}}]}};
 const current:any={...structuredClone(seed),id:'22222222-2222-4222-8222-222222222222',stage:'space',blockout:{status:'repairing',rounds:[]},spatialRepairSource:{jobId:seed.id,round:0},
  spatialDiagnosis:{contract:'graybox-space-repair-v8',sourceJobId:seed.id,sourceRound:0,reason:'新原生体素构造已实拍验证贯通门洞及板缝，恢复仅保留原输入、真实预览和累计修正记录，不降低验收标准。',revisionId:'c'.repeat(64)}};
 return {seed,current,all:[seed,current]};
}
test('已发布v4至v8灰模契约可保留同输入和执行根恢复，诊断返回克隆且未知版本不自动放行',()=>{
 for(const contract of ['graybox-space-repair-v4','graybox-space-repair-v5','graybox-space-repair-v6','graybox-space-repair-v7','graybox-space-repair-v8']){
  const f=spatialContinuationFixture();f.current.spatialDiagnosis.contract=contract;
  const before=JSON.stringify(f.all),options=spatialRecoveryOptions(f.current,f.all);
  expect(options).toEqual({spatialRepairSource:{jobId:f.seed.id,round:0},spatialDiagnosis:f.current.spatialDiagnosis,reusePlanFrom:f.seed.id,executionRecoveryRoot:'fixed-execution-root'});
  options!.spatialDiagnosis.reason='changed local result';expect(JSON.stringify(f.all)).toBe(before);
 }
 for(const contract of ['graybox-space-repair-v9','graybox-space-repair-v999','graybox-space-repair-v0','future-spatial-contract']){
  const f=spatialContinuationFixture();f.current.spatialDiagnosis.contract=contract;expect(()=>spatialRecoveryOptions(f.current,f.all)).toThrow('缺少匹配的来源与诊断');
 }
});
test('v8经过普通恢复派发保留局部诊断，不把已实拍补丁当作完整空间或新增检查点',async()=>{
 const disk=setup();try{
  const f=spatialContinuationFixture(),before=JSON.stringify(f.current);let creates=0,registrations=0;
  const info=recoveryInfo(f.current,f.all,disk.store,disk.root);expect(info).toMatchObject({available:true,mode:'spatial-repair'});
  const next=await dispatchRecovery(f.current.id,{getJob:id=>f.all.find(j=>j.id===id),listJobs:()=>f.all,isExecuting:()=>false,
   inspect:(job,all)=>recoveryInfo(job,all,disk.store,disk.root),resolveSettings:async job=>job.modelSettings,
   register:()=>{registrations++;return 'unexpected-checkpoint';},create:(job,recovery,settings,checkpoint)=>{creates++;expect(recovery.mode).toBe('spatial-repair');expect(checkpoint).toBeNull();return {...structuredClone(job),...spatialRecoveryOptions(job,f.all),id:'33333333-3333-4333-8333-333333333333',modelSettings:settings,recoverySourceJobId:job.id,status:'queued'};}});
  expect(creates).toBe(1);expect(registrations).toBe(0);expect(next.spatialDiagnosis.contract).toBe('graybox-space-repair-v8');expect(next.spatialRepairSource).toEqual(f.current.spatialRepairSource);expect(next.executionRecoveryRoot).toBe(f.current.executionRecoveryRoot);expect(next.modelSettings).toEqual(f.current.modelSettings);expect(next.policy).toEqual(f.current.policy);expect(JSON.stringify(f.current)).toBe(before);
  const twice={...structuredClone(next),status:'failed',spatialRepairSource:undefined,spatialDiagnosis:undefined};
  expect(spatialRecoveryOptions(twice,[...f.all,twice])?.spatialDiagnosis.contract).toBe('graybox-space-repair-v8');
 }finally{rmSync(disk.root,{recursive:true,force:true})}
});
test('v8的已知来源、原图顺序、模型、政策、评审或执行根改变均拒绝恢复',()=>{
 const mutations=[
  (f:any)=>f.seed.prompt+='改动目标',(f:any)=>f.seed.images.reverse(),(f:any)=>f.seed.sceneKind='scene',
  (f:any)=>f.seed.policy.deliveryStandard='weaker',(f:any)=>f.seed.modelSettings.model='different-model',
  (f:any)=>f.seed.executionRecoveryRoot='different-root',(f:any)=>f.seed.improvementId='e'.repeat(64),
  (f:any)=>f.seed.profile.engineSha='different-engine',(f:any)=>f.seed.profile.executionRoute.launcherSha256='changed-launcher',
  (f:any)=>f.seed.profile.assessmentProtocolSha256='different-assessment',(f:any)=>f.current.spatialDiagnosis.sourceJobId='unrelated-source',
 ];
 for(const mutate of mutations){const f=spatialContinuationFixture();mutate(f);expect(()=>spatialRecoveryOptions(f.current,f.all)).toThrow();}
});
