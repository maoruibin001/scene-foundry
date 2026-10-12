import {describe,test,expect} from 'bun:test';
import {assess} from './assessment';
import {DIMENSIONS,EVIDENCE_POLICY,PROFILE_QUALITY_VERSION,PROFILE_DIMENSIONS,profileQualityPolicy,qualityGate,dimensionsFor,scoringGuidance,HARD_CHECKS} from './quality';
import {aggregateCriteria,validateCriteria,atomicPlanPrompt,atomicJudgePrompt,PROFILE_CRITERION_DIMENSIONS} from './atomic-criteria';
import {modelSchema} from './model-schema';
import {VISUAL_RULE_IDS} from './spec';
import {reweightResult} from './weighted-reassessment';
import {judgePromptFor,JUDGE_PROMPT} from './prompts';

const balanced={coverage:20,spatial:30,shape:15,material:15,lighting:10,readability:10};
const material={coverage:0,spatial:0,shape:0,material:50,lighting:50,readability:0};
function fixture(weights=balanced){
 const plan={qualityVersion:PROFILE_QUALITY_VERSION,name:'多目标测试场景',summary:'真实参考场景',capabilities:['mapping'],assumptions:[],requirements:[{id:'R1',text:'参考场景主要结构',critical:true,weight:1,source:'image',evidence:['图1主体'],count:null}],
  acceptanceCriteria:PROFILE_CRITERION_DIMENSIONS.map((dimension,i)=>({id:'C'+i,requirementId:'R1',dimension,description:'可见'+dimension,source:'image',evidence:['图1对应'+dimension],critical:true,weight:1}))};
 const frames=['reference-1.png'];
 const review={confidence:.9,summary:'真实帧',requirements:[{id:'R1',verdict:'met',reason:'存在',frames}],criteria:plan.acceptanceCriteria.map(c=>({id:c.id,score:4,verdict:'met',reason:'所列条件真实可见',frames})),
  dimensions:PROFILE_DIMENSIONS.map(d=>({id:d.id,score:4,reason:'独立真实'+d.id,frames})),specRules:VISUAL_RULE_IDS.map(id=>({id,status:'passed',reason:'实际帧可见',frames})),entityCounts:[]};
 const runtime={distManifestDigest:'a'.repeat(64),images:frames,hashes:['b'.repeat(64)],hard:{...Object.fromEntries(HARD_CHECKS.map(k=>[k,true])),video:true,cameraStopped:true},submittedFps:30};
 const job:any={id:'profile-fixture',status:'running',policy:profileQualityPolicy(weights),plan,prompt:'',images:[],structure:{passed:true,semanticCounts:{}},stages:{build:{status:'passed'},verify:{status:'passed'}},runtime};
 return {job,plan,review,runtime};
}
const finish=(f:ReturnType<typeof fixture>)=>{const result=assess(f.job,f.review,f.runtime);return {...f,job:{...f.job,...result,review:f.review,runtime:f.runtime}};};

