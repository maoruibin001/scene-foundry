import {test,expect} from 'bun:test';
import {canRecoverGrayboxPreview} from './graybox-timeout-checkpoint';

function fixture(){
 const id='dd15f78b-6bd2-4eea-9443-fbb397d76ca4',basis={jobId:'743788c3-db6e-4a1a-ae66-5f0571d09fc5',round:0},start=1791529140512,error='Error: PROVIDER_RECOVERY_EXHAUSTED：当前逻辑调用及排队已达恢复总时长上限';
 const source:any={id,status:'blocked',cancelRequestedAt:null,cancelledAt:null,error,executionRecoveryRoot:'d93f3877-5961-4cf5-85dd-a31583670e4f',reuseMode:'fresh',prompt:'用同一原图恢复体素场景',images:[{id:'image-one'}],modelSettings:{model:'same-model',reasoningEffort:'xhigh'},policy:{version:'scene-quality-v7',score:80},sceneKind:'voxel',baselineId:'baseline',complexity:'complex',matchingLevel:'standard',profile:{engineSha:'e'.repeat(40),generatorSha:'g'.repeat(40),assessmentProtocolSha256:'a'.repeat(64),executionRoute:{providerId:'local',launcherSha256:'l'.repeat(64),configurationSha256:'c'.repeat(64)}},spatialRepairSource:basis,spatialDiagnosis:{contract:'graybox-space-repair-v8',revisionId:'r'.repeat(64),sourceJobId:basis.jobId,sourceRound:basis.round},stages:{space:{status:'failed',error}}};
 const target={...structuredClone(source),id:'11111111-1111-4111-8111-111111111111',status:'queued',recoverySourceJobId:id};
 const execution={status:'cancelled',startedAt:'2026-10-09T06:59:00.527Z',endedAt:'2026-10-09T07:14:00.540Z',deadlineAt:'2026-10-09T07:14:00.526Z',timeoutMs:899999,maxTimeoutMs:899999,durationMs:900013};
 const recovery={version:'provider-recovery-v1',role:'scene-space',status:'blocked',abortCause:'parent',reason:'父步骤中断：'+error,policy:{maxElapsedMs:900000},cycle:1,startedAt:start,endedAt:start+900033,attempts:[{index:1,cycle:1,status:'blocked',fault:'exhausted',abortCause:'parent',error,startedAt:start+1,endedAt:start+900030,durationMs:900029}]};
 return {target,source,expectedBasis:basis,sourceFolder:'/owned/data/runs/'+id+'/generation/space-repair-0',execution,recovery};
}
test('实际899999ms CLI期限与900000ms恢复期限均到期，允许后续独立验证真实预览',()=>{
 const f=fixture();expect(canRecoverGrayboxPreview(f)).toBe(true);f.sourceFolder='generation/space-repair-0';expect(canRecoverGrayboxPreview(f)).toBe(true);f.source.stages.space.status='blocked';expect(canRecoverGrayboxPreview(f)).toBe(true);
});
test('原输入、执行根、路由、标准、模型或空间来源变化均拒绝',()=>{
 const changes=[(f:any)=>f.target.recoverySourceJobId='other',(f:any)=>f.target.executionRecoveryRoot='other',(f:any)=>f.target.reuseMode='refine',(f:any)=>f.target.prompt='changed',(f:any)=>f.target.images[0].id='other',(f:any)=>f.target.images.push({id:'other'}),(f:any)=>f.target.modelSettings.model='other',(f:any)=>f.target.modelSettings.reasoningEffort='low',(f:any)=>f.target.policy.score=70,(f:any)=>f.target.profile.engineSha='other',(f:any)=>f.target.profile.generatorSha='other',(f:any)=>f.target.profile.assessmentProtocolSha256='other',(f:any)=>f.target.profile.executionRoute.configurationSha256='other',(f:any)=>f.target.executionRoute={providerId:'other'},(f:any)=>f.target.assessmentProtocol={version:'other'},(f:any)=>f.target.sceneKind='ordinary',(f:any)=>f.target.spatialRepairSource.round=1,(f:any)=>f.expectedBasis.round=1,(f:any)=>f.target.spatialDiagnosis.revisionId='other',(f:any)=>f.source.spatialDiagnosis.contract='graybox-space-repair-v7',(f:any)=>f.target.spatialDiagnosis.sourceJobId='other',(f:any)=>f.source.stages.space.status='passed'];
 for(const change of changes){const f=fixture();change(f);expect(canRecoverGrayboxPreview(f)).toBe(false);}
});
test('对象键顺序不会制造身份变化，但缺失契约不会被当作相同',()=>{
 const f=fixture();f.target.modelSettings={reasoningEffort:'xhigh',model:'same-model'};expect(canRecoverGrayboxPreview(f)).toBe(true);
 for(const key of ['engineSha','generatorSha','assessmentProtocolSha256','executionRoute']){const f=fixture();delete f.source.profile[key];delete f.target.profile[key];expect(canRecoverGrayboxPreview(f)).toBe(false);}
 const empty=fixture();empty.source.images=[];empty.target.images=[];expect(canRecoverGrayboxPreview(empty)).toBe(false);
});
test('未真正到达期限、伪造时长或旧恢复周期记录不能触发恢复',()=>{
 const changes=[(f:any)=>f.execution.status='failed',(f:any)=>f.execution.durationMs=899998,(f:any)=>f.execution.endedAt='2026-10-09T07:13:59.999Z',(f:any)=>f.execution.deadlineAt='2026-10-09T07:15:00.000Z',(f:any)=>f.execution.deadlineAt=null,(f:any)=>f.execution.startedAt='not-a-date',(f:any)=>f.execution.timeoutMs=NaN,(f:any)=>f.execution.maxTimeoutMs=800000,(f:any)=>f.recovery.attempts[0].durationMs=899999,(f:any)=>f.recovery.endedAt=f.recovery.startedAt+899999,(f:any)=>f.recovery.attempts[0].endedAt=f.recovery.attempts[0].startedAt+899999,(f:any)=>f.recovery.attempts[0].cycle=0,(f:any)=>f.recovery.status='exhausted',(f:any)=>f.recovery.abortCause='deadline',(f:any)=>f.recovery.attempts[0].fault='timeout',(f:any)=>f.recovery.attempts[0].abortCause='deadline',(f:any)=>f.recovery.attempts=[],(f:any)=>f.source.error='Error: PROVIDER_TIMEOUT'];
 for(const change of changes){const f=fixture();change(f);expect(canRecoverGrayboxPreview(f)).toBe(false);}
});
test('供应商认证、余额、调用预算、存储错误及真实用户取消优先拒绝',()=>{
 const errors=['PROVIDER_HTTP_401','HTTP 402 Payment Required','status: 403','UserBudgetExhausted','insufficient_budget','quota_exhausted','MODEL_BUDGET_EXHAUSTED','IMPROVEMENT_STOPPED','authentication failed','invalid_api_key','ENOSPC: disk full','EACCES: permission denied','storage failure','USER_CANCELLED','CANCELLED','AbortError: user cancelled'];
 for(const error of errors){const f=fixture();f.recovery.attempts[0].error+='; '+error;expect(canRecoverGrayboxPreview(f)).toBe(false);}
 const changes=[(f:any)=>f.source.status='cancelled',(f:any)=>f.source.cancelRequestedAt=1,(f:any)=>f.source.cancelledAt=1,(f:any)=>f.target.cancelRequested=true,(f:any)=>f.recovery.abortCause='user',(f:any)=>f.recovery.attempts[0].abortCause='user',(f:any)=>f.recovery.attempts[0].status='cancelled',(f:any)=>f.source.executionFault='MODEL_BUDGET_EXHAUSTED'];
 for(const change of changes){const f=fixture();change(f);expect(canRecoverGrayboxPreview(f)).toBe(false);}
});
test('恢复目录必须是该来源的直接space-repair-0路径，不能访问其他轮或跨任务',()=>{
 const later=fixture();later.source.blockout={currentRound:1};expect(canRecoverGrayboxPreview(later)).toBe(false);
 const initial=fixture();initial.source.blockout={currentRound:0};expect(canRecoverGrayboxPreview(initial)).toBe(true);
 for(const folder of ['space-repair-0','generation/space-repair-1','/owned/data/runs/11111111-1111-4111-8111-111111111111/generation/space-repair-0','/owned/data/runs/dd15f78b-6bd2-4eea-9443-fbb397d76ca4/generation/../generation/space-repair-0','/owned/data/runs/dd15f78b-6bd2-4eea-9443-fbb397d76ca4/generation/space-repair-0/preview','generation\\space-repair-0','/owned/%2e%2e/data/runs/dd15f78b-6bd2-4eea-9443-fbb397d76ca4/generation/space-repair-0']){const f=fixture();f.sourceFolder=folder;expect(canRecoverGrayboxPreview(f)).toBe(false);}
});
test('异常或非JSON参数返回false，不抛出或执行操作',()=>{
 for(const f of [null,{}, {source:null}] as any[])expect(canRecoverGrayboxPreview(f)).toBe(false);
 const cyclic=fixture();cyclic.target.policy.self=cyclic.target.policy;expect(canRecoverGrayboxPreview(cyclic)).toBe(false);
});
