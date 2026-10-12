import {test,expect} from 'bun:test';
import {readFileSync} from 'node:fs';
import {pipelinePresetCatalog,pipelineChoice,compilePipelinePlan} from './pipeline-plan';
import {generationInput} from './reference-input';
import {reweightResult,profileDelivery,projectedBenchmark} from './weighted-reassessment';
import {profileQualityPolicy,HARD_CHECKS} from './quality';
import {reweightHTML,reweightEligibility,profileAssessmentHTML,validatePresetCatalog,validateScoreWeights,scoredWeightDimensions} from '../public/pipeline-plan-ui.js';

// Contract-only fixtures. No server, model request, renderer, or production data writes.
const weights={coverage:20,spatial:30,shape:15,material:15,lighting:10,readability:10};
function scoredFixture(){
 const frame='reference-1.png',dimensions=Object.keys(weights).map(id=>({id,label:id,score:4,reason:'本候选真实维度证据',frames:[frame],weight:weights[id],points:weights[id]*.8}));
 const requirements=[{id:'R1',text:'主要主体',critical:true,count:null}],reported=[{id:'R1',verdict:'met',reason:'主要主体可见',frames:[frame]}];
 const job:any={id:'99999999-9999-4999-8999-999999999999',status:'failed',stage:'gate',prompt:'原始两图场景',images:[{id:'b'.repeat(64)},{id:'c'.repeat(64)}],assessmentScope:'scene',
  policy:profileQualityPolicy(weights),pipelinePreset:'balanced',scoreWeights:weights,plan:{requirements},structure:{passed:true,semanticCounts:{}},
  stages:{build:{status:'passed'},verify:{status:'passed'}},runtime:{distManifestDigest:'a'.repeat(64),images:[frame],hashes:['d'.repeat(64)],submittedFps:30,hard:{...Object.fromEntries(HARD_CHECKS.map(id=>[id,true])),video:true,cameraStopped:true}},
  spec:{status:'passed',rules:[]},review:{confidence:.9,dimensions:structuredClone(dimensions),requirements:reported,entityCounts:[]},quality:{score:80,dimensions:structuredClone(dimensions),requirements:reported,hardFailures:[],criticalMissing:[],confidenceValid:true,confidence:.9},
  delivery:{best:{assessmentScope:'scene',distManifestDigest:'a'.repeat(64),qualityFile:'quality.json'}}};
 return job;
}

test('actual server catalog, frontend editor and frozen start input agree on six dimensions and custom weights',()=>{
 const catalog=validatePresetCatalog(pipelinePresetCatalog()),selected={...weights,spatial:20,lighting:20};expect(validateScoreWeights(selected)).toEqual(selected);
 const record={...scoredFixture(),scoreWeights:selected,complexity:'complex',matchingLevel:'standard',reuseMode:'fresh',generationMode:'qualified',baselineId:'approved'},before=JSON.stringify(record);
 const input=generationInput(record),choice=pipelineChoice(input),plan=compilePipelinePlan(input,{engineSha:'fixed-engine',generatorSha:'fixed-generator',modelSettings:{model:'gpt-6-astra-aihub-openai',reasoningEffort:'xhigh'}});
 expect(choice).toEqual({pipelinePreset:'balanced',scoreWeights:selected});expect(plan.weights).toEqual(selected);expect(plan.presetId).toBe('balanced');expect(plan.scoring.standard).toBe('profile70');expect(plan.scoring.minimumScore).toBe(70);expect(plan.resources.modelSettings.model).toBe('gpt-6-astra-aihub-openai');expect(input.imageIds).toEqual(['b'.repeat(64),'c'.repeat(64)]);expect(input.prompt).toBe(record.prompt);expect(input.reuseMode).toBe('fresh');expect(JSON.stringify(record)).toBe(before);expect(catalog.dimensions.map(d=>d.id)).toContain('lighting');
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),server=readFileSync(new URL('./server.ts',import.meta.url),'utf8');
 expect(app).toContain('const generationSettings={...pipelineSettings');expect(app).toContain("api('/api/references',{...pipelineSettings,generationSettings");expect(server).toContain('settings=v.generationSettings??{}');expect(server).toContain('baselineId:id,...settings');
});

test('historical continuation input has no implicit preset or invented lighting dimension',()=>{
 const old:any=scoredFixture();delete old.pipelinePreset;delete old.scoreWeights;old.policy.version='scene-quality-v7';old.policy.dimensionWeights={coverage:28,spatial:32,shape:12,material:20,readability:8};old.quality.dimensions=old.quality.dimensions.filter(d=>d.id!=='lighting').map(d=>({...d,weight:old.policy.dimensionWeights[d.id]}));old.review.dimensions=old.review.dimensions.filter(d=>d.id!=='lighting');
 const before=JSON.stringify(old),input=generationInput(old);expect(input).not.toHaveProperty('pipelinePreset');expect(input).not.toHaveProperty('scoreWeights');expect(scoredWeightDimensions(old).map(d=>d.id)).not.toContain('lighting');expect(reweightHTML(old)).toContain('没有独立光照评审');expect(reweightHTML(old)).not.toContain('data-score-weight="lighting"');expect(JSON.stringify(old)).toBe(before);
});

