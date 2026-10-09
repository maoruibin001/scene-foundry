import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ImprovementLedger} from './improvement-governance';
import {spatialRepairBasis,resumeDiagnosedSpatialRepair,activeSpatialRepair} from './spatial-diagnosis';
import {spatialDiagnosisHTML} from '../public/spatial-diagnosis-ui.js';
import {jobOriginHTML} from '../public/delivery-ui.js';
import {spatialProgress} from '../public/spatial-status.js';
import {productionTimeline} from './production-timing';
const reason='原路径已两轮无改善，实际画面显示步道与植物冠体间空隙。已零模型核对编译几何编号图、实际机位和哈希，新版本仅接入真实几何定位与受限空间补丁，保留需求和评分口径再独立验收。';
function fixture(){const root=mkdtempSync(join(tmpdir(),'spatial-diagnosis-')),ledger=new ImprovementLedger(root),id=ledger.enter({prompt:'参考图还原',generationMode:'qualified'},'old');ledger.call(id,'scene-space');for(let i=0;i<3;i++)ledger.result(id,{kind:'space',comparison:'spatial-composition-v3',score:60,status:'failed',jobId:'old'});return {ledger,source:{id:'old',executionRecoveryRoot:'original',improvementId:id,generationMode:'qualified',status:'failed',blockout:{status:'stopped',rounds:[{round:0,passed:false,review:{score:3},endedAt:10}]},pipelineVersion:{id:'old'},profile:{assessmentProtocolSha256:'protocol'}},close:()=>rmSync(root,{recursive:true,force:true})};}
test('有证据新版本继续同账本，不改评分历史或增加调用额度；原最佳仍用于比较',()=>{
 const f=fixture();try{const before=f.ledger.get(f.source.improvementId);resumeDiagnosedSpatialRepair(f.ledger,f.source,0,reason,{id:'new'},'protocol');const now=f.ledger.get(f.source.improvementId);
 expect(now.calls).toBe(before.calls);expect(now.repairs).toBe(before.repairs);expect(now.results).toEqual(before.results);expect(now.limits).toEqual(before.limits);
 expect(()=>resumeDiagnosedSpatialRepair(f.ledger,f.source,0,reason+'再试',{id:'new'},'protocol')).toThrow('已经尝试');
 const first=f.ledger.result(f.source.improvementId,{kind:'space',comparison:'spatial-composition-v3',score:59,status:'failed',jobId:'new'});expect(first.stopped).toBeUndefined();expect(first.noGain).toBe(1);expect(first.progress.previousBest).toBe(60);
 const stopped=f.ledger.result(f.source.improvementId,{kind:'space',comparison:'spatial-composition-v3',score:59,status:'failed',jobId:'new-round2'});expect(stopped.stopped).toBeTruthy();expect(stopped.noGain).toBe(2);expect(stopped.progress.previousBest).toBe(60);
 }finally{f.close();}
});

test('有界历史实验的新机制只能显式追加1至2次修复，不重置调用或结果且同版本不可重复追加',()=>{
 const f=fixture();try{
  const id=f.source.improvementId,v=f.ledger.get(id);v.limits={...v.limits,repairs:6,calls:100};v.repairs=6;v.calls=26;
  // Historical finite limits are fixture inputs, not a grant made by the continuation.
  writeFileSync(f.ledger.path(id),JSON.stringify(v));
  f.ledger.markStopped(id,'累计修复 6/6 次，已达到上限；手动续跑沿用累计次数');
  const before=f.ledger.get(id);
  for(const extra of [undefined,0,3,-1,1.5])expect(()=>resumeDiagnosedSpatialRepair(f.ledger,f.source,0,reason,{id:'new'},'protocol',{additionalRepairs:extra})).toThrow('累计预算');
  expect(spatialDiagnosisHTML({...f.source,improvement:before},{id:'new'})).not.toContain('id="spatial-refine"');
  const html=spatialDiagnosisHTML({...f.source,improvement:before},{id:'new'},{allowFiniteRevisions:true});expect(html).toContain('最多追加 2 次修复');
  const diagnosis=resumeDiagnosedSpatialRepair(f.ledger,f.source,0,reason,{id:'new'},'protocol',{additionalRepairs:2}),after=f.ledger.get(id);
  expect(after.calls).toBe(26);expect(after.repairs).toBe(6);expect(after.limits).toEqual({...before.limits,repairs:8});expect(after.results).toEqual(before.results);
  expect(()=>resumeDiagnosedSpatialRepair(f.ledger,f.source,0,reason+'换说明',{id:'new'},'protocol',{additionalRepairs:2})).toThrow('已经尝试');
  f.ledger.reserveStrategyRepair(id,'diagnosed-graybox-repair',reason,diagnosis.revisionId);f.ledger.reserveStrategyRepair(id,'diagnosed-graybox-repair',reason,diagnosis.revisionId);
  expect(f.ledger.get(id).repairs).toBe(7);
 }finally{f.close();}
});

