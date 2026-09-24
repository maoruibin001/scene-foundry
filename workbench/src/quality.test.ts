import {test,expect} from 'bun:test';
import {qualityGate,batchGate,modeOf,HARD_CHECKS,DIMENSIONS,DEFAULT_POLICY,dimensionsFor,scoringGuidance} from './quality';
const plan={requirements:[{id:'r1',critical:true,weight:2},{id:'r2',critical:false,weight:1}]};
const review={requirements:plan.requirements.map(r=>({id:r.id,verdict:'met',reason:'visible',frames:['view-1.png']})),dimensions:DIMENSIONS.map(d=>({id:d.id,score:4,reason:'visible',frames:['view-1.png']})),confidence:.9};
const hard=Object.fromEntries(HARD_CHECKS.map(k=>[k,true]));
test('all input modes and empty input',()=>{expect(modeOf('a')).toBe('prompt');expect(modeOf('',{})).toBe('image');expect(modeOf('a',{})).toBe('image_prompt');expect(()=>modeOf('')).toThrow()});
test('high visual score cannot hide broken runtime or critical requirement',()=>{expect(qualityGate(plan,review,hard).status).toBe('passed');expect(qualityGate(plan,review,{...hard,runtime:false}).status).toBe('failed');const r=structuredClone(review);r.requirements[0].verdict='partial';expect(qualityGate(plan,r,hard).status).toBe('failed')});
test('missing evaluation and low confidence do not become success',()=>{expect(()=>qualityGate(plan,{...review,requirements:[]},hard)).toThrow();expect(qualityGate(plan,{...review,confidence:.4},hard).status).toBe('needs_review')});
test('batch uses frozen denominator and modality floors',()=>{const cases=Array.from({length:90},(_,i)=>({id:String(i),mode:['prompt','image','image_prompt'][i%3]}));const b={id:'b',cases,profile:{id:'test'},calibration:{profileId:'test',cases:Array.from({length:12},(_,i)=>({evidenceDigest:'e'+i,reviewDigest:'r'+i,expected:i<6?'passed':'failed',predicted:i<6?'passed':'failed',reviewedBy:'fixture reviewer',reviewerKind:'human',reviewedAt:'2026-09-22',reason:'test fixture'}))}};const jobs=cases.map(c=>({batchId:'b',caseId:c.id,status:'passed',attempt:1,profile:{id:'test'}}));expect(batchGate(b,jobs).status).toBe('usable');expect(batchGate(b,jobs.slice(0,3)).status).toBe('unverified');expect(batchGate({id:'b',cases:cases.slice(0,3)},jobs).status).toBe('unverified');jobs.filter((_,i)=>i%3===1).slice(0,5).forEach(j=>j.status='failed');expect(batchGate(b,jobs).status).toBe('unusable')});
test('retries remain one case and never inflate denominator',()=>{const b={id:'b',cases:[{id:'c',mode:'prompt'}]};const r=batchGate(b,[{batchId:'b',caseId:'c',attempt:1,status:'failed'},{batchId:'b',caseId:'c',attempt:2,status:'passed'}]);expect(r.n).toBe(1);expect(r.passed).toBe(1);expect(r.firstPass).toBe(0)});
test('invalid confidence retains diagnostic score but never yields success',()=>{const r=qualityGate(plan,{...review,confidence:5},hard);expect(r.status).toBe('needs_review');expect(r.score).toBeGreaterThan(0);expect(r.confidence).toBe(null);expect(r.rawConfidence).toBe(5)});

test('一次提交内自动修正通过不能计作首稿通过',()=>{const b={id:'b',cases:[{id:'c',mode:'prompt'}]};const r=batchGate(b,[{batchId:'b',caseId:'c',attempt:1,status:'passed',firstDraft:{status:'failed',score:55.7}}]);expect(r.n).toBe(1);expect(r.passed).toBe(1);expect(r.firstPass).toBe(0);});

test('空间权重提高后按新权重计算，历史续跑仍按冻结版本得到原分数',()=>{
 const r=structuredClone(review);r.dimensions.find(d=>d.id==='spatial')!.score=3;
 const before=JSON.stringify(r),current=qualityGate(plan,r,hard);
 expect(current).toMatchObject({score:78.4,status:'failed',policy:{version:'scene-quality-v4',dimensionWeights:{coverage:32,spatial:40,shape:12,material:8,readability:8}}});
 expect(current.dimensions.reduce((n,d)=>n+d.weight,0)).toBe(100);
 for(const version of ['scene-quality-v2','scene-quality-v3']){
  const legacy={...DEFAULT_POLICY,version};delete legacy.dimensionWeights;const saved=JSON.stringify(legacy);
  const restored=qualityGate(plan,r,hard,legacy);
  expect(restored).toMatchObject({score:83,status:'passed'});
  expect(restored.dimensions.find(d=>d.id==='spatial')!.weight).toBe(25);
  expect(JSON.stringify(legacy)).toBe(saved);
 }
 expect(JSON.stringify(r)).toBe(before);
 expect(scoringGuidance(DEFAULT_POLICY).dimensions).toEqual(current.dimensions.map(({score,reason,frames,points,...d})=>d));
});

test('评分版本拒绝权重篡改或未知版本，低权重维度仍必须过底线',()=>{
 for(const dimensionWeights of [{coverage:32,spatial:41,shape:12,material:8,readability:8},{coverage:31,spatial:41,shape:12,material:8,readability:8},{...DEFAULT_POLICY.dimensionWeights,other:0}])expect(()=>dimensionsFor({...DEFAULT_POLICY,dimensionWeights})).toThrow('权重');
 expect(()=>dimensionsFor({...DEFAULT_POLICY,version:'unknown'})).toThrow('未知评分版本');
 const r=structuredClone(review);for(const d of r.dimensions)d.score=d.id==='material'?2.9:5;
 const result=qualityGate(plan,r,hard);expect(result.score).toBeGreaterThan(90);expect(result.status).toBe('failed');expect(result.reasons).toContain('维度低于底线：material');
});
