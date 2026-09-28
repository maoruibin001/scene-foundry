import {test,expect} from 'bun:test';
import {repairOutcome} from './repair-outcome';
import {saveRepairOutcome} from './repair-outcome';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {digest} from '../store';
const input=()=>({jobId:'after',sourceJobId:'before',comparable:true,budget:{templates:6,parts:96,removeParts:96},
 before:{score:56.2,dimensions:[{id:'coverage',score:2.5,points:14},{id:'material',score:2,points:8}]},
 after:{score:57,dimensions:[{id:'coverage',score:2.5,points:14},{id:'material',score:2.2,points:8.8}],hardFailures:[]},
 reviewBefore:{dimensions:[{id:'coverage',score:3}],requirements:[{id:'R1',verdict:'partial',reason:'缺少薄布形态'}]},
 reviewAfter:{dimensions:[{id:'coverage',score:3.5}],requirements:[{id:'R1',verdict:'partial',reason:'薄布改善，织物质感仍不足',frames:['reference-1.png']}]},
 goals:{goals:[{id:'G1',requirementIds:['R1'],templateIds:['table']}],deferred:[]},
 patch:{parts:[],surfaceUpdates:[{}],removeParts:[],materials:[{}],lighting:null}});
test('partial内部改善保留原始与派生分，低收益须诊断且不改评分',()=>{
 const i=input(),snapshot=JSON.stringify(i),r=repairOutcome(i);
 expect(r.comparison.delta).toBe(.8);expect(r.requiresDiagnosis).toBe(true);
 expect(r.signals.map(s=>s.kind)).toContain('coverage_quantization');
 expect(r.dimensions[0]).toMatchObject({before:2.5,after:2.5,rawBefore:3,rawAfter:3.5,pointDelta:0});
 expect(r.requirements[0].reasonAfter).toContain('薄布改善');expect(JSON.stringify(i)).toBe(snapshot);
});
test('不足2分和退步不能用修改量或完成的模型调用冒充有效提升',()=>{
 const i=input();i.after.score=55;i.patch.parts=Array(96).fill({});i.patch.surfaceUpdates=[];
 const r=repairOutcome(i);expect(r.scoreSignal).toBe('regression');expect(r.requiresDiagnosis).toBe(true);
 expect(r.signals.map(s=>s.kind)).toContain('edit_limit_reached');
 expect(r.signals.map(s=>s.kind)).toContain('selected_requirements_unresolved');
});
test('并行每批96上限不误判合计超过96',()=>{
 const i:any=input();i.patch={batches:[{parts:Array(60).fill({}),lighting:null},{parts:Array(50).fill({}),lighting:null}]};
 const r=repairOutcome(i);expect(r.editUse.map(e=>e.parts)).toEqual([60,50]);expect(r.signals.map(s=>s.kind)).not.toContain('edit_limit_reached');
});
test('不同评审契约禁止计算分差',()=>{
 const i=input();i.comparable=false;i.after.score=90;const r=repairOutcome(i);
 expect(r.comparison.delta).toBe(null);expect(r.scoreSignal).toBe('not_comparable');expect(r.requiresDiagnosis).toBe(true);
 expect(r.dimensions.every(d=>d.pointDelta===null)).toBe(true);
});
test('达到2分但选定需求全部未完成时仍必须复盘',()=>{
 const i=input();i.after.score=58.2;const r=repairOutcome(i);
 expect(r.scoreSignal).toBe('effective_gain');expect(r.requiresDiagnosis).toBe(true);
 expect(r.visualImprovement).toContain('不单独证明');expect(r.signals.map(s=>s.kind)).toContain('selected_requirements_unresolved');
});
test('缺少前轮需求不捏造未变化，真实运行失败单列',()=>{
 const i:any=input();i.reviewBefore.requirements=[];i.after.hardFailures=['runtime'];const r=repairOutcome(i);
 expect(r.requirements[0].before).toBe('unrecorded');expect(r.signals.map(s=>s.kind)).not.toContain('coverage_quantization');
 expect(r.signals.map(s=>s.kind)).toContain('runtime_failure');
});
test('逐轮保存选择本轮修复来源，校验实际场景回执，旧评分不变',()=>{
 const root=mkdtempSync(join(tmpdir(),'round-audit-')),old=join(root,'before'),now=join(root,'after');
 const put=(path:string,value:any)=>{mkdirSync(join(path,'..'),{recursive:true});writeFileSync(path,JSON.stringify(value));};
 try{
  const i=input(),profile={assessmentProtocolSha256:'fixed',policy:{version:'frozen'}};
  const source={geometry:'before'},scene={geometry:'after'},sourceDigest=digest(JSON.stringify(source)),sceneDigest=digest(JSON.stringify(scene));
  put(join(old,'generated-scene.json'),source);put(join(old,'review.json'),i.reviewBefore);put(join(old,'quality.json'),i.before);put(join(now,'generated-scene.json'),scene);
  const folder=join(now,'generation/iteration-1/refinement');
  put(join(now,'generation/refinement/source.json'),{sourceJobId:'wrong'});put(join(now,'generation/refinement/receipt.json'),{});
  put(join(folder,'source.json'),{sourceJobId:'before',sourceDigest,qualityBefore:i.before,baselineProfile:profile,repairBudget:i.budget});
  put(join(folder,'receipt.json'),{sourceDigest,sceneDigest});put(join(folder,'repair-goals.json'),i.goals);put(join(folder,'patch.json'),i.patch);
  const job={id:'after',iteration:1,profile,quality:i.after,review:i.reviewAfter};
  const result=saveRepairOutcome(job,now,id=>join(root,id));expect(result?.comparison.delta).toBe(.8);
  expect(JSON.parse(readFileSync(join(now,'repair-outcome.json'),'utf8')).sourceJobId).toBe('before');
  expect(JSON.parse(readFileSync(join(old,'quality.json'),'utf8'))).toEqual(i.before);
  rmSync(join(folder,'repair-goals.json'));expect(saveRepairOutcome(job,now,id=>join(root,id))?.comparison.delta).toBe(.8);
  put(join(now,'generated-scene.json'),{geometry:'tampered'});expect(()=>saveRepairOutcome(job,now,id=>join(root,id))).toThrow('回执不一致');
 }finally{rmSync(root,{recursive:true,force:true});}
});

 test('真实对照仅辅助复盘，不覆盖原分或冒充生成提升',()=>{const i:any=input();i.before.score=58.4;i.after.score=60.9;i.historicalBest={best:{score:58.6}};i.scoreControls={controls:[{matchesSource:true,repeatScore:60,originalScore:58.4}]};const r=repairOutcome(i);expect(r.scoreSignal).toBe('uncertain_gain');expect(r.comparison.gainOverBest).toBe(2.3);expect(r.comparison.gainOverControl).toBe(.9);expect(r.comparison.scoreBefore).toBe(58.4);expect(r.requiresDiagnosis).toBe(true);expect(r.signals.map(s=>s.kind)).toContain('score_repeatability');});
 test('其他场景对照只能说明波动，不能据其分数计算本轮收益',()=>{const i:any=input();i.scoreControls={controls:[{matchesSource:false,repeatScore:95}]};expect(repairOutcome(i).comparison.gainOverControl).toBe(null);});
