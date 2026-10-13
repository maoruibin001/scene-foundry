import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {compilePipelinePlan,prioritizePipelineAssets} from './pipeline-plan';
import {profileQualityPolicy,HARD_CHECKS,PROFILE_QUALITY_VERSION} from './quality';
import {VISUAL_RULE_IDS} from './spec';
import {scoringSignature} from './weighted-reassessment';
import {productionTimeline} from './production-timing';
import {candidateProgress} from './geometry/candidate-selection';
import {boundedIterations} from './geometry/iteration-policy';
import {snapshotIteration,restoreIteration} from './geometry/iteration-snapshots';
import {checkpointInput} from './geometry/checkpoints';
import {restoreRepairAttempt} from './geometry/repair-attempt-recovery';
import {repairOutcome,repairBaselineDelivery} from './geometry/repair-outcome';

// Pure orchestration and temporary-file checks: no model, rendering, service, or production jobs.
const context={engineSha:'e'.repeat(40),generatorSha:'g'.repeat(40),modelSettings:{model:'test',reasoningEffort:'high'}};
const plan=(preset:string,matchingLevel='standard')=>compilePipelinePlan({pipelinePreset:preset,matchingLevel},context)!;
const policy=(preset:string)=>profileQualityPolicy(plan(preset).weights);
const dims=(value:number)=>['coverage','spatial','shape','material','lighting','readability'].map(id=>({id,score:value}));
const evidence=(extra:any={})=>({deliveryStandard:'profile70',pipelinePlanId:'frozen-plan',policyVersion:'scene-quality-v8',status:'failed',deliveryStatus:'failed',score:75,dimensionWeights:plan('effects').weights,dimensions:dims(3.5),rawDimensions:dims(3.5),criticalMissing:[],hardFailures:[],criteria:[],specRules:[],deliveryReasons:['原始维度加权分未达到70'],...extra});

test('preset asset allocation recognizes the real aId/bId contact contract',()=>{
 const ranked=[{brief:{id:'decor'},index:0,priority:10},{brief:{id:'support'},index:1,priority:1}];
 const layout={program:{instances:[{id:'a',template:'support'},{id:'b',template:'decor'}]},entities:[],spatialContacts:[{id:'C1',kind:'support',aId:'a',bId:'b',points:[[0,0,0]]}]};
 const rows=prioritizePipelineAssets(ranked,layout,{pipelinePlan:plan('spatial')});
 expect(rows.every(r=>r.pipelinePriority.structural)).toBe(true);
 expect(rows.find(r=>r.brief.id==='support')!.priority).toBe(12.25);
});

test('frozen surface dependencies match the executor standard/detailed split',()=>{
 for(const preset of ['balanced','assets']){
  expect(plan(preset).resources.parallelSurface).toBe(true);
  expect(plan(preset).stages.find(s=>s.id==='surface')!.dependsOn).toEqual(['space']);
  expect(plan(preset,'detailed').resources.parallelSurface).toBe(false);
  expect(plan(preset,'detailed').stages.find(s=>s.id==='surface')!.dependsOn).toEqual(['blockout']);
 }
});

test('a passed goal cannot enter best selection under different weights or plan identity',()=>{
 const before=evidence(),passed=evidence({status:'passed',deliveryStatus:'passed',deliveryReasons:[],score:99});
 expect(candidateProgress(before,passed)).toMatchObject({eligible:true,meaningful:true});
 expect(candidateProgress(before,{...passed,dimensionWeights:plan('spatial').weights})).toMatchObject({eligible:false,meaningful:false});
 expect(candidateProgress(before,{...passed,pipelinePlanId:'another-plan'})).toMatchObject({eligible:false,meaningful:false});
});

test('unlimited profile repair still stops after two unchanged weighted raw candidates',async()=>{
 const cycles:any[]=[];
 const result=await boundedIterations({maxRepairs:null,signal:new AbortController().signal,canRefine:()=>true,
  evaluate:async(index)=>evidence({score:75+index,rawDimensions:dims(3.4+index*.001)}),
  snapshot:async cycle=>{cycles.push(cycle);},refine:async()=>{},
 });
 expect(result.stopReason).toBe('no-improvement');expect(result.bestIndex).toBe(0);expect(cycles).toHaveLength(3);
 expect(cycles.slice(1).every(c=>!c.selection.meaningful)).toBe(true);
});

