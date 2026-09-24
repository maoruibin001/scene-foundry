import {supportEvidence} from './spatial';
import {test,expect} from 'bun:test';
import {overlap,contained,inspectGeometry} from './spatial';
import {solveIR,compileIR} from './scene-ir';
import {calibrationGate} from './calibration';
import {assess} from './assessment';
import {HARD_CHECKS,DIMENSIONS,DEFAULT_POLICY,batchGate} from './quality';
import {VISUAL_RULE_IDS} from './spec';
const entity=(id:string,x=0,z=0)=>({id,label:id,kind:'box',role:'subject',position:[x,0,z],size:[2,2,2],rotation:0,color:'#668855',accent:'#889955',requirementIds:['r1']});
test('rotated exact boxes collide but adjacent surfaces do not',()=>{expect(overlap(entity('a'),entity('b',1))).toBe(true);expect(overlap(entity('a'),entity('b',2))).toBe(false);expect(overlap(entity('a'),{...entity('b',2.2),rotation:Math.PI/4})).toBe(true);expect(overlap(entity('a'),entity('b',0,2))).toBe(false);});
test('support rejects floating and overhanging independent objects',()=>{const ground={...entity('ground',0,-1),kind:'ground',role:'ground',size:[4,4,1]};for(const [x,z] of [[0,2],[3,0]]){const ir={name:'support',entities:[ground,entity('a',x,z)],relations:[]};expect(inspectGeometry(ir,compileIR(ir)).passed).toBe(false);}expect(contained(entity('a',0,0),ground)).toBe(true);});
test('assembling parts is allowed but different solid assets must not intersect',()=>{const ir={name:'collision',entities:[entity('a'),entity('b',.5)],relations:[]};expect(solveIR(ir).structure.passed).toBe(false);const p={...entity('p'),kind:'platform'};expect(solveIR({entities:[p],relations:[]}).structure.passed).toBe(true);});
const cert=()=>({profileId:'v4',cases:Array.from({length:12},(_,i)=>({id:''+i,evidenceDigest:'e'+i,reviewDigest:'r'+i,expected:i<6?'passed':'failed',predicted:i<6?'passed':'failed',reviewerKind:'human',reviewedBy:'unit-test fixture only',reviewedAt:'2026-09-22',reason:'known fixture'}))});
test('calibration requires distinct evidence, human labels and evaluator version',()=>{expect(calibrationGate(cert(),{id:'v4'}).status).toBe('certified');expect(calibrationGate(cert(),{id:'v5'}).status).toBe('unverified');const c=cert();c.cases[6].predicted='passed';expect(calibrationGate(c,{id:'v4'}).falseAccepts).toBe(1);expect(calibrationGate(c,{id:'v4'}).status).toBe('unverified');c.cases[0].reviewerKind='agent';expect(calibrationGate(c,{id:'v4'}).status).toBe('unverified');});
test('a perfect batch without calibration cannot become usable',()=>{const cases=Array.from({length:90},(_,i)=>({id:''+i,mode:['prompt','image','image_prompt'][i%3]})),jobs=cases.map(c=>({batchId:'b',caseId:c.id,status:'passed',attempt:1,profile:{id:'v4'}}));expect(batchGate({id:'b',cases,profile:{id:'v4'}},jobs).status).toBe('unverified');expect(batchGate({id:'b',cases,profile:{id:'v4'},calibration:cert()},jobs).status).toBe('usable');jobs[0].profile.id='changed';expect(batchGate({id:'b',cases,profile:{id:'v4'},calibration:cert()},jobs).passed).toBe(89);});
const j:any={plan:{requirements:[{id:'r1',critical:true,weight:5}],capabilities:['consistency']},stages:{build:{status:'passed'},verify:{status:'passed'}},policy:DEFAULT_POLICY,structure:{passed:true,semanticCounts:{box:1}}};
const runtime:any={hard:Object.fromEntries(HARD_CHECKS.map(k=>[k,true])),images:['view-1.png'],submittedFps:60,subjectMeasurement:{safeFraming:true}};
const review:any={confidence:.9,requirements:[{id:'r1',verdict:'met',reason:'shown',frames:['view-1.png']}],dimensions:DIMENSIONS.map(d=>({id:d.id,score:5,reason:'shown',frames:['view-1.png']})),specRules:VISUAL_RULE_IDS.map(id=>({id,status:'passed',reason:'shown',frames:['view-1.png']})),entityCounts:[{kind:'box',visibleMin:1,visibleMax:1}]};
test('historical false-positive regression: 100 cannot override clipped frames',()=>{const result=assess(j,review,{...runtime,hard:{...runtime.hard,framing:false}});expect(result.quality.score).toBe(100);expect(result.status).toBe('failed');expect(result.spec.rules.find((r:any)=>r.id==='S13').status).toBe('failed');});
test('post-review objection survives a new perfect model score',()=>{expect(assess({...j,postReview:{finding:'feet clipped'}},review,runtime).status).toBe('needs_review');expect(assess(j,review,runtime).status).toBe('passed');});

test('ground keeps placement; a horizontal relation moves the supported stack together',()=>{
 const entity=(id:string,kind:string,position:number[],size:number[])=>({id,kind,position,size,label:id,role:kind==='ground'?'ground':kind==='lighthouse'?'subject':'context',color:'#778899',accent:'#335577',rotation:0,requirementIds:[]});
 const ir={name:'stack',entities:[entity('floor','ground',[0,0,-1],[24,24,1]),entity('base','rock',[0,0,0],[6,6,2]),entity('tower','lighthouse',[0,0,2],[2,2,6]),entity('deck','platform',[6,0,0],[2,2,2])],relations:[{type:'on',subjects:['base','deck'],target:'floor'},{type:'on',subjects:['tower'],target:'base'},{type:'leftOf',subjects:['tower'],target:'deck',gap:4}]};
 const result=solveIR(ir),map=new Map(result.ir.entities.map((e:any)=>[e.id,e]));
 expect(map.get('deck').position[0]).toBe(6);expect(map.get('tower').position[0]).toBe(map.get('base').position[0]);expect(result.structure.passed).toBe(true);
 const shifted=structuredClone(ir);shifted.entities.find(e=>e.id==='deck')!.position[0]=8;
 const result2=solveIR(shifted);expect(result2.ir.entities.find((e:any)=>e.id==='base').position[0]).toBe(2);expect(result2.structure.passed).toBe(true);
});

test('repair evidence distinguishes level support from rotated footprint overflow',()=>{
 const parent={id:'ground',position:[0,0,-.4],size:[16,14,.8],rotation:0};
 const child={position:[4.5,5.448361734514798,.4],size:[3,2,2.2],rotation:Math.PI/2+.35};
 const e=supportEvidence(child,parent);expect(Math.abs(e.heightGap)).toBeLessThan(.0001);expect(e.footprintContained).toBe(false);expect(e.requiredSupportSize[1]).toBeGreaterThan(14);
 const enlarged={...parent,size:[Math.max(16,e.requiredSupportSize[0]),e.requiredSupportSize[1],.8]};expect(supportEvidence(child,enlarged).footprintContained).toBe(true);
});
