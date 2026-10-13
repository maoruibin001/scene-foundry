import {test,expect} from 'bun:test';
import {createHash} from 'node:crypto';
import {compilePipelinePlan,pipelineContinuationSourceId,selectPipelinePlan,validateFrozenPipelinePlan} from './pipeline-plan';
import {profileQualityPolicy} from './quality';

const context={engineSha:'e'.repeat(40),generatorSha:'g'.repeat(40),modelSettings:{model:'test',reasoningEffort:'high'}};
const canonical=(v:any):any=>v===undefined?null:v===null||typeof v!=='object'?v:Array.isArray(v)?v.map(canonical):Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));
function reseal(plan:any){const {id,...body}=plan;return {id:createHash('sha256').update(JSON.stringify(canonical(body))).digest('hex'),...body};}
function fixture(){const plan=compilePipelinePlan({pipelinePreset:'effects',matchingLevel:'standard'},context)!;return {input:{pipelinePreset:'effects',scoreWeights:plan.weights,matchingLevel:'standard'},source:{pipelinePreset:'effects',scoreWeights:plan.weights,pipelinePlan:plan,policy:profileQualityPolicy(plan.weights),matchingLevel:'standard'}};}

test('new jobs compile and an original denominator alone does not turn fresh regeneration into recovery',()=>{
 const f=fixture();expect(selectPipelinePlan(f.input,context)?.id).toBe(compilePipelinePlan(f.input,context)?.id);expect(selectPipelinePlan({},context)).toBeUndefined();
 expect(pipelineContinuationSourceId({retryRoot:'original',generationMode:'fresh'})).toBeUndefined();
 expect(pipelineContinuationSourceId({retryRoot:'original',pipelinePlanSourceJobId:'source'})).toBe('source');
 for(const options of [{spatialRepairSource:{jobId:'source'}},{recoverySourceJobId:'source'},{reuseSceneFrom:'source'},{reusePlanFrom:'source'},{reuseAssessmentFrom:'source'},{reuseFrom:'source'},{reuseCheckpoint:'checkpoint'}])expect(pipelineContinuationSourceId(options,'source')).toBe('source');
});
test('continuations preserve the complete older compiler contract instead of rebuilding from current defaults',()=>{
 const f=fixture();f.source.pipelinePlan=reseal({...f.source.pipelinePlan,compilerSha256:'a'.repeat(64),description:'以前已经确认的制作说明'});
 const before=JSON.stringify(f.source),selected=selectPipelinePlan(f.input,context,f.source)!;
 expect(selected).toEqual(f.source.pipelinePlan);expect(selected).not.toBe(f.source.pipelinePlan);expect(selected.id).not.toBe(compilePipelinePlan(f.input,context)?.id);
 selected.weights.coverage=0;expect(JSON.stringify(f.source)).toBe(before);
});
test('saved plans require a valid canonical digest, supported version and complete stage/scoring/resource contracts',()=>{
 const f=fixture();expect(validateFrozenPipelinePlan(f.source.pipelinePlan).id).toBe(f.source.pipelinePlan.id);
 for(const change of [(p:any)=>p.weights.lighting++,(p:any)=>p.id='wrong',(p:any)=>p.compilerSha256='bad']){const p=structuredClone(f.source.pipelinePlan);change(p);expect(()=>validateFrozenPipelinePlan(p)).toThrow('PIPELINE_PLAN_INVALID');}
 for(const change of [(p:any)=>p.version='scene-pipeline-plan-v2',(p:any)=>p.scoring.independentDimensions=false,(p:any)=>p.stages.pop(),(p:any)=>p.resources.noGain=99,(p:any)=>p.commonChecks=p.commonChecks.filter((c:string)=>c!=='engine-hard-checks'),(p:any)=>p.stages.find((s:any)=>s.id==='surface').dependsOn=['space']]){const p=structuredClone(f.source.pipelinePlan);change(p);expect(()=>validateFrozenPipelinePlan(reseal(p))).toThrow('PIPELINE_PLAN_INVALID');}
});
test('frozen preset, weights and model route cannot be changed by technical continuation',()=>{
 const f=fixture();
 expect(()=>selectPipelinePlan({...f.input,pipelinePreset:'assets'},context,f.source)).toThrow('PIPELINE_PLAN_INPUT_MISMATCH');
 expect(()=>selectPipelinePlan({...f.input,scoreWeights:{...f.input.scoreWeights,lighting:30,readability:10}},context,f.source)).toThrow('PIPELINE_PLAN_INPUT_MISMATCH');
 expect(()=>selectPipelinePlan({...f.input,matchingLevel:'detailed'},context,f.source)).toThrow('PIPELINE_PLAN_INPUT_MISMATCH');
 for(const changed of [{...context,engineSha:'changed'},{...context,generatorSha:'changed'}])expect(()=>selectPipelinePlan(f.input,changed,f.source)).toThrow('PIPELINE_PLAN_RUNTIME_MISMATCH');
 for(const changed of [{model:'other',reasoningEffort:'high'},{model:'test',reasoningEffort:'xhigh'}])expect(()=>selectPipelinePlan(f.input,{...context,modelSettings:changed},f.source)).toThrow('PIPELINE_PLAN_MODEL_MISMATCH');
 expect(selectPipelinePlan(f.input,{...context,modelSettings:{reasoningEffort:'high',model:'test'}},f.source)?.id).toBe(f.source.pipelinePlan.id);
});
test('legacy continuations retain their old path; only an explicit new job can add a preset',()=>{
 const f=fixture();expect(selectPipelinePlan({},context,{id:'legacy'})).toBeUndefined();
 expect(()=>selectPipelinePlan(f.input,context,{id:'legacy'})).toThrow('PIPELINE_PLAN_MIGRATION_REQUIRED');
 expect(()=>selectPipelinePlan({},context,{id:'damaged',pipelinePreset:'effects'})).toThrow('PIPELINE_PLAN_MIGRATION_REQUIRED');
 expect(selectPipelinePlan(f.input,context)?.presetId).toBe('effects');
});
test('source metadata cannot relabel a valid plan and a missing choice cannot clear the frozen target',()=>{
 const f=fixture();expect(()=>selectPipelinePlan({},context,f.source)).toThrow('PIPELINE_PLAN_INPUT_MISMATCH');
 expect(()=>selectPipelinePlan(f.input,context,{...f.source,pipelinePreset:'assets'})).toThrow('PIPELINE_PLAN_INPUT_MISMATCH');
 expect(()=>selectPipelinePlan(f.input,context,{...f.source,scoreWeights:{...f.input.scoreWeights,lighting:30,readability:10}})).toThrow('PIPELINE_PLAN_INPUT_MISMATCH');
});
test('source scoring policy stays frozen and cannot silently drift from its plan',()=>{
 const f=fixture();
 for(const change of [{version:'scene-quality-v7'},{deliveryStandard:'basic70'},{score:80},{dimensionWeights:{...f.input.scoreWeights,lighting:30,readability:10}},{confidenceFloor:.1},{minSubmittedFps:1}])expect(()=>selectPipelinePlan(f.input,context,{...f.source,policy:{...f.source.policy,...change}})).toThrow('PIPELINE_PLAN_POLICY_MISMATCH');
 const source={...f.source,policy:{...f.source.policy,confidenceFloor:.8,minSubmittedFps:30}};
 expect(selectPipelinePlan(f.input,context,source)?.id).toBe(source.pipelinePlan.id);expect(source.policy).toMatchObject({confidenceFloor:.8,minSubmittedFps:30});
});
