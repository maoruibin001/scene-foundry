import {test,expect} from 'bun:test';
import {aggregateCriteria,ATOMIC_QUALITY_VERSION,EVIDENCE_QUALITY_VERSION,atomicJudgePrompt,CRITERION_DIMENSIONS} from './atomic-criteria';
import {qualityGate,ATOMIC_POLICY,EVIDENCE_POLICY,HARD_CHECKS,creationPolicy} from './quality';
import {modelSchema} from './model-schema';
import {validateCriteriaMigration} from './plan-criteria';
import {comparable} from './score-history';
import {specGate,VISUAL_RULE_IDS} from './spec';

const hard=()=>Object.fromEntries(HARD_CHECKS.map(k=>[k,true]));
const plan=()=>({name:'木柜',summary:'两个旧木柜',capabilities:['mapping'],assumptions:[],requirements:[{id:'R1',text:'两个旧木柜',source:'image',evidence:['图1两个旧木柜'],weight:5,critical:true,count:null}],acceptanceCriteria:CRITERION_DIMENSIONS.map((dimension,i)=>({id:'C'+i,requirementId:'R1',dimension,description:['两个柜体及把手均存在','柜体并排立在地面','柜体为有厚度的体积','旧木表面有磨损','把手可辨认'][i],source:'image',evidence:['图1两个旧木柜'],critical:true,weight:1}))});
const review=(score=4.2)=>({confidence:.92,requirements:[{id:'R1',verdict:'met',reason:'条件已逐项观察',frames:['reference-1.png']}],criteria:plan().acceptanceCriteria.map(c=>({id:c.id,score,verdict:'met',reason:'明确条件可见，比例与纹理细节仍有残留',frames:['reference-1.png']})),dimensions:CRITERION_DIMENSIONS.map(id=>({id,score,reason:'整体可见画面接近参考，仍有细节差异',frames:['reference-1.png']}))});