describe('v8 scoring contract',()=>{
 test('six real dimensions and integer weights freeze without changing v7 defaults',()=>{
  const before=JSON.stringify(EVIDENCE_POLICY),p=profileQualityPolicy(balanced);expect(p).toMatchObject({version:PROFILE_QUALITY_VERSION,deliveryStandard:'profile70',score:70,dimensionFloor:0});
  expect(dimensionsFor(p).map(d=>d.id)).toEqual([...PROFILE_CRITERION_DIMENSIONS]);expect(dimensionsFor(p).reduce((n,d)=>n+d.weight,0)).toBe(100);
  expect(dimensionsFor(EVIDENCE_POLICY)).toEqual(DIMENSIONS);expect(JSON.stringify(EVIDENCE_POLICY)).toBe(before);
  for(const weights of [{...balanced,lighting:-1},{...balanced,lighting:10.1},{...balanced,lighting:9},{...balanced,extra:0},{coverage:28,spatial:32,shape:12,material:20,readability:8}])expect(()=>profileQualityPolicy(weights)).toThrow('权重');
  expect(()=>dimensionsFor({...EVIDENCE_POLICY,dimensionWeights:balanced})).toThrow('权重');
  expect(profileQualityPolicy(balanced,{...EVIDENCE_POLICY,confidenceFloor:.2,minSubmittedFps:1})).toMatchObject({confidenceFloor:.65,minSubmittedFps:10});
  expect(()=>profileQualityPolicy(balanced,{...EVIDENCE_POLICY,confidenceFloor:NaN})).toThrow('底线');
 });
 test('plan and judge schema require independent lighting, legacy schemas unchanged',()=>{
  const f=fixture();expect(validateCriteria(f.plan,PROFILE_QUALITY_VERSION)).toBe(f.plan);expect(aggregateCriteria(f.plan,f.review,PROFILE_QUALITY_VERSION).dimensions.map(d=>d.id)).toContain('lighting');
  const planSchema=modelSchema('plan',{qualityVersion:PROFILE_QUALITY_VERSION}),judgeSchema=modelSchema('judge',{qualityVersion:PROFILE_QUALITY_VERSION});
  expect(planSchema.required).toContain('qualityVersion');expect(planSchema.properties.acceptanceCriteria.items.properties.dimension.enum).toContain('lighting');expect(judgeSchema.properties.dimensions.items.properties.id.enum).toContain('lighting');
  expect(modelSchema('judge',{qualityVersion:'scene-quality-v7'}).properties.dimensions.items.properties.id.enum).not.toContain('lighting');
  expect(()=>validateCriteria(f.plan,'scene-quality-v7')).toThrow();
  const missing=structuredClone(f);missing.plan.acceptanceCriteria=missing.plan.acceptanceCriteria.filter(c=>c.dimension!=='lighting');expect(()=>validateCriteria(missing.plan,PROFILE_QUALITY_VERSION)).toThrow();
  expect(atomicPlanPrompt(PROFILE_QUALITY_VERSION)).toContain('lighting 独立');expect(atomicJudgePrompt(PROFILE_QUALITY_VERSION)).toContain('二者均须达到70');expect(atomicJudgePrompt(PROFILE_QUALITY_VERSION)).not.toContain('既定80分及每维3/5');
  expect(judgePromptFor(PROFILE_QUALITY_VERSION)).toContain("'material'|'lighting'|'readability'");expect(judgePromptFor('scene-quality-v7')).toBe(JUDGE_PROMPT);
 });
 test('missing raw lighting is rejected even when its selected weight is zero',()=>{
  const f=fixture({...balanced,material:25,lighting:0});f.review.dimensions=f.review.dimensions.filter(d=>d.id!=='lighting');expect(()=>qualityGate(f.plan,f.review,f.runtime.hard,f.job.policy)).toThrow('维度');
 });
 test('selected appearance weights can pass while old fixed benchmark fails',()=>{
  const f=fixture(material);for(const d of f.review.dimensions)d.score=['material','lighting'].includes(d.id)?4:2;
  for(const [i,c] of f.review.criteria.entries())c.score=f.review.dimensions[i].score;
  const before=JSON.stringify(f),r=assess(f.job,f.review,f.runtime);
  expect(r).toMatchObject({status:'passed',commonDeliveryAssessment:{status:'passed'},goalAssessment:{score:80,rawScore:80,status:'passed'},deliveryAssessment:{standard:'profile70',status:'passed'},defaultBenchmarkAssessment:{standard:'basic70',source:'v8-projected-benchmark',status:'failed'},strictStatus:'failed'});
  expect(JSON.stringify(f)).toBe(before);expect(r.defaultBenchmarkAssessment.label).toContain('非独立v7评审');
 });
 test('implementation and independent visual threshold are not interchangeable',()=>{
  const f=fixture(material);f.review.dimensions.find(d=>d.id==='lighting')!.score=2;
  const r=assess(f.job,f.review,f.runtime);expect(r.commonDeliveryAssessment.status).toBe('passed');expect(r.goalAssessment).toMatchObject({score:80,rawScore:60,status:'failed'});expect(r.status).toBe('failed');
  const g=fixture(material);g.review.criteria.find(c=>c.id==='C4')!.score=2;expect(assess(g.job,g.review,g.runtime).goalAssessment).toMatchObject({score:60,rawScore:80,status:'failed'});
 });
 test('all separate profile receipts bind the same candidate and independent source assessment',()=>{
  const f=fixture(),result=assess(f.job,f.review,f.runtime),goal=result.goalAssessment;
  for(const receipt of [result.commonDeliveryAssessment,result.deliveryAssessment,result.defaultBenchmarkAssessment]){
   expect(receipt.candidateSha256).toBe(goal.candidateSha256);expect(receipt.sourceAssessmentSha256).toBe(goal.sourceAssessmentSha256);
  }
  expect(result.commonDeliveryAssessment.scoringSignature).toBe(goal.scoringSignature);expect(result.deliveryAssessment.scoringSignature).toBe(goal.scoringSignature);
  expect(result.defaultBenchmarkAssessment.sourceScoringSignature).toBe(goal.scoringSignature);expect(result.defaultBenchmarkAssessment.scoringSignature).not.toBe(goal.scoringSignature);
 });
 test('zero weights never waive runtime, missing subject or confirmed mandatory defects',()=>{
  for(const change of [(f:any)=>f.runtime.hard.frameRate=false,(f:any)=>f.runtime.hard.video=false,(f:any)=>f.job.structure.passed=false,(f:any)=>{for(const c of f.review.criteria){c.verdict='missing';c.score=0}},(f:any)=>f.review.specRules.find((r:any)=>r.id==='S13').status='failed']){
   const f=fixture(material);change(f);const r=assess(f.job,f.review,f.runtime);expect(r.commonDeliveryAssessment.status).toBe('failed');expect(r.status).not.toBe('passed');
  }
  const one=fixture(material);one.review.criteria[0].verdict='missing';one.review.criteria[0].score=0;const r=assess(one.job,one.review,one.runtime);
  expect(r.goalAssessment.status).toBe('passed');expect(r.commonDeliveryAssessment).toMatchObject({status:'failed',criticalMissing:['R1']});expect(r.status).toBe('failed');
 });
 test('draft, confidence and exact-count contradiction remain pending; genuine visibility warning remains separate',()=>{
  const draft=fixture();draft.job.partialOutput={completed:1,total:2};expect(assess(draft.job,draft.review,draft.runtime).status).toBe('needs_review');
  const low=fixture();low.review.confidence=.2;expect(assess(low.job,low.review,low.runtime).status).toBe('needs_review');
  const counts:any=fixture();counts.job.structure.semanticCounts={柜:3};counts.review.entityCounts=[{kind:'柜',visibleMin:1,visibleMax:2,reason:'一部分被遮挡'}];
  expect(assess(counts.job,counts.review,counts.runtime).status).toBe('passed');counts.job.plan.requirements[0].count=3;expect(assess(counts.job,counts.review,counts.runtime).status).toBe('needs_review');
  counts.job.plan.requirements[0].count=null;counts.review.entityCounts[0].visibleMin=0;expect(assess(counts.job,counts.review,counts.runtime).status).toBe('needs_review');
 });
 test('scoring guidance uses new goal, not fixed old score, and requires all six raw judgements',()=>{const g=scoringGuidance(profileQualityPolicy(balanced));expect(g.minimumScore).toBe(70);expect(g.dimensions).toHaveLength(6);expect(g.instructions).toContain('不能抬高或压低');});
});

