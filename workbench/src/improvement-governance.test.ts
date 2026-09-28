import {test,expect} from 'bun:test';
import {scoreProgress,ImprovementLedger} from './improvement-governance';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

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
