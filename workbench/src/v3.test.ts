import {test,expect} from 'bun:test';
import {validateGroundedPlan,evidenceSpans} from './grounding';
import {validateIR,solveIR,compileIR,applyPatches} from './scene-ir';
import {validateRecipe,bounds} from './recipe';
import {analyzeRun} from './runtime-metrics.mjs';
import {specGate,VISUAL_RULE_IDS} from './spec';
const plan={name:'garden',summary:'garden',capabilities:['mapping','consistency'],requirements:[{id:'plant',text:'blue pot',critical:true,weight:5,source:'prompt',evidence:'blue pot',count:null}]};
const entity=(id:string,kind:string,role='context')=>({id,kind,label:id,role,position:[0,0,0],size:kind==='potted_plant'?[5,5,10]:[2,2,3],color:'#245ba0',accent:'#318b44',rotation:0,requirementIds:['plant']});
const input={name:'garden',entities:[entity('plant','potted_plant','subject'),entity('deck1','platform'),entity('deck2','platform')],relations:[{type:'around',target:'plant',subjects:['deck1','deck2'],radius:6}]};
test('an image cannot fabricate a hard exact count or a prompt quotation',()=>{expect(validateGroundedPlan(structuredClone(plan),'blue pot')).toBeTruthy();let p=structuredClone(plan);p.requirements[0]={...p.requirements[0],source:'image',count:6} as any;expect(()=>validateGroundedPlan(p,'blue pot')).toThrow();expect(()=>validateGroundedPlan(plan,'red pot')).toThrow()});
test('semantic instances remain distinct from parts; solver enforces spacing',()=>{const {ir,structure}=solveIR(validateIR(input,plan));const recipe=validateRecipe(compileIR(ir),plan);expect(structure.semanticCounts.platform).toBe(2);expect(recipe.objects.filter((o:any)=>o.entityId==='plant').length).toBeGreaterThan(10);expect(structure.passed).toBe(true);expect(solveIR({...input,relations:[{...input.relations[0],radius:1}]}).structure.passed).toBe(false)});
test('local patches cannot edit requirements or undeclared entities',()=>{expect(()=>applyPatches(input,[{id:'missing',field:'color',value:'#000000'}])).toThrow();expect(()=>applyPatches(input,[{id:'plant',field:'requirementIds',value:[]}])).toThrow();expect(applyPatches(input,[{id:'plant',field:'color',value:'#aa2233'}]).entities[0].color).toBe('#aa2233')});
test('changed screenshots cannot turn a stationary camera into motion evidence',()=>{const s={position:[10,5,10],target:[0,2,0],frames:20,parts:[{id:'p',loaded:true}],frameTimes:Array(600).fill(16.67)};const a={camera:{radius:10},landmarks:[{role:'subject',position:[0,2,0],size:[3,3,4]},{role:'context',position:[5,1,2],size:[2,2,2]}]};const r=analyzeRun(Array.from({length:6},()=>structuredClone(s)),a);expect(r.hard.cameraMotion).toBe(false);expect(r.hard.nonFlat).toBe(true);expect(analyzeRun(Array.from({length:6},()=>({...s,parts:[]})),{...a,parts:[{id:'p'}]}).hard.entitiesLoaded).toBe(false);s.parts[0].loaded=false;expect(analyzeRun(Array.from({length:6},()=>s),a).hard.nonFlat).toBe(false)});
test('high quality cannot waive missing or failed production rules',()=>{const runtime={images:['view-1.png'],hard:{hudToggle:true,cameraMotion:true,nonFlat:true,noErrors:true,frameRate:true},subjectMeasurement:{safeFraming:true}};const r={specRules:VISUAL_RULE_IDS.map(id=>({id,status:'passed',reason:'observed',frames:['view-1.png']}))};expect(specGate(r,runtime,plan,{passed:true}).status).toBe('passed');r.specRules.find(r=>r.id==='S09')!.frames=[];expect(specGate(r,runtime,plan,{passed:true}).status).toBe('passed');const noEvidence=structuredClone(r);noEvidence.specRules.find(r=>r.id==='S10')!.frames=[];expect(()=>specGate(noEvidence,runtime,plan,{passed:true})).toThrow();r.specRules.find(r=>r.id==='S14')!.status='failed';expect(specGate(r,runtime,plan,{passed:true}).status).toBe('failed');expect(()=>specGate({specRules:[]},runtime,plan,{passed:true})).toThrow()});

test('abbreviated quotations must resolve to ordered exact source spans',()=>{expect(evidenceSpans('保持可环绕观察的...三维场景','保持可环绕观察的低多边形三维场景')).toEqual(['保持可环绕观察的','三维场景']);expect(()=>evidenceSpans('蓝色...植物','红色植物')).toThrow();expect(()=>evidenceSpans('植物...红色','红色植物')).toThrow()});

test('camera framing keeps tall foreground platforms inside the recording viewport',()=>{
 const ir=structuredClone(input);ir.entities.push(entity('deck3','platform'),entity('deck4','platform'));ir.relations[0].subjects=['deck1','deck2','deck3','deck4'];for(const e of ir.entities)if(e.kind==='platform')e.size=[3,3,6];const recipe=compileIR(solveIR(ir).ir),b=bounds(recipe);
 const samples=Array.from({length:32},(_,i)=>({position:[b.center[0]+Math.cos(i*Math.PI/16)*b.radius,b.center[1]+b.height,b.center[2]+Math.sin(i*Math.PI/16)*b.radius],target:b.center,parts:recipe.objects.map((o:any)=>({id:o.id,loaded:true})),frames:i*100,frameTimes:Array(100).fill(16.7)}));
 const landmarks=recipe.objects.map((o:any)=>({position:[o.position[0],o.position[2]+o.size[2]/2,-o.position[1]],size:o.size,role:o.role}));expect(analyzeRun(samples,{camera:b,parts:recipe.objects,landmarks}).hard.framing).toBe(true);const close=samples.map(s=>({...s,position:[s.position[0]*.58,s.position[1],s.position[2]*.58]}));expect(analyzeRun(close,{camera:b,parts:recipe.objects,landmarks}).hard.framing).toBe(false);
});

test('quotation punctuation is accepted only around an exact source span',()=>{
 expect(evidenceSpans('“红白灯塔”','一个红白灯塔')).toEqual(['红白灯塔']);
 expect(()=>evidenceSpans('“蓝白灯塔”','一个红白灯塔')).toThrow();
});
