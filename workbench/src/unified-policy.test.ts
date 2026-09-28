import {test,expect} from 'bun:test';
import {aggregateCriteria,validateCriteria,CRITERION_DIMENSIONS} from './atomic-criteria';
import {qualityGate,ATOMIC_POLICY,DEFAULT_POLICY,HARD_CHECKS} from './quality';
import {roleSettings,assetSettings,OPTIMIZATION_POLICY} from './generation-policy';
import {executionHeld,assertExecutionEnabled} from './acceptance-hold';
import {candidateSelection} from './geometry/candidate-selection';
import {boundedIterations} from './geometry/iteration-policy';
import {comparable} from './score-history';
const plan=()=>({requirements:[{id:'R1',source:'image',weight:2,critical:true}],acceptanceCriteria:CRITERION_DIMENSIONS.map((dimension,i)=>({id:'C'+i,requirementId:'R1',dimension,description:'原图可见事实'+i,source:'image',evidence:['参考图 1'],critical:i===0,weight:1}))});
const review=(p:any)=>({confidence:.9,requirements:[{id:'R1',verdict:'partial',reason:'具体残留',frames:['reference-1.png']}],criteria:p.acceptanceCriteria.map((c:any)=>({id:c.id,score:c.dimension==='coverage'?5:4,verdict:c.dimension==='coverage'?'met':'partial',reason:'逐项实际观察',frames:['reference-1.png']})),dimensions:CRITERION_DIMENSIONS.map(id=>({id,score:1,reason:'独立诊断',frames:['reference-1.png']}))});
test('原子连续分以固定32/28/20/12/8聚合，原始诊断不能覆盖正式分',()=>{
 const p=plan(),r=review(p),before=JSON.stringify([p,r]),q=qualityGate(p,r,Object.fromEntries(HARD_CHECKS.map(k=>[k,true])),ATOMIC_POLICY);
 expect(q.score).toBe(85.6);expect(q.criticalMissing).toEqual(['R1']);expect(q.status).toBe('failed');expect(q.dimensions.find(d=>d.id==='coverage')?.score).toBe(5);expect(JSON.stringify([p,r])).toBe(before);
 const legacy=qualityGate(p,r,{},DEFAULT_POLICY);expect(legacy.score).not.toBe(q.score);
});
test('拆分相同需求的条目不增需求权重，重复标准与未知引用不能通过',()=>{
 const p=plan(),r=review(p),base=aggregateCriteria(p,r);
 p.acceptanceCriteria.push({...p.acceptanceCriteria[1],id:'extra',description:'另一个同权事实'});r.criteria.push({...r.criteria[1],id:'extra'});
 expect(aggregateCriteria(p,r).dimensions).toEqual(base.dimensions.map(d=>d.id==='spatial'?{...d,reason:d.reason+'；extra：逐项实际观察'}:d));
 p.acceptanceCriteria.at(-1)!.description=p.acceptanceCriteria[1].description;expect(()=>validateCriteria(p)).toThrow();
});
test('缺少原子判断、评分和档位矛盾、推断设关键均拒绝；新版分数不能同旧版混比',()=>{
 const p=plan(),r=review(p);r.criteria.pop();expect(()=>aggregateCriteria(p,r)).toThrow();
 const bad=review(p);bad.criteria[0].score=4;expect(()=>aggregateCriteria(p,bad)).toThrow();
 p.acceptanceCriteria[0].source='inferred';expect(()=>validateCriteria(p)).toThrow();
 expect(comparable({criteriaDigest:'a'},{criteriaDigest:'b'})).toBe(false);
});
test('按阶段降档不会提高用户所选深度，最终评审和复杂结构保留深度',()=>{
 const base:any={model:'gpt-6-astra',reasoningEffort:'xhigh'};
 expect(roleSettings(base,'plan',OPTIMIZATION_POLICY)?.reasoningEffort).toBe('medium');
 expect(roleSettings(base,'scene-space',OPTIMIZATION_POLICY)?.reasoningEffort).toBe('high');
 expect(roleSettings(base,'judge',OPTIMIZATION_POLICY)).toEqual(base);
 expect(roleSettings({...base,reasoningEffort:'low'},'plan',OPTIMIZATION_POLICY)?.reasoningEffort).toBe('low');
 expect(roleSettings(base,'plan',undefined)).toEqual(base);
 expect(assetSettings({modelSettings:base,optimizationPolicy:OPTIMIZATION_POLICY},{id:'a',bounds:{min:[0,0,0],max:[6,2,2]},maxParts:30},{program:{instances:[]}})).toEqual(base);
});
test('总分上涨但关键维度退步不会取代最佳候选，后续从最佳继续',async()=>{
 const dimensions=(n:number)=>[{id:'spatial',score:n}],rows=[{status:'failed',score:61,dimensions:dimensions(3.4)},{status:'failed',score:66,dimensions:dimensions(2.8)},{status:'failed',score:70,dimensions:dimensions(3.6)}],sources:number[]=[];
 const r=await boundedIterations({maxRepairs:2,signal:new AbortController().signal,canRefine:()=>true,evaluate:async i=>rows[i],snapshot:async()=>{},refine:async i=>{sources.push(i)}});
 expect(sources).toEqual([0,0]);expect(r.bestIndex).toBe(2);expect(r.cycles[1].selection.eligible).toBe(false);
 expect(candidateSelection({criticalMissing:[]},{criticalMissing:['C1']}).eligible).toBe(false);
});
test('独立项目默认可以执行，显式冻结必须重新启用',()=>{
 expect(executionHeld({PIPELINE_EXECUTION_ENABLED:'0'} as any)).toBe(true);expect(executionHeld({} as any)).toBe(false);expect(executionHeld({PIPELINE_EXECUTION_ENABLED:'1'} as any)).toBe(false);
 const before=process.env.PIPELINE_EXECUTION_ENABLED;process.env.PIPELINE_EXECUTION_ENABLED='0';
 try{expect(()=>assertExecutionEnabled()).toThrow('ACCEPTANCE_CONFIRMATION_REQUIRED');}finally{if(before===undefined)delete process.env.PIPELINE_EXECUTION_ENABLED;else process.env.PIPELINE_EXECUTION_ENABLED=before;}
});