test('production success uses current scoring signature while root queue and recovery time remain cumulative',()=>{
 const oldPolicy=policy('spatial'),newPolicy=policy('effects');
 const a={id:'a',prompt:'same',images:[{id:'image'}],policy:oldPolicy,createdAt:new Date(1000).toISOString(),startedAt:1100,endedAt:4000,status:'failed'};
 const b={id:'b',prompt:'same',images:[{id:'image'}],policy:newPolicy,recoverySourceJobId:'a',createdAt:new Date(9000).toISOString(),startedAt:9100,status:'running'};
 const oldMark:any={jobId:'a',kind:'evaluation',scope:'scene',at:3500,iteration:0,profilePassed:true,formalPassed:false,scoringSignature:scoringSignature(oldPolicy.version,oldPolicy.dimensionWeights)};
 const d=productionTimeline(b,[a,b],[oldMark],12000);
 expect(d.startedAt).toBe(1000);expect(d.totalMs).toBe(11000);expect(d.successAt).toBeNull();expect(d.formalSuccessAt).toBeNull();expect(d.status).toBe('running');
 const current:any={jobId:'b',kind:'evaluation',scope:'scene',at:11500,iteration:0,profilePassed:true,formalPassed:false,scoringSignature:scoringSignature(newPolicy.version,newPolicy.dimensionWeights)};
 expect(productionTimeline(b,[a,b],[oldMark,current],12000)).toMatchObject({successAt:11500,profileSuccessAt:11500,totalMs:10500,formalSuccessAt:null,status:'passed'});
 const unrelated={...a,id:'unrelated',createdAt:new Date(0).toISOString()};
 expect(productionTimeline(b,[a,b,unrelated],[{...current,jobId:'unrelated'}],12000).successAt).toBeNull();
});