describe('pure weighted result receipts',()=>{
 test('reweight binds candidate, source review and weights without touching terminal history',()=>{
  const f=finish(fixture()),job={...f.job,status:'failed'},before=JSON.stringify(job);
  const r=reweightResult(job,material);expect(r).toMatchObject({version:'weighted-reassessment-v1',kind:'reweight-only',sourceTerminalStatus:'failed',candidateSha256:'a'.repeat(64),score:80,rawScore:80,status:'passed',modelCalls:0,engineRenders:0});
  expect(JSON.stringify(job)).toBe(before);expect(reweightResult(job,{...material}).id).toBe(r.id);expect(reweightResult(job,balanced).id).not.toBe(r.id);
  const candidate=structuredClone(job);candidate.runtime.distManifestDigest='c'.repeat(64);expect(reweightResult(candidate,material).id).not.toBe(r.id);
  const review=structuredClone(job);review.review.dimensions[0].reason='不同原始评审';expect(reweightResult(review,material).id).not.toBe(r.id);
 });
 test('legacy five-dimensional evidence can produce a new five-weight receipt, never a fabricated six-weight receipt',()=>{
  const f=finish(fixture()),job={...f.job,policy:{...EVIDENCE_POLICY,deliveryStandard:'basic70'}};
  job.quality={...job.quality,dimensions:job.quality.dimensions.filter((d:any)=>d.id!=='lighting')};job.review={...job.review,dimensions:job.review.dimensions.filter((d:any)=>d.id!=='lighting')};
  const five={coverage:20,spatial:20,shape:20,material:30,readability:10};expect(reweightResult(job,five)).toMatchObject({scoringVersion:'scene-quality-v7',sourceDeliveryStandard:'basic70',status:'passed'});
  expect(()=>reweightResult(job,balanced)).toThrow('权重');
 });
 test('missing evidence and frame references fail; reweight cannot erase common delivery failures',()=>{
  const f=finish(fixture());delete f.job.runtime.distManifestDigest;expect(()=>reweightResult(f.job,balanced)).toThrow('产物摘要');
  const g=finish(fixture());g.job.review.dimensions[0].frames=['nonexistent.png'];expect(()=>reweightResult(g.job,balanced)).toThrow('运行截图');
  const h=finish(fixture());h.job.runtime.hard.video=false;expect(reweightResult(h.job,material).status).toBe('failed');
  const runtime=finish(fixture());runtime.job.runtime.hard.runtime=false;expect(reweightResult(runtime.job,material).status).toBe('failed');
  const confidence=finish(fixture());confidence.job.review.confidence=.2;expect(reweightResult(confidence.job,material).status).toBe('needs_review');
 });
 test('display rounding cannot turn a score just below 70 into a passing target',()=>{
  const f=fixture(material);for(const d of f.review.dimensions)d.score=3.4999;for(const c of f.review.criteria)c.score=3.4999;
  const r=assess(f.job,f.review,f.runtime);expect(r.goalAssessment).toMatchObject({score:70,rawScore:70,status:'failed'});expect(r.goalAssessment.unroundedScore).toBeLessThan(70);expect(r.status).toBe('failed');
 });
});
