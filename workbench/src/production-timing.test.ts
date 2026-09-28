import {mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {RUNS} from './store';
import {test,expect} from 'bun:test';
import {productionFamily,productionTimeline,unionDuration,productionTimingSnapshot} from './production-timing';
import {productionDuration,productionTimingHTML} from '../public/production-timing-ui.js';
const iso=(n:number)=>new Date(n).toISOString();
const row=(id:string,start:number,end:number|null,extra:any={})=>({id,prompt:'同一场景',images:[{id:'a'}],createdAt:iso(start),startedAt:start+100,status:end===null?'running':'blocked',...(end===null?{}:{endedAt:end}),...extra});
test('中断恢复从原始提交累计，恢复等待和排队不丢失，技术恢复不计质量轮',()=>{
 const a=row('a',1000,4000),b=row('b',9000,null,{recoverySourceJobId:'a'}),d=productionTimeline(b,[a,b],[],12000);
 expect(d.startedAt).toBe(1000);expect(d.totalMs).toBe(11000);expect(d.executionMs).toBe(5800);expect(d.queueMs).toBe(200);expect(d.unexecutedMs).toBe(5000);expect(d.executionRecoveries).toBe(1);expect(d.assessedRounds).toBe(0);expect(d.successAt).toBeNull();
});
test('从原始任务页也能看到后续恢复，不把另一个同输入新任务混入',()=>{
 const a=row('a',1000,4000),b=row('b',5000,null,{recoverySourceJobId:'a'}),c=row('c',0,null);
 expect(productionFamily(a,[a,b,c]).jobs.map(x=>x.id)).toEqual(['a','b']);expect(productionTimeline(a,[a,b,c],[],9000).totalMs).toBe(8000);
});
test('达到阶段目标与正式通过分开；首次正式通过冻结总耗时，后续提分不延长',()=>{
 const a=row('a',1000,null),marks:any=[{jobId:'a',kind:'evaluation',at:4000,iteration:0,stage70Passed:true,formalPassed:false},{jobId:'a',kind:'evaluation',at:7000,iteration:1,stage70Passed:true,formalPassed:true}];
 const d=productionTimeline(a,[a],marks,12000);expect(d.stage70Ms).toBe(3000);expect(d.successMs).toBe(6000);expect(d.totalMs).toBe(6000);expect(d.status).toBe('passed');expect(d.executionMs).toBe(5900);expect(d.assessedRounds).toBe(2);
});
test('并行执行不相加，普通失败即使高分也不是制作成功',()=>{
 const a=row('a',1000,9000),b=row('b',3000,7000,{recoverySourceJobId:'a'});
 const d=productionTimeline(b,[a,b],[{jobId:'a',kind:'evaluation',at:8000,iteration:0,formalScore:90,formalPassed:false}],12000);
 expect(d.totalMs).toBe(8000);expect(d.executionMs).toBe(7900);expect(d.successAt).toBeNull();expect(d.status).toBe('stopped');expect(unionDuration([[1,5],[3,9],[10,12]])).toBe(10);
});
test('缺失来源不伪造总耗时；未知执行时间不填零；待恢复继续计算等待',()=>{
 const a=row('a',1000,3000,{recoverySourceJobId:'missing'});expect(productionTimeline(a,[a],[],9000).totalMs).toBeNull();
 const b=row('b',1000,3000);delete b.startedAt;expect(productionTimeline(b,[b],[],9000).executionMs).toBeNull();
 const c=row('c',1000,3000);const d=productionTimeline(c,[c],[],9000,['c']);expect(d.totalMs).toBe(8000);expect(d.unexecutedMs).toBe(6000);
});
test('重评延续制作根时间但不增加质量轮次，跨天显示日时分秒',()=>{
 const a=row('a',1000,3000),b=row('b',5000,7000,{reuseAssessmentFrom:'a'}),d=productionTimeline(b,[a,b],[{jobId:'b',kind:'evaluation',at:7000,iteration:null,stage70Passed:true}],10000);
 expect(d.totalMs).toBe(6000);expect(d.assessedRounds).toBe(0);expect(d.reassessments).toBe(1);expect(productionDuration(90061000)).toBe('1 天 1 小时 1 分 1 秒');expect(productionTimingHTML(d)).toContain('当前已停止，尚未正式通过');
});

 test('已保存高分与阶段通过不冒充正式成功，依据同产物运行报告和正式规范里程碑',()=>{
  const ids=Array.from({length:4},()=>crypto.randomUUID());
  try{for(const [index,id] of ids.entries()){
   const dir=join(RUNS,id),cycle=join(dir,'iterations/0'),project=join(cycle,'project/evidence'),hash='a'.repeat(64),hard=Object.fromEntries(['framing','cameraMotion','nonFlat','multipleViews','entitiesLoaded','frameRate','runtime','noErrors','hudToggle','video','cameraStopped'].map(k=>[k,true]));
   mkdirSync(project,{recursive:true});
   writeFileSync(join(dir,'job.json'),JSON.stringify(row(id,1000,5000,{policy:{dimensionWeights:{spatial:32,coverage:28,material:20,shape:12,readability:8}}})));
   writeFileSync(join(project,'run-report.json'),JSON.stringify({distManifestDigest:index===3?'b'.repeat(64):hash,stages:Object.fromEntries(['engine-build','catalog','asset-verify','asset-ready','engine-status'].map(k=>[k,{status:'passed'}]))}));
   writeFileSync(join(cycle,'candidate.json'),JSON.stringify({jobId:id,cycle:{endedAt:4500},fields:{quality:{score:85,status:index===0?'failed':'passed'},spec:{status:index===0?'needs_review':'passed'},runtime:{distManifestDigest:hash,hard:{...hard,framing:index!==2}},review:{dimensions:['spatial','coverage','material','shape','readability'].map(id=>({id,score:4}))}}}));
   const d=productionTimingSnapshot(id,10000);expect(d.stage70At).toBe(index<2?4500:null);expect(d.successAt).toBe(index===1?4500:null);expect(d.assessedRounds).toBe(1);expect(d.totalMs).toBe(index===1?3500:4000);
  }}finally{for(const id of ids)rmSync(join(RUNS,id),{recursive:true,force:true});}
 });
test('草稿高分只记录草稿里程碑，不算成品轮次或阶段通过',()=>{
 const a=row('a',1000,9000),d=productionTimeline(a,[a],[{jobId:'a',kind:'partial',at:5000},{jobId:'a',kind:'evaluation',scope:'partial',at:8000,iteration:0,formalScore:90,formalPassed:true,stage70Passed:true}],12000);
 expect(d.firstOutputAt).toBe(5000);expect(d.firstSceneAt).toBeNull();expect(d.firstPartialAssessmentAt).toBe(8000);expect(d.firstAssessmentAt).toBeNull();expect(d.assessedRounds).toBe(0);expect(d.partialAssessments).toBe(1);expect(d.stage70At).toBeNull();expect(d.successAt).toBeNull();expect(productionTimingHTML(d)).toContain('1 次草稿评分');
});