test('有界新机制不能追加调用预算、绕过外部阻塞或在未停止时反复授予修复',()=>{
 for(const stopped of ['AUTHENTICATION_FAILED','累计模型调用已达上限，需诊断机制与基础条件',null]){
  const f=fixture();try{const id=f.source.improvementId,v=f.ledger.get(id);v.limits={...v.limits,repairs:2,calls:100};v.stopped=stopped;writeFileSync(f.ledger.path(id),JSON.stringify(v));
   expect(()=>resumeDiagnosedSpatialRepair(f.ledger,f.source,0,reason,{id:'new'},'protocol',{additionalRepairs:1})).toThrow('外部阻塞');
  }finally{f.close();}
 }
 const f=fixture();try{const id=f.source.improvementId,v=f.ledger.get(id);v.limits={...v.limits,repairs:2,calls:100};v.calls=97;writeFileSync(f.ledger.path(id),JSON.stringify(v));
  expect(()=>resumeDiagnosedSpatialRepair(f.ledger,f.source,0,reason,{id:'new'},'protocol',{additionalRepairs:2})).toThrow('累计调用预算不足');
 }finally{f.close();}
});
test('运行中、完整场景、未评估轮次、旧版本、改评分协议或外部阻塞均拒绝',()=>{
 const f=fixture();try{
 for(const source of [{...f.source,status:'running'},{...f.source,sceneProgram:{}},{...f.source,blockout:{status:'failed'}}])expect(()=>spatialRepairBasis(source,0)).toThrow();
 expect(()=>spatialRepairBasis(f.source,1)).toThrow('完整评估');expect(()=>resumeDiagnosedSpatialRepair(f.ledger,f.source,0,reason,{id:'old'},'protocol')).toThrow('原样重跑');
 expect(()=>resumeDiagnosedSpatialRepair(f.ledger,f.source,0,reason,{id:'new'},'different')).toThrow('评分协议');expect(()=>resumeDiagnosedSpatialRepair(f.ledger,f.source,0,'再试',{id:'new'},'protocol')).toThrow('失败证据');
 f.ledger.markStopped(f.source.improvementId,'AUTHENTICATION_FAILED');expect(()=>resumeDiagnosedSpatialRepair(f.ledger,f.source,0,reason,{id:'new'},'protocol')).toThrow('外部阻塞');
 }finally{f.close();}
});
test('同实验已经排队或运行时返回现任务，不重复创建',()=>{
 const f=fixture();try{const j={id:'child',improvementId:f.source.improvementId,status:'queued'};expect(activeSpatialRepair(f.source,[j])).toBe(j);expect(activeSpatialRepair(f.source,[{...j,status:'failed'}])).toBeUndefined();}finally{f.close();}
});
test('正常UI选最高灰模且同分最早；未通过来源不改标合格或新样本',()=>{
 const f=fixture();try{const j={...f.source,improvement:f.ledger.get(f.source.improvementId)};j.blockout.rounds.push({round:1,passed:false,review:{score:3},endedAt:20});const html=spatialDiagnosisHTML(j,{id:'new'});
 expect(html).toContain('value="0" selected');expect(html).toContain('未通过');expect(html).toContain('不改标成品最佳或合格');expect(spatialDiagnosisHTML(j,{id:'old'})).not.toContain('id="spatial-refine"');
 const child={spatialRepairSource:{jobId:'old',round:0},spatialDiagnosis:{reason}};expect(jobOriginHTML(child)).toContain('空间质量修正');expect(jobOriginHTML(child)).not.toContain('完全从头生成');expect(spatialDiagnosisHTML(child,{id:'new'})).toContain('不是新独立样本或执行恢复');
 }finally{f.close();}
});

test('首次诊断补丁仍在途时显示修正中，不伪装成灰模已失败',()=>{
 const job={status:'running',stage:'space',spatialDiagnosis:{reason},blockout:{status:'repairing',rounds:[]},stages:{space:{status:'running',startedAt:10}}};
 expect(spatialProgress(job)).toMatchObject({status:'repairing',round:1,label:'正在自动修正空间'});
});

test('诊断子任务停止后保留来源说明并提供新冻结机制入口，原版本和活跃状态仍禁重跑',()=>{
 const f=fixture();try{
  const child={...f.source,spatialRepairSource:{jobId:'prior',round:2},spatialDiagnosis:{reason},improvement:f.ledger.get(f.source.improvementId)};
  const html=spatialDiagnosisHTML(child,{id:'new'});
  expect(html).toContain('来源第 3 轮灰模');expect(html).toContain('不是新独立样本或执行恢复');
  expect(html).toContain('id="spatial-refine"');expect(html).toContain('value="0" selected');
  expect(spatialDiagnosisHTML(child,{id:'old'})).not.toContain('id="spatial-refine"');
  for(const change of [{status:'running'},{status:'queued'},{status:'passed'},{sceneProgram:{}},{blockout:{status:'stopped',rounds:[]}},{improvement:{stopped:'AUTHENTICATION_FAILED'}}]){
   const denied=spatialDiagnosisHTML({...child,...change},{id:'new'});expect(denied).toContain('来源第 3 轮灰模');expect(denied).not.toContain('id="spatial-refine"');
  }
 }finally{f.close();}
});

test('空间质量续接沿明确来源累计原始总历时，不能算技术恢复或新输入',()=>{
 const root={id:'original',prompt:'same',images:[{id:'ref'}],createdAt:100,startedAt:110,endedAt:210,status:'failed'},source={...root,id:'source',createdAt:400,startedAt:410,endedAt:510,retryRoot:'original'},child={...root,id:'child',createdAt:900,startedAt:910,endedAt:1010,spatialRepairSource:{jobId:'source',round:2},policy:{deliveryStandard:'basic70'}};
 const result=productionTimeline(child,[root,source,child],[],1100);expect(result.startedAt).toBe(100);expect(result.totalMs).toBe(910);expect(result.executionRecoveries).toBe(0);expect(result.runs.at(-1).kind).toBe('空间质量修正');expect(result.successAt).toBeNull();
});