test('旧协议仍要求所有关键项5分，新协议条件完整且质量84分可以通过，不修改输入',()=>{
 const p=plan(),r=review(),before=JSON.stringify([p,r]);
 expect(()=>aggregateCriteria(p,r,ATOMIC_QUALITY_VERSION)).toThrow('不一致');
 const q=qualityGate(p,r,hard(),EVIDENCE_POLICY);
 expect(q.status).toBe('passed');expect(q.score).toBe(84);expect(q.diagnostic?.score).toBe(84);expect(q.criticalMissing).toEqual([]);expect(JSON.stringify([p,r])).toBe(before);
 const legacy=review();legacy.criteria.forEach(c=>c.verdict='partial');legacy.requirements[0].verdict='partial';
 expect(qualityGate(p,legacy,hard(),ATOMIC_POLICY).status).toBe('failed');
});
test('旧判断不会因新版部署自动改为满足，原始partial继续阻止通过',()=>{
 const r=review();r.criteria[1].verdict='partial';r.criteria[1].reason='一个柜体未着地';
 const q=qualityGate(plan(),r,hard(),EVIDENCE_POLICY);expect(q.status).toBe('failed');expect(q.criticalMissing).toEqual(['R1']);
});
test('总分很高但缺一个关键把手，仍不通过',()=>{
 const r=review(5);r.criteria[0]={...r.criteria[0],score:4.8,verdict:'partial',reason:'少一个明确要求的把手'};
 const q=qualityGate(plan(),r,hard(),EVIDENCE_POLICY);expect(q.score).toBeGreaterThan(98);expect(q.status).toBe('failed');expect(q.reasons).toContain('关键需求未完整实现：R1');
});
test('原子存在项高分不能掩盖整体视觉差距或低于底线的材质',()=>{
 const r=review(5);r.dimensions.forEach(d=>d.score=3.9);
 let q=qualityGate(plan(),r,hard(),EVIDENCE_POLICY);expect(q.score).toBe(100);expect(q.diagnostic?.score).toBe(78);expect(q.status).toBe('failed');
 r.dimensions.forEach(d=>d.score=5);r.dimensions.find(d=>d.id==='material')!.score=2.9;
 q=qualityGate(plan(),r,hard(),EVIDENCE_POLICY);expect(q.diagnostic?.score).toBeGreaterThan(80);expect(q.reasons).toContain('整体视觉维度低于底线：material');expect(q.status).toBe('failed');
});
test('80分门槛与3分维度下限保持，包括原子分本身',()=>{
 const r=review(3.99);r.dimensions.forEach(d=>d.score=5);
 expect(qualityGate(plan(),r,hard(),EVIDENCE_POLICY).status).toBe('failed');
 r.criteria.forEach(c=>c.score=5);r.criteria.find(c=>c.id==='C3')!.score=2.99;
 expect(qualityGate(plan(),r,hard(),EVIDENCE_POLICY).reasons).toContain('维度低于底线：material');
 const boundary=review(4);expect(qualityGate(plan(),boundary,hard(),EVIDENCE_POLICY).status).toBe('passed');
});
test('运行证据与置信度门槛不受条件与分值分离影响',()=>{
 const r=review();for(const key of HARD_CHECKS){expect(qualityGate(plan(),r,{...hard(),[key]:false},EVIDENCE_POLICY).status).toBe('failed');}
 r.confidence=.5;expect(qualityGate(plan(),r,hard(),EVIDENCE_POLICY).status).toBe('needs_review');
});
test('缺失与0分绑定，无法凭缺证据或矛盾标签制造满足',()=>{
 for(const edit of [(r:any)=>r.criteria[0].score=0,(r:any)=>r.criteria[0].verdict='missing',(r:any)=>r.criteria[0].frames=[],(r:any)=>r.criteria[0].reason='',(r:any)=>r.criteria.push(r.criteria[0]),(r:any)=>r.criteria[0].score=NaN]){
  const r=review();edit(r);expect(()=>qualityGate(plan(),r,hard(),EVIDENCE_POLICY)).toThrow();
 }
 const absent=review();Object.assign(absent.criteria[0],{score:0,verdict:'missing',reason:'两个柜体都不在画面'});expect(qualityGate(plan(),absent,hard(),EVIDENCE_POLICY).status).toBe('failed');
});
test('新旧模型schema都完整保留条目，旧提示词不被替换',()=>{
 for(const version of [ATOMIC_QUALITY_VERSION,EVIDENCE_QUALITY_VERSION]){
  const p:any=modelSchema('plan',{qualityVersion:version}),r:any=modelSchema('judge',{qualityVersion:version});expect(p.properties.acceptanceCriteria).toBeDefined();expect(r.properties.criteria).toBeDefined();
 }
 expect(atomicJudgePrompt(ATOMIC_QUALITY_VERSION)).toContain('met仅对应5');expect(atomicJudgePrompt(EVIDENCE_QUALITY_VERSION)).toContain('二者分别判断');
 expect(atomicJudgePrompt(EVIDENCE_QUALITY_VERSION)).not.toContain('工业机械室');
});
test('冻结要求不可迁移时改写为更容易的要求；新版本不与旧版直接比较',()=>{
 const p=plan(),before=JSON.stringify(p),changed=structuredClone(p);changed.requirements[0].text='一个木柜';
 expect(()=>validateCriteriaMigration(changed,p,'')).toThrow();expect(JSON.stringify(p)).toBe(before);
 expect(comparable({criteriaDigest:'v6'},{criteriaDigest:'v7'})).toBe(false);
});
test('协议由显式配置选择，不悄悄改写v6',()=>{
 const prior=process.env.PIPELINE_QUALITY_VERSION;
 try{process.env.PIPELINE_QUALITY_VERSION=ATOMIC_QUALITY_VERSION;expect(creationPolicy()).toEqual(ATOMIC_POLICY);process.env.PIPELINE_QUALITY_VERSION=EVIDENCE_QUALITY_VERSION;expect(creationPolicy()).toEqual(EVIDENCE_POLICY);}
 finally{if(prior===undefined)delete process.env.PIPELINE_QUALITY_VERSION;else process.env.PIPELINE_QUALITY_VERSION=prior;}
});
test('质量通过不能替代规范S13，偏好S09仍不否决正式规范',()=>{
 const r={specRules:VISUAL_RULE_IDS.map(id=>({id,status:id==='S09'?'needs_review':'passed',reason:'真实帧核验',frames:id==='S09'?[]:['reference-1.png']}))};
 const runtime={hard:{...hard(),framing:true,entitiesLoaded:true},images:['reference-1.png']};
 expect(specGate(r,runtime,plan(),{passed:true}).status).toBe('passed');
 r.specRules.find(x=>x.id==='S13')!.status='needs_review';expect(specGate(r,runtime,plan(),{passed:true}).status).toBe('needs_review');
});
