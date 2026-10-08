import {test,expect} from 'bun:test';
import {basicDelivery} from './delivery-standard';
import {assess} from './assessment';
import {DEFAULT_POLICY,EVIDENCE_POLICY,DIMENSIONS,HARD_CHECKS} from './quality';
import {VISUAL_RULE_IDS} from './spec';

const fixture=()=>({
 job:{policy:{...DEFAULT_POLICY,deliveryStandard:'basic70'},plan:{requirements:[{id:'foliage',critical:true,count:null}]},structure:{passed:true,semanticCounts:{foliage:3}}},
 review:{requirements:[{id:'foliage',verdict:'met'}]},
 runtime:{hard:{video:true,cameraStopped:true}},
 quality:{score:75,diagnostic:{score:72},confidenceValid:true,confidence:.9,hardFailures:[]},
 spec:{status:'needs_review',rules:[{id:'S13',kind:'mandatory',status:'passed',reason:'采样无确认缺陷'}]},
 counts:[{kind:'foliage',visibleMin:1,visibleMax:2,reason:'最后一组被前景遮挡'}],
});
const run=(f:any)=>basicDelivery(f.job,f.review,f.runtime,f.quality,f.spec,'needs_review',f.counts);

test('部分可见区间不冒充全部实例数，保留警告和严格状态',()=>{
 const f=fixture(),before=JSON.stringify(f),result=run(f);
 expect(result.status).toBe('passed');expect(result.strictStatus).toBe('needs_review');
 expect(result.warnings).toHaveLength(1);expect(result.warnings[0].id).toBe('count-visibility:foliage');
 expect(result.warnings[0].reason).toContain('其余可见性未证实');expect(JSON.stringify(f)).toBe(before);
});
test('明确的数量要求仍阻止仅部分可见结果放行',()=>{
 const f:any=fixture();f.job.plan.requirements[0].count=3;
 expect(run(f).status).toBe('needs_review');expect(run(f).warnings).toHaveLength(0);
});
test('任何明确数量要求在缺少可靠类别映射时保守保留核查',()=>{
 const f:any=fixture();f.job.plan.requirements.push({id:'chairs',critical:true,count:2});
 expect(run(f).status).toBe('needs_review');
});
test('画面至少数量超过实际总数仍为真正矛盾',()=>{
 const f=fixture();f.counts[0].visibleMin=4;f.counts[0].visibleMax=5;
 expect(run(f).status).toBe('needs_review');expect(run(f).warnings).toHaveLength(0);
});
test('类别完全不可见或没有确认可见实例仍需复核',()=>{
 const f=fixture();f.counts[0].visibleMin=0;f.counts[0].visibleMax=0;
 expect(run(f).status).toBe('needs_review');
 f.counts[0].visibleMax=2;expect(run(f).status).toBe('needs_review');
});
test('未知类别及无效计数不能被转换成可接受警告',()=>{
 const f:any=fixture();
 for(const c of [{},{kind:'unknown',visibleMin:1,visibleMax:2},{kind:'foliage',visibleMin:2,visibleMax:1},{kind:'foliage',visibleMin:-1,visibleMax:2},{kind:'foliage',visibleMin:1.5,visibleMax:2}]){
  f.counts=[c];expect(run(f).status).toBe('needs_review');
 }
});
test('部分遮挡警告不能盖过其他类别的真正矛盾',()=>{
 const f:any=fixture();f.job.structure.semanticCounts.chair=1;
 f.counts.push({kind:'chair',visibleMin:2,visibleMax:2});expect(run(f).status).toBe('needs_review');
 expect(run(f).warnings).toHaveLength(1);
});
test('70双分门槛和主体、结构、Engine、确认缺陷门槛不变',()=>{
 for(const mutate of [
  (f:any)=>f.quality.score=69.99,(f:any)=>f.quality.diagnostic.score=65.6,
  (f:any)=>f.review.requirements[0].verdict='missing',(f:any)=>f.job.structure.passed=false,
  (f:any)=>f.runtime.hard.video=false,(f:any)=>f.quality.hardFailures=['frameRate'],
  (f:any)=>f.spec.rules[0].status='failed',
 ]){const f=fixture();mutate(f);expect(run(f).status).toBe('failed');}
});
test('部分草稿与低置信度仍不算完整基础交付',()=>{
 const f:any=fixture();f.job.partialOutput={completed:8,total:9};expect(run(f).status).toBe('needs_review');
 delete f.job.partialOutput;f.quality.confidence=.1;expect(run(f).status).toBe('needs_review');
});
test('正常评估保留原始评审和严格结果，只有基础交付区分可见性警告',()=>{
 const f:any=fixture();f.job.stages={build:{status:'passed'},verify:{status:'passed'}};
 f.job.policy={...EVIDENCE_POLICY,deliveryStandard:'basic70'};
 f.job.plan.requirements[0].source='image';
 f.job.plan.acceptanceCriteria=DIMENSIONS.map((d,i)=>({id:'C'+i,requirementId:'foliage',dimension:d.id,description:'可观察条件'+d.id,source:'image',evidence:['原参考图'],critical:true,weight:1}));
 const frames=['view.png'];
 const runtime={hard:{...Object.fromEntries(HARD_CHECKS.map(k=>[k,true])),video:true,cameraStopped:true},submittedFps:30,images:frames};
 const review={confidence:.9,requirements:[{id:'foliage',verdict:'met',reason:'主要植被明确存在',frames}],criteria:f.job.plan.acceptanceCriteria.map((c:any)=>({id:c.id,score:4.2,verdict:'met',reason:'实际观测',frames})),dimensions:DIMENSIONS.map(d=>({id:d.id,score:4.2,reason:'实际观测',frames})),specRules:VISUAL_RULE_IDS.map(id=>({id,status:'passed',reason:'实际观测',frames})),entityCounts:f.counts};
 const before=JSON.stringify({job:f.job,review,runtime});
 const basic=assess(f.job,review,runtime);
 const strict=assess({...f.job,policy:{...f.job.policy,deliveryStandard:'strict'}},review,runtime);
 expect(basic.status).toBe('passed');expect(strict.status).toBe('needs_review');
 expect(basic.strictStatus).toBe(strict.status);expect(basic.countContradictions).toEqual(strict.countContradictions);
 expect(basic.quality).toEqual({...strict.quality,policy:{...strict.quality.policy,deliveryStandard:'basic70'}});expect(basic.spec).toEqual(strict.spec);
 expect(JSON.stringify({job:f.job,review,runtime})).toBe(before);
});
