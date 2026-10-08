import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spatialRecoveryOptions,recoveryInfo,dispatchRecovery} from './recovery';

function fixture(){
 const folder=mkdtempSync(join(tmpdir(),'spatial-recovery-'));
 const shared={prompt:'同一温室输入',images:[{id:'a'.repeat(64)}],reuseMode:'fresh',generationMode:'qualified',complexity:'complex',matchingLevel:'standard',executionRecoveryRoot:'root',improvementId:'case',policy:{deliveryStandard:'basic70',score:80},modelSettings:{model:'fixed',reasoningEffort:'xhigh'},profile:{engineSha:'fixed-engine',provider:'codex6',model:'fixed',judgeModel:'fixed',executionRoute:{configurationSha256:'same'},assessmentProtocolSha256:'protocol'}};
 const seed={...shared,id:'seed',status:'failed',stage:'graybox',blockout:{status:'stopped',rounds:[{round:0,passed:false,endedAt:1,review:{score:3.2}}]}};
 const repair={...shared,id:'repair',status:'failed',stage:'space',spatialRepairSource:{jobId:'seed',round:0},spatialDiagnosis:{contract:'graybox-space-repair-v3',sourceJobId:'seed',sourceRound:0,revisionId:'b'.repeat(64),reason:'依据真实参考、独立失败评分与已验证新轮廓机制恢复尚未完成的局部空间修正；不变更输入、模型或验收门槛。'}};
 const lost={...shared,id:'lost',status:'failed',stage:'space',recoverySourceJobId:'repair',spatialRepairSource:null,spatialDiagnosis:null};
 return {folder,seed,repair,lost,all:[seed,repair,lost],close:()=>rmSync(folder,{recursive:true,force:true})};
}

test('局部空间恢复保留原始种子、诊断、执行根且不修改历史对象',()=>{
 const f=fixture();try{const before=JSON.stringify(f.all),options=spatialRecoveryOptions(f.repair,f.all)!;expect(options.spatialRepairSource).toEqual(f.repair.spatialRepairSource);expect(options.spatialDiagnosis).toEqual(f.repair.spatialDiagnosis);expect(options.executionRecoveryRoot).toBe('root');expect(options.reusePlanFrom).toBe('seed');options.spatialDiagnosis.reason+='修改副本';expect(JSON.stringify(f.all)).toBe(before);}finally{f.close();}
});
test('旧错误续接丢失类型时只沿真实恢复链找回，不把候选摘要当完整空间规划',()=>{
 const f=fixture();try{const options=spatialRecoveryOptions(f.lost,f.all)!;expect(options.spatialRepairSource).toEqual({jobId:'seed',round:0});expect(options.spatialDiagnosis.revisionId).toBe(f.repair.spatialDiagnosis.revisionId);expect(recoveryInfo(f.lost,f.all,undefined,f.folder,()=>f.folder)).toMatchObject({available:true,mode:'spatial-repair'});}finally{f.close();}
});
test('输入、政策、模型、执行根、种子轮次或评审路由不一致均在派发前拒绝',()=>{
 const f=fixture();try{
  for(const changed of [{prompt:'不同输入'},{policy:{deliveryStandard:'basic70',score:70}},{executionRecoveryRoot:'other'},{modelSettings:{model:'other'}},{profile:{...f.lost.profile,assessmentProtocolSha256:'other'}}])expect(recoveryInfo({...f.lost,...changed},f.all,undefined,f.folder,()=>f.folder)).toMatchObject({available:false,mode:'invalid-spatial-continuation'});
  for(const changed of [{spatialRepairSource:{jobId:'seed',round:9}},{spatialDiagnosis:{...f.repair.spatialDiagnosis,sourceRound:1}},{spatialDiagnosis:null}])expect(()=>spatialRecoveryOptions({...f.repair,...changed},f.all)).toThrow();
 }finally{f.close();}
});
test('重复恢复共用派发保护且不重建新策略或重置累计账本',async()=>{
 const f=fixture();try{let creates=0;const all:any[]=[...f.all],deps={getJob:(id:string)=>all.find(j=>j.id===id),listJobs:()=>all,isExecuting:()=>false,inspect:(job:any,jobs:any[])=>recoveryInfo(job,jobs,undefined,f.folder,()=>f.folder),resolveSettings:async(source:any)=>source.modelSettings,create:(source:any,info:any,settings:any)=>{creates++;expect(info.mode).toBe('spatial-repair');const next={...source,...spatialRecoveryOptions(source,all),id:'resumed',status:'queued',recoverySourceJobId:source.id,modelSettings:settings};all.push(next);return next;}};
  const [a,b]=await Promise.all([dispatchRecovery(f.lost.id,deps),dispatchRecovery(f.lost.id,deps)]);expect(a.id).toBe(b.id);expect(creates).toBe(1);expect(a.spatialDiagnosis.revisionId).toBe(f.repair.spatialDiagnosis.revisionId);expect(a.improvementId).toBe('case');expect(a.executionRecoveryRoot).toBe('root');expect((await dispatchRecovery(f.lost.id,deps)).id).toBe(a.id);expect(creates).toBe(1);
 }finally{f.close();}
});
test('已进入详细资产或完整成品的恢复仍采用既有恢复模式，活动任务不得重复开始',()=>{
 const f=fixture();try{expect(recoveryInfo({...f.repair,stage:'judge',runtime:{},plan:{},structure:{},sceneProgram:{}},f.all,undefined,f.folder,()=>f.folder).mode).toBe('assessment');expect(recoveryInfo({...f.repair,status:'running'},f.all,undefined,f.folder,()=>f.folder).available).toBe(false);expect(spatialRecoveryOptions({...f.lost,recoverySourceJobId:null},f.all)).toBeNull();}finally{f.close();}
});