test('restoring a retained iteration restores every receipt and plan together without rolling back histories',()=>{
 const dir=mkdtempSync(join(tmpdir(),'pipeline-profile-iteration-'));
 const files:any={'delivery-assessment.json':'deliveryAssessment','common-delivery-assessment.json':'commonDeliveryAssessment','goal-assessment.json':'goalAssessment','default-benchmark-assessment.json':'defaultBenchmarkAssessment','image-reconstruction.json':'imageReconstruction'};
 const job:any={id:'temporary-job',pipelineVersion:{id:'frozen-version'},pipelinePlan:plan('effects'),status:'failed',quality:{score:77},callHistory:['first'],selectedIteration:0};
 try{
  writeFileSync(join(dir,'pipeline-plan.json'),JSON.stringify(job.pipelinePlan));
  for(const [file,key] of Object.entries(files)){job[key as string]={candidateSha256:'a'.repeat(64),status:'failed'};writeFileSync(join(dir,file),JSON.stringify(job[key as string]));}
  snapshotIteration(dir,job,{index:0,status:'failed',score:77,startedAt:1,endedAt:2});
  job.callHistory.push('second');job.quality={score:88};job.status='passed';
  for(const [file,key] of Object.entries(files)){job[key as string]={candidateSha256:'b'.repeat(64),status:'passed'};writeFileSync(join(dir,file),JSON.stringify(job[key as string]));}
  restoreIteration(dir,job,0);
  expect(job.quality.score).toBe(77);expect(job.status).toBe('failed');expect(job.callHistory).toEqual(['first','second']);
  for(const [file,key] of Object.entries(files)){expect(job[key as string].candidateSha256).toBe('a'.repeat(64));expect(JSON.parse(readFileSync(join(dir,file),'utf8'))).toEqual(job[key as string]);}
  expect(JSON.parse(readFileSync(join(dir,'pipeline-plan.json'),'utf8')).id).toBe(job.pipelinePlan.id);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('checkpoint identity includes the complete frozen plan and stage contracts',()=>{
 const a:any={prompt:'same',images:[],complexity:'complex',pipelinePlan:plan('effects'),profile:{provider:'test',engineSha:context.engineSha,generatorSha:context.generatorSha}};
 const b={...a,pipelinePlan:plan('spatial')};
 expect(checkpointInput(a).pipelinePlanId).not.toBe(checkpointInput(b).pipelinePlanId);
 expect(checkpointInput(a).stageContracts.repair).not.toBe(checkpointInput(b).stageContracts.repair);
 expect(checkpointInput({...a,pipelinePlan:undefined})).not.toHaveProperty('pipelinePlanId');
});

test('repair execution recovery cannot cross preset identity even when score weights are identical',()=>{
 const dir=mkdtempSync(join(tmpdir(),'pipeline-profile-repair-')),folder=join(dir,'generation/refinement');mkdirSync(folder,{recursive:true});
 const policyValue=policy('effects'),profile={provider:'test',policy:policyValue,assessmentProtocolSha256:'same',judgeModel:'test'},modelSettings={model:'test'};
 const sourcePlan={requirements:[],acceptanceCriteria:[]},sameWeights=plan('effects').weights;
 const prior:any={id:'prior',status:'failed',refineScene:true,reuseSceneFrom:'source',plan:sourcePlan,policy:policyValue,profile,modelSettings,pipelinePlan:compilePipelinePlan({pipelinePreset:'effects',scoreWeights:sameWeights},context)};
 const current:any={...prior,id:'current',recoverySourceJobId:'prior',pipelinePlan:compilePipelinePlan({pipelinePreset:'assets',scoreWeights:sameWeights},context)};
 const write=(path:string,value:any)=>writeFileSync(path,JSON.stringify(value));
 try{
  write(join(dir,'job.json'),prior);write(join(dir,'plan.json'),sourcePlan);
  write(join(folder,'source.json'),{sourceJobId:'source',sourceIteration:null,referenceSha256:[]});
  write(join(folder,'repair-batches.json'),{batches:[{id:'batch-1'}]});
  expect(()=>restoreRepairAttempt(current,'source',{},sourcePlan,[],join(dir,'next'),()=>dir)).toThrow('契约');
  expect(restoreRepairAttempt({...current,pipelinePlan:prior.pipelinePlan},'source',{},sourcePlan,[],join(dir,'next'),()=>dir)).toBeNull();
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('profile repair diagnostics follow meaningful selected weighted raw progress rather than old formal-score gain',()=>{
 const p=policy('effects'),requirements=[{id:'R1',verdict:'partial',reason:'local detail remains',frames:['reference.png']}];
 const result=repairOutcome({policy:p,comparable:true,before:{policy:p,score:75,dimensions:dims(3.5)},after:{policy:p,score:75.1,dimensions:dims(3.5)},
  reviewBefore:{dimensions:dims(3),requirements},reviewAfter:{dimensions:dims(3.2),requirements},
  deliveryBefore:{standard:'profile70',score:75,rawScore:60,status:'failed',reasons:['原始维度加权分未达到70']},
  deliveryAfter:{standard:'profile70',score:75.1,rawScore:64,status:'failed',reasons:['原始维度加权分未达到70']},
  goals:{goals:[]},budget:{templates:8,parts:32,removeParts:32},
 });
 expect(result.selection.meaningful).toBe(true);expect(result.deliveryStandard).toBe('profile70');expect(result.scoreSignal).toBe('effective_gain');expect(result.requiresDiagnosis).toBe(false);
 expect(result.signals.some(s=>s.kind==='coverage_quantization')).toBe(false);
});

test('profile repair baseline keeps its actual weighted delivery rather than losing raw-score provenance',()=>{
 const dir=mkdtempSync(join(tmpdir(),'pipeline-profile-baseline-')),frames=['reference.png'],p=policy('effects');
 const requirements=[{id:'R1',text:'complete main structure',critical:true,weight:1,source:'image',evidence:['reference image'],count:null}];
 const acceptanceCriteria=dims(4).map((d,index)=>({id:'C'+index,requirementId:'R1',dimension:d.id,description:'visible '+d.id,critical:true,weight:1,source:'image',evidence:['reference image']}));
 const frozenPlan={qualityVersion:PROFILE_QUALITY_VERSION,requirements,acceptanceCriteria,capabilities:['mapping']};
 const review={confidence:.9,summary:'measured frames',requirements:[{id:'R1',verdict:'met',reason:'visible',frames}],criteria:acceptanceCriteria.map(c=>({id:c.id,score:4,verdict:'met',reason:'visible',frames})),dimensions:dims(4).map(d=>({...d,reason:'independent '+d.id,frames})),specRules:VISUAL_RULE_IDS.map(id=>({id,status:'passed',reason:'visible',frames})),entityCounts:[]};
 const source={id:'source',plan:frozenPlan,policy:p,pipelinePlan:plan('effects'),structure:{passed:true,semanticCounts:{}},runtime:{distManifestDigest:'a'.repeat(64),images:frames,hashes:['b'.repeat(64)],submittedFps:30,hard:{...Object.fromEntries(HARD_CHECKS.map(id=>[id,true])),video:true,cameraStopped:true}},stages:{build:{status:'passed'},verify:{status:'passed'}}};
 try{
  writeFileSync(join(dir,'job.json'),JSON.stringify(source));
  const delivery=repairBaselineDelivery({policy:p},{sourceJobId:'source',sourceIteration:null,qualityBefore:{score:80}},review,()=>dir);
  expect(delivery).toMatchObject({standard:'profile70',score:80,rawScore:80,candidateSha256:'a'.repeat(64),status:'passed'});
  expect(()=>repairBaselineDelivery({policy:p},{sourceJobId:'source',sourceIteration:null,qualityBefore:{score:99}},review,()=>dir)).toThrow('基线评分');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
