import {test,expect} from 'bun:test';
import {basicDelivery,deliveryStandard} from './delivery-standard';
import {assess} from './assessment';
import {DEFAULT_POLICY,DIMENSIONS,HARD_CHECKS} from './quality';
import {VISUAL_RULE_IDS} from './spec';
import {boundedIterations} from './geometry/iteration-policy';
import {productionTimeline} from './production-timing';
const fixture=()=>({
 job:{policy:{...DEFAULT_POLICY,deliveryStandard:'basic70',confidenceFloor:.65},plan:{requirements:[{id:'R1',critical:true}]},structure:{passed:true}},
 review:{requirements:[{id:'R1',verdict:'partial'}]},
 runtime:{hard:{video:true,cameraStopped:true}},
 quality:{score:75.8,diagnostic:{score:70.64},status:'failed',confidenceValid:true,confidence:.9,hardFailures:[]},
 spec:{status:'needs_review',rules:[{id:'S13',kind:'mandatory',status:'needs_review',reason:'亮斑是否闪烁待复核'}]},
});
function run(f=fixture()){return basicDelivery(f.job,f.review,f.runtime,f.quality,f.spec,'failed');}
test('基础交付保存严格失败、低材质和复核提示，不篡改分数或旧结论',()=>{
 const f=fixture(),before=JSON.stringify(f),d=run(f);
 expect(d).toMatchObject({status:'passed',score:75.8,rawScore:70.64,strictStatus:'failed'});
 expect(d.warnings).toHaveLength(1);expect(JSON.stringify(f)).toBe(before);
 expect(deliveryStandard({})).toBe('strict');expect(()=>deliveryStandard({deliveryStandard:'other'})).toThrow();
});
test('基础档双分门槛独立，不能用高综合分抵消低原始分',()=>{
 const a=fixture();a.quality.score=99;a.quality.diagnostic.score=69.99;expect(run(a).status).toBe('failed');
 const b=fixture();b.quality.score=69.99;expect(run(b).status).toBe('failed');
 const c=fixture();c.quality.score=70;c.quality.diagnostic.score=70;expect(run(c).status).toBe('passed');
});
test('灰模补位或缺资产草稿不能按基础成品交付',()=>{
 const f:any=fixture();f.job.partialOutput={completed:15,total:16};expect(run(f).status).toBe('needs_review');
 delete f.job.partialOutput;f.job.assessmentScope='partial';expect(run(f).status).toBe('needs_review');
});
test('运行失败、无录屏、关键主体缺失与确认缺陷均不能降标放行',()=>{
 const a=fixture();a.quality.hardFailures.push('frameRate' as never);expect(run(a).status).toBe('failed');
 const b=fixture();b.runtime.hard.video=false;expect(run(b).status).toBe('failed');
 const c=fixture();c.review.requirements[0].verdict='missing';expect(run(c).status).toBe('failed');
 const d=fixture();d.spec.rules[0].status='failed';expect(run(d).status).toBe('failed');
 const e=fixture();e.job.structure.passed=false;expect(run(e).status).toBe('failed');
});
test('低置信度、计数矛盾与复核异议不能成为基础通过',()=>{
 const f=fixture();f.quality.confidence=.2;expect(run(f).status).toBe('needs_review');
 f.quality.confidence=.9;expect(basicDelivery(f.job,f.review,f.runtime,f.quality,f.spec,'failed',[{}]).status).toBe('needs_review');
 expect(basicDelivery(f.job,f.review,f.runtime,f.quality,f.spec,'failed',[],['异议待处理']).status).toBe('needs_review');
});
test('正常评估入口只对显式基础档采用交付结果，旧策略不变',()=>{
 const job:any={policy:DEFAULT_POLICY,plan:{requirements:[{id:'r',critical:true}]},structure:{passed:true,semanticCounts:{}},stages:{build:{status:'passed'},verify:{status:'passed'}}};
 const runtime={hard:{...Object.fromEntries(HARD_CHECKS.map(k=>[k,true])),video:true,cameraStopped:true},submittedFps:30,images:['view.png']};
 const review={confidence:.9,requirements:[{id:'r',verdict:'met',reason:'实际可见',frames:['view.png']}],dimensions:DIMENSIONS.map(d=>({id:d.id,score:4,reason:'实际画面',frames:['view.png']})),specRules:VISUAL_RULE_IDS.map(id=>({id,status:'passed',reason:'实际画面',frames:['view.png']})),entityCounts:[]};
 const strict=assess(job,review,runtime);expect(strict.status).toBe('passed');expect('delivery' in strict).toBe(false);
});
test('基础交付成功即停止，不再启动质量修正',async()=>{
 let repairs=0;const r=await boundedIterations({maxRepairs:null,signal:new AbortController().signal,canRefine:()=>true,evaluate:async()=>({status:run().status,score:75.8}),snapshot:async()=>{},refine:async()=>{repairs++;}});
 expect(r.stopReason).toBe('passed');expect(r.cycles).toHaveLength(1);expect(repairs).toBe(0);
});
test('基础达标固定自身交付用时，不能冒充完整80规范成功或追改旧任务',()=>{
 const j:any={id:'a',prompt:'新图',images:[],createdAt:new Date(1000).toISOString(),startedAt:1100,endedAt:6000,status:'passed',policy:{deliveryStandard:'basic70'}};
 const m:any={jobId:'a',kind:'evaluation',at:5000,iteration:0,basicPassed:true,formalPassed:false,stage70Passed:true};
 const d=productionTimeline(j,[j],[m],10000);expect(d.successMs).toBe(4000);expect(d.formalSuccessAt).toBeNull();expect(d.basicSuccessAt).toBe(5000);
 delete j.policy.deliveryStandard;expect(productionTimeline(j,[j],[m],10000).successAt).toBeNull();
});
