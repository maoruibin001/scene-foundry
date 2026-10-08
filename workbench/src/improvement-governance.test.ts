import {test,expect} from 'bun:test';
import {scoreProgress,ImprovementLedger,strategyResultBoundary} from './improvement-governance';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('诊断首补丁在技术续接中只预留一次，调用和历史无改善不归零',()=>{
 const root=mkdtempSync(join(tmpdir(),'strategy-reservation-'));try{
  const ledger=new ImprovementLedger(root),id=ledger.enter({prompt:'首補丁',images:[],generationMode:'qualified'},'source');ledger.reviseStrategy(id,{id:'revision',reason:'原假设',pipelineVersion:{id:'frozen'},additionalRepairs:0});
  expect(ledger.reserveStrategyRepair(id,'graybox-diagnosis','原假设','revision').reused).toBe(false);ledger.call(id,'scene-space');const before=JSON.stringify(ledger.get(id));expect(ledger.reserveStrategyRepair(id,'graybox-diagnosis','原假设','revision').reused).toBe(true);expect(JSON.stringify(ledger.get(id))).toBe(before);
  ledger.reserveRepair(id,'graybox','下一独立候选有新实际差距');expect(ledger.get(id).repairs).toBe(2);expect(ledger.get(id).calls).toBe(1);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('旧版本已预留记录按机制边界复用，不重写历史；机制前同名动作不能冒充本轮',()=>{
 const root=mkdtempSync(join(tmpdir(),'legacy-reservation-'));try{
  const ledger=new ImprovementLedger(root),id=ledger.enter({prompt:'旧动作',images:[],generationMode:'qualified'},'source');ledger.reserveRepair(id,'graybox-diagnosis','相同文字');ledger.reviseStrategy(id,{id:'new',reason:'相同文字',pipelineVersion:{id:'frozen'},additionalRepairs:0});
  expect(ledger.reserveStrategyRepair(id,'graybox-diagnosis','相同文字','new').reused).toBe(false);expect(ledger.get(id).repairs).toBe(2);
  const value=ledger.get(id);delete value.actions.at(-1).reservationKey;writeFileSync(ledger.path(id),JSON.stringify(value));const before=JSON.stringify(ledger.get(id));expect(ledger.reserveStrategyRepair(id,'graybox-diagnosis','相同文字','new').reused).toBe(true);expect(JSON.stringify(ledger.get(id))).toBe(before);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('重复预留也不能绕过已停止、累计调用耗尽或当前机制原假设约束',()=>{
 const root=mkdtempSync(join(tmpdir(),'reservation-stop-'));try{
  const ledger=new ImprovementLedger(root),id=ledger.enter({prompt:'阻断',images:[],generationMode:'qualified'},'source');ledger.reviseStrategy(id,{id:'revision',reason:'原假设',pipelineVersion:{id:'frozen'},additionalRepairs:0});ledger.reserveStrategyRepair(id,'graybox-diagnosis','原假设','revision');
  expect(()=>ledger.reserveStrategyRepair(id,'graybox-diagnosis','换提示词','revision')).toThrow('IMPROVEMENT_STOPPED');expect(()=>ledger.reserveStrategyRepair(id,'graybox-diagnosis','原假设','other')).toThrow('IMPROVEMENT_STOPPED');
  const limited=ledger.get(id);limited.limits.calls=1;limited.calls=1;writeFileSync(ledger.path(id),JSON.stringify(limited));expect(()=>ledger.reserveStrategyRepair(id,'graybox-diagnosis','原假设','revision')).toThrow('IMPROVEMENT_STOPPED');
  ledger.markStopped(id,'连续两轮无改善');expect(()=>ledger.reserveStrategyRepair(id,'graybox-diagnosis','原假设','revision')).toThrow('IMPROVEMENT_STOPPED');
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('修复额度耗尽后允许只读复评，保留停止原因且仍执行累计模型调用上限',()=>{
 const root=mkdtempSync(join(tmpdir(),'assessment-budget-'));
 try {
  const ledger=new ImprovementLedger(root),input={prompt:'测试场景',images:[]};
  const id=ledger.enter(input,'source');
  const exhausted={...ledger.get(id),limits:{repairs:2,calls:3,noGain:2,minGain:2},repairs:2,calls:2};
  writeFileSync(ledger.path(id),JSON.stringify(exhausted));
  ledger.markStopped(id,'修复额度已耗尽');
  expect(()=>ledger.enter(input,'regenerate',[],{improvementId:id})).toThrow('IMPROVEMENT_STOPPED');
  expect(()=>ledger.reserveRepair(id,'修复','调整机位')).toThrow('IMPROVEMENT_STOPPED');
  expect(()=>ledger.call(id,'generator')).toThrow('IMPROVEMENT_STOPPED');
  expect(ledger.enter(input,'assessment',[],{improvementId:id},'assessment')).toBe(id);
  expect(ledger.get(id).repairs).toBe(2);
  expect(ledger.get(id).stopped).toBe('修复额度已耗尽');
  ledger.call(id,'judge',true);
  expect(ledger.get(id).calls).toBe(3);
  expect(ledger.get(id).repairs).toBe(2);
  expect(ledger.get(id).stopped).toBe('修复额度已耗尽');
  expect(()=>ledger.call(id,'judge',true)).toThrow('累计模型调用已达上限');
  expect(()=>ledger.enter(input,'extra-assessment',[],{improvementId:id},'assessment')).toThrow('累计模型调用已达上限');
  expect(ledger.get(id).calls).toBe(3);
 } finally {rmSync(root,{recursive:true,force:true});}
});

 test('已要求诊断的数字上涨仍保留最高观测，但不能清除连续未有效进步次数',()=>{const a={kind:'repair',comparison:'same',score:60,jobId:'a'},b={kind:'repair',comparison:'same',score:63,jobId:'b',requiresDiagnosis:true};const p=scoreProgress([a],b,2);expect(p.bestScore).toBe(63);expect(p.improved).toBe(true);expect(p.noGain).toBe(1);});

test('新机制只重新累计停止轮次，历史最佳、调用、修正和旧结果全部保留',()=>{
 const root=mkdtempSync(join(tmpdir(),'mechanism-boundary-'));try{
  const ledger=new ImprovementLedger(root),id=ledger.enter({prompt:'边界回归',generationMode:'qualified'},'source');ledger.call(id,'scene-space');ledger.reserveRepair(id,'space','有证据的几何修正');
  for(const score of [64,62,62])ledger.result(id,{kind:'space',comparison:'spatial',score,status:'failed'});const before=ledger.get(id);
  ledger.reviseStrategy(id,{id:'validated-mechanism',reason:'已经验证新的可见区域残差反馈，不是改写提示词',pipelineVersion:{id:'new'},additionalRepairs:0});const revised=ledger.get(id);
  expect(revised.results).toEqual(before.results);expect(revised.calls).toBe(before.calls);expect(revised.repairs).toBe(before.repairs);expect(revised.limits).toEqual(before.limits);expect(strategyResultBoundary(revised)).toBe(3);
  const first=ledger.result(id,{kind:'space',comparison:'spatial',score:63,status:'failed'});expect(first.noGain).toBe(1);expect(first.stopped).toBeUndefined();expect(first.progress.previousBest).toBe(64);
  const repeated=ledger.reviseStrategy(id,{id:'validated-mechanism',reason:'只改说明不能额外获得轮次',pipelineVersion:{id:'new'},additionalRepairs:0});expect(repeated.noGain).toBe(1);
  const second=ledger.result(id,{kind:'space',comparison:'spatial',score:63.5,status:'failed'});expect(second.noGain).toBe(2);expect(second.stopped).toBeTruthy();expect(second.results.slice(0,3)).toEqual(before.results);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('新机制继续对历史最佳比较，真实足量进步清除本机制连续未进步数',()=>{
 const old=[{kind:'space',comparison:'same',score:64},{kind:'space',comparison:'same',score:62},{kind:'space',comparison:'same',score:62}];
 const p=scoreProgress(old,{kind:'space',comparison:'same',score:66},2,3);expect(p.previousBest).toBe(64);expect(p.noGain).toBe(0);expect(p.bestScore).toBe(66);
 expect(scoreProgress([...old,{kind:'space',comparison:'same',score:63}],{kind:'space',comparison:'same',score:64.5},2,3).noGain).toBe(2);
});
test('结果边界不混入其他协议、成品或草稿记录；非法边界拒绝，旧记录默认原口径',()=>{
 const old=[{kind:'space',comparison:'space',score:64},{kind:'space',comparison:'space',score:62},{kind:'repair',comparison:'scene-quality-x',score:99,assessmentScope:'partial'},{kind:'space',comparison:'other',score:99}];
 expect(scoreProgress(old,{kind:'space',comparison:'space',score:63},2,2).noGain).toBe(1);expect(scoreProgress(old,{kind:'space',comparison:'space',score:63},2).noGain).toBe(2);
 expect(()=>scoreProgress(old,{kind:'space',comparison:'space',score:63},2,5)).toThrow('边界');expect(strategyResultBoundary({results:old,strategyRevisions:[{id:'legacy'}]})).toBe(0);
});
test('新策略仍不能绕过累计调用预算',()=>{
 const root=mkdtempSync(join(tmpdir(),'mechanism-budget-'));try{const ledger=new ImprovementLedger(root),id=ledger.enter({prompt:'预算'},'s'),v=ledger.get(id);v.calls=v.limits.calls;writeFileSync(ledger.path(id),JSON.stringify(v));expect(()=>ledger.reviseStrategy(id,{id:'new',reason:'有机制但没有额度',pipelineVersion:{id:'n'},additionalRepairs:2})).toThrow('调用已达上限');expect(ledger.get(id).calls).toBe(v.calls);}finally{rmSync(root,{recursive:true,force:true});}
});
