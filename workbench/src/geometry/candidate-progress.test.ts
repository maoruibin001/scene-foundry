import {test,expect} from 'bun:test';
import {candidateEvidence,candidateProgress} from './candidate-selection';
import {boundedIterations} from './iteration-policy';
import {scoreProgress} from '../improvement-governance';
const weights={spatial:32,coverage:28,material:20,shape:12,readability:8};
const before=()=>({status:'failed',score:95.2,policyVersion:'frozen',dimensions:[{id:'material',score:3.9}],rawDimensions:Object.keys(weights).map(id=>({id,score:id==='material'?2.6:4.5})),dimensionWeights:weights,dimensionFloor:3,criticalMissing:['R5'],hardFailures:[],specRules:[{id:'S02',status:'failed'},{id:'S01',status:'passed'}]});
const improved=()=>{const v=before();v.score=94.8;v.rawDimensions.find(d=>d.id==='material')!.score=3.1;v.specRules[0].status='passed';return v;};
test('高总分但材质未通过时，关闭真实规范项优先于总分波动',()=>{const a=before(),b=improved(),saved=JSON.stringify([a,b]),p=candidateProgress(a,b);expect(p.meaningful).toBe(true);expect(p.closed).toEqual(['spec:S02','dimension:material']);expect(JSON.stringify([a,b])).toBe(saved);});
test('正式分上涨不能掩盖原始材质明显退步',()=>{const a=improved(),b=improved();b.score=99;b.rawDimensions.find(d=>d.id==='material')!.score=2.79;expect(candidateProgress(a,b)).toMatchObject({eligible:false,meaningful:false});});
test('关闭旧问题但新增硬失败或规范退步不作为最佳',()=>{for(const bad of [()=>{const b=improved();b.hardFailures.push('runtime');return b;},()=>{const b=improved();b.specRules[1].status='failed';return b;}])expect(candidateProgress(before(),bad()).meaningful).toBe(false);});
test('缺少后续证据不推断规范和原始维度已经修好',()=>{const a=before(),b:any={...a,score:95.3};delete b.rawDimensions;delete b.specRules;delete b.criticalMissing;expect(candidateProgress(a,b).meaningful).toBe(false);});
test('没有关闭问题的小幅波动仍不足以继续消耗',()=>{const a=before(),b=before();b.score=96;expect(candidateProgress(a,b).meaningful).toBe(false);});
test('逐轮选择和累计账本都保留真实关闭问题的候选',async()=>{
 const rows=[before(),improved(),{...improved(),score:95,status:'passed',criticalMissing:[]}],sources:number[]=[],cycles:any[]=[];
 const r=await boundedIterations({maxRepairs:null,signal:new AbortController().signal,canRefine:()=>true,evaluate:async i=>rows[i],snapshot:async c=>{cycles.push(c);},refine:async source=>{sources.push(source);}});
 expect(r.stopReason).toBe('passed');expect(sources).toEqual([0,1]);expect(r.bestIndex).toBe(2);expect(cycles[0].score).toBe(95.2);
 const historic={kind:'final',comparison:'same',score:95.2,jobId:'old',evidence:rows[0]},current={...historic,score:94.8,jobId:'fixed',evidence:rows[1]};
 const p=scoreProgress([historic],current,2);expect(p).toMatchObject({bestScore:95.2,selectedJobId:'fixed',improved:true,noGain:0});
 const next=scoreProgress([historic,current],{...current,evidence:rows[2],score:95,jobId:'passed'},2);expect(next).toMatchObject({selectedJobId:'passed',improved:true,noGain:0});
});
test('评估证据明确区分派生维度和原始维度，不改变原分',()=>{const j={status:'failed',quality:{score:95.2,dimensions:[{id:'material',score:3.9}]},review:{dimensions:[{id:'material',score:2.6}]},spec:{rules:[]},policy:{dimensionFloor:3,dimensionWeights:weights}};expect(candidateEvidence(j)).toMatchObject({score:95.2,dimensions:j.quality.dimensions,rawDimensions:j.review.dimensions,dimensionFloor:3});});
test('偏好条款变化不否决真实关键缺项关闭，也不单独制造进展',()=>{
 const a:any={...before(),score:81.2,criticalMissing:['R1','R6'],specRules:[{id:'S09',kind:'preference',status:'passed'}]};
 const b={...a,score:83.8,criticalMissing:['R1'],specRules:[{id:'S09',kind:'preference',status:'needs_review'}]};
 const saved=JSON.stringify([a,b]),p=candidateProgress(a,b);
 expect(p).toMatchObject({eligible:true,meaningful:true,closed:['criticalMissing:R6']});expect(JSON.stringify([a,b])).toBe(saved);
 expect(candidateProgress({...a,specRules:[{id:'S09',kind:'preference',status:'failed'}]},a).meaningful).toBe(false);
});
test('必需条款、未知历史条款及改kind降级仍受退步保护',()=>{
 for(const kind of ['mandatory','conditional',undefined]){
  const a={...before(),specRules:[{id:'S13',kind,status:'passed'}]},b={...a,score:99,specRules:[{id:'S13',kind:'preference',status:'failed'}]};
  expect(candidateProgress(a,b)).toMatchObject({eligible:false,meaningful:false});
 }
});