test('partial or unsealed scored outputs do not offer a complete-scene reweight save that server must reject',()=>{
 const full=scoredFixture();expect(reweightEligibility(full).available).toBe(true);expect(reweightHTML(full)).toContain('data-reweight-save');
 for(const change of [(j:any)=>j.partialOutput={completed:1,total:2},(j:any)=>j.assessmentScope='partial',(j:any)=>j.delivery.best.assessmentScope='partial',(j:any)=>j.delivery.best=null,(j:any)=>j.delivery.best.distManifestDigest='e'.repeat(64),(j:any)=>j.delivery.best.assessmentError='评分封存失败',(j:any)=>delete j.delivery.best.qualityFile]){
  const partial=structuredClone(full);change(partial);const before=JSON.stringify(partial);expect(reweightEligibility(partial).available).toBe(false);expect(reweightHTML(partial)).not.toContain('data-reweight-save');expect(JSON.stringify(partial)).toBe(before);
 }
 const saving=structuredClone(full);saving.recovery={mode:'active'};expect(reweightEligibility(saving)).toMatchObject({available:false,pending:true});expect(reweightHTML(saving)).toContain('保存停止进度');
});

test('UI renders separate goal/common statuses and reasons from actual reweight response, while preserving source result',()=>{
 const job=scoredFixture();job.runtime.hard.frameRate=false;job.runtime.submittedFps=5;const before=JSON.stringify(job),receipt=reweightResult(job,weights);
 expect(receipt.score).toBe(80);expect(receipt.goalAssessment.status).toBe('passed');expect(receipt.commonDeliveryAssessment.status).toBe('failed');expect(receipt.status).toBe('failed');expect(receipt.modelCalls).toBe(0);expect(receipt.engineRenders).toBe(0);
 const transport={...receipt,weights:receipt.dimensionWeights,weightedScore:receipt.score,rawWeightedScore:receipt.rawScore,evidenceSignature:receipt.sourceAssessmentSha256,createdAt:Date.now()},html=reweightHTML({...job,scoreReweights:[transport]});
 expect(html).toContain('独立重算回执：未通过');expect(html).toContain('当前权重目标：通过');expect(html).toContain('完整性与运行底线：未通过');expect(html).toContain('运行硬检查失败：frameRate');expect(html).toContain('/weighted-receipts/'+receipt.id+'.json');expect(JSON.stringify(job)).toBe(before);
});

test('pending objection and retained warnings are shown instead of inferring acceptance from high totals',()=>{
 const job=scoredFixture();job.postReview={finding:'棚缘接触仍未证实'};job.spec.rules=[{id:'S13',kind:'mandatory',status:'needs_review',reason:'柱基接触需要复核'}];const receipt=reweightResult(job,weights),html=reweightHTML({...job,scoreReweights:[{...receipt,weights:receipt.dimensionWeights}]});
 expect(receipt.goalAssessment.status).toBe('passed');expect(receipt.commonDeliveryAssessment.status).toBe('needs_review');expect(html).toContain('独立重算回执：待复核');expect(html).toContain('棚缘接触仍未证实');expect(html).toContain('柱基接触需要复核');expect(html).toContain('保留警告');
});

test('reweight identity changes with post-review objection context so idempotent storage cannot return a stale pass',()=>{
 const job=scoredFixture(),passed=reweightResult(job,weights),objected=structuredClone(job);objected.postReview={finding:'发现主体悬空'};const pending=reweightResult(objected,weights);
 expect(passed.status).toBe('passed');expect(pending.status).toBe('needs_review');expect(pending.id).not.toBe(passed.id);
 const resolved=structuredClone(objected);resolved.postReview.resolvedAt=123;const resolution=reweightResult(resolved,weights);expect(resolution.status).toBe('passed');expect(resolution.id).not.toBe(pending.id);
});

test('original profile assessment displays its target and common gate separately from the v8 legacy projection',()=>{
 const job=scoredFixture();job.runtime.hard.frameRate=false;job.quality.hardFailures=['frameRate'];
 const assessed=profileDelivery(job,job.review,job.runtime,job.quality,job.spec),benchmark=projectedBenchmark(job,job.review,job.runtime,job.quality,job.spec),before=JSON.stringify(job);
 const html=profileAssessmentHTML({...job,...assessed,defaultBenchmarkAssessment:benchmark});
 expect(assessed.goalAssessment.status).toBe('passed');expect(assessed.commonDeliveryAssessment.status).toBe('failed');
 expect(html).toContain('本次冻结权重交付：未通过');expect(html).toContain('所选权重目标：通过');expect(html).toContain('完整性与运行共同底线：未通过');expect(html).toContain('运行硬检查失败：frameRate');expect(html).toContain('综合分 80.00 · 原始加权分 80.00');expect(html).toContain('旧基础70：未通过');expect(html).toContain('非独立v7评审');expect(html).toContain('目标70通过不等于高还原');expect(JSON.stringify(job)).toBe(before);
 const absent=profileAssessmentHTML({...job,quality:{...job.quality,status:'passed'}});expect(absent).toContain('本次冻结权重交付：未核实');expect(absent).toContain('尚无基准回执');expect(profileAssessmentHTML({policy:{deliveryStandard:'basic70'}})).toBe('');
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');expect(app).toContain('function qualityHTML(j){return j.quality?profileAssessmentHTML(j)+');
});

test('profile common warnings and pending objections survive even when goal and quality scores are high',()=>{
 const job=scoredFixture();job.spec.rules=[{id:'S13',kind:'mandatory',status:'needs_review',reason:'接触细节仍待复核'}];
 const assessed=profileDelivery(job,job.review,job.runtime,job.quality,job.spec,[],['独立复核发现缺口']),html=profileAssessmentHTML({...job,...assessed});
 expect(html).toContain('本次冻结权重交付：待复核');expect(html).toContain('所选权重目标：通过');expect(html).toContain('完整性与运行共同底线：待复核');expect(html).toContain('独立复核发现缺口');expect(html).toContain('接触细节仍待复核');expect(html).toContain('保留警告');
});
