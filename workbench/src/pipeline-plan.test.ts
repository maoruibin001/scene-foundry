import {test,expect} from 'bun:test';
import {compilePipelinePlan,pipelineChoice,pipelinePresetCatalog,prioritizePipelineAssets,prioritizePipelineRepairs,validateScoreWeights} from './pipeline-plan';
const context={engineSha:'e'.repeat(40),generatorSha:'g'.repeat(40),modelSettings:{model:'gpt-6-astra-aihub-openai',reasoningEffort:'high'}};
test('legacy creation remains legacy; unsupported paths cannot silently gain a preset',()=>{
 expect(pipelineChoice({prompt:'历史'})).toBeUndefined();expect(compilePipelinePlan({},context)).toBeUndefined();
 for(const input of [{pipelinePreset:'unknown'},{scoreWeights:{}},{pipelinePreset:'effects',sceneKind:'voxel'},{pipelinePreset:'spatial',nativeCase:'legacy'}])expect(()=>pipelineChoice(input)).toThrow();
});
test('four fixed defaults each include exactly six dimensions and 100 percent',()=>{
 const c=pipelinePresetCatalog();expect(c.presets.map(p=>p.id)).toEqual(['balanced','spatial','assets','effects']);
 for(const p of c.presets)expect(Object.values(validateScoreWeights(p.weights)).reduce((a,b)=>a+b,0)).toBe(100);
 expect(c.capabilities.find(c=>c.id==='external-glb')?.state).toBe('unavailable');
 const damaged=c.presets[0].weights;damaged.coverage=0;expect(pipelinePresetCatalog().presets[0].weights.coverage).toBe(20);
});
test('bad weights are rejected before any plan can dispatch',()=>{
 const w=pipelineChoice({pipelinePreset:'balanced'})!.scoreWeights;
 for(const invalid of [{...w,coverage:19},{...w,coverage:-1,spatial:51},{...w,coverage:20.5,spatial:29.5},{...w,extra:0},{coverage:100}])expect(()=>validateScoreWeights(invalid)).toThrow();
});
test('preset changes actual prerequisites and preview allocation, never bypassing spatial acceptance',()=>{
 const spatial=compilePipelinePlan({pipelinePreset:'spatial'},context)!,assets=compilePipelinePlan({pipelinePreset:'assets'},context)!;
 expect(spatial.stages.find(s=>s.id==='surface')?.dependsOn).toEqual(['blockout']);
 expect(assets.stages.find(s=>s.id==='surface')?.dependsOn).toEqual(['space']);
 expect(spatial.resources.assetVisualChecks).toBe(3);expect(assets.resources.assetVisualChecks).toBe(4);
 for(const plan of [spatial,assets]){expect(plan.stages.find(s=>s.id==='assets')?.dependsOn).toContain('blockout');expect(plan.commonChecks).toContain('spatial-3.5');}
});
test('weights, engine and model have immutable plan and per-stage identities; object key order does not',()=>{
 const a=compilePipelinePlan({pipelinePreset:'effects'},context)!;
 expect(compilePipelinePlan({pipelinePreset:'effects',scoreWeights:Object.fromEntries(Object.entries(a.weights).reverse())},context)?.id).toBe(a.id);
 const b=compilePipelinePlan({pipelinePreset:'effects',scoreWeights:{...a.weights,lighting:30,readability:10}},context)!;
 expect(b.id).not.toBe(a.id);expect(b.stages.find(s=>s.id==='repair')?.contractId).not.toBe(a.stages.find(s=>s.id==='repair')?.contractId);
 expect(compilePipelinePlan({pipelinePreset:'effects'},{...context,engineSha:'x'})?.id).not.toBe(a.id);
});
test('asset focus consumes actual subjects and contacts rather than scene-name words',()=>{
 const ranked=[{brief:{id:'ground'},index:0,priority:10},{brief:{id:'main'},index:1,priority:1}];
 const layout={program:{instances:[{id:'g',template:'ground'},{id:'s',template:'main'}]},entities:[{instanceId:'s',role:'subject'}]};
 const assets=prioritizePipelineAssets(ranked,layout,{pipelinePlan:compilePipelinePlan({pipelinePreset:'assets'},context)});
 expect(assets[0].brief.id).toBe('main');expect(assets[0].pipelinePriority.subject).toBe(true);expect(prioritizePipelineAssets(ranked,layout,{})).toBe(ranked);
});
test('repair order consumes weighted measured deficit and keeps missing critical requirements first',()=>{
 const p=compilePipelinePlan({pipelinePreset:'effects'},context)!;
 const goals={summary:'实际差距',goals:[{id:'surface',dimension:'material',kind:'surface',requirementIds:['R2']},{id:'light',dimension:'lighting',kind:'lighting',requirementIds:['R2']},{id:'structure',dimension:'spatial',kind:'layout',requirementIds:['R1']}]};
 const review={dimensions:[{id:'material',score:2},{id:'lighting',score:2},{id:'spatial',score:4}],requirements:[{id:'R1',verdict:'missing'}]};
 const plan={requirements:[{id:'R1',critical:true},{id:'R2',critical:false}]};
 expect(prioritizePipelineRepairs(goals,{pipelinePlan:p},review,plan).goals.map(g=>g.id)).toEqual(['structure','light','surface']);
});

test('spatial allocation uses actual aId/bId contacts and detailed execution freezes sequential surface',()=>{
 const p=compilePipelinePlan({pipelinePreset:'spatial'},context)!;
 const ranked=[{brief:{id:'other'},index:0,priority:10},{brief:{id:'support'},index:1,priority:1}];
 const layout={program:{instances:[{id:'o',template:'other'},{id:'s',template:'support'}]},spatialContacts:[{aId:'s',bId:'roof',aLocal:[0,1,0],bLocal:[0,-1,0]}]};
 expect(prioritizePipelineAssets(ranked,layout,{pipelinePlan:p})[0].brief.id).toBe('support');
 const detailed=compilePipelinePlan({pipelinePreset:'assets',matchingLevel:'detailed'},context)!;
 expect(detailed.resources.parallelSurface).toBe(false);expect(detailed.stages.find(s=>s.id==='surface')?.dependsOn).toEqual(['blockout']);
});