test('70基础档真正通过后停止，不再受80档单维改善要求驱动提分',()=>{
 const a:any={...before(),deliveryStandard:'basic70'},b:any={...a,status:'passed',deliveryStatus:'passed',score:75.8,hardFailures:[],rawDimensions:a.rawDimensions.map((d:any)=>({...d,score:d.id==='material'?2.2:4}))};
 expect(candidateProgress(a,b)).toMatchObject({eligible:true,meaningful:true});
 expect(candidateProgress({...a,deliveryStandard:'strict'},b)).toMatchObject({eligible:false,meaningful:false});
});

const basic=()=>({...before(),deliveryStandard:'basic70',score:70,deliveryStatus:'failed',deliveryReasons:['原始维度加权分未达到70'],criticalMissing:[],specRules:[],rawDimensions:Object.keys(weights).map(id=>({id,score:id==='spatial'?2.9:3.5}))});
test('70模式正式分波动和严格单维门槛不制造进展，80模式保持原行为',()=>{
 const a=basic(),b=structuredClone(a);b.score+=3.1;b.rawDimensions.find(d=>d.id==='spatial')!.score=3;
 expect(candidateProgress(a,b)).toMatchObject({eligible:true,meaningful:false,closed:[],rawGain:.64});
 expect(candidateProgress({...a,deliveryStandard:'strict'},{...b,deliveryStandard:'strict'}).meaningful).toBe(true);
});
test('70模式只关闭真实交付缺项，局部partial和变化的评审文字不制造进展',()=>{
 const a=basic(),b=structuredClone(a);a.criticalMissing=['R1'];a.deliveryReasons.push('纹理需要进一步检查');b.deliveryReasons.push('纹理略显简单');
 expect(candidateProgress(a,b).meaningful).toBe(false);
 a.deliveryReasons.push('已确认的规范缺陷：S13');expect(candidateProgress(a,b)).toMatchObject({meaningful:true,closed:['delivery:已确认的规范缺陷：S13']});
});
test('70模式原始分明确提高才继续，两轮没有实际收益会停止并保留原候选',async()=>{
 const a=basic(),b=structuredClone(a);b.rawDimensions.find(d=>d.id==='material')!.score+=.5;expect(candidateProgress(a,b)).toMatchObject({meaningful:true,rawGain:2});
 const rows=[a,{...a,score:74},{...a,score:77}],r=await boundedIterations({maxRepairs:null,signal:new AbortController().signal,canRefine:()=>true,evaluate:async i=>rows[i],snapshot:async()=>{},refine:async()=>{}});
 expect(r.stopReason).toBe('no-improvement');expect(r.bestIndex).toBe(0);
});
