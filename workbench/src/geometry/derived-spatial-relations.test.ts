import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {completeObservedSpacePlan} from './reference-observations';
import {spaceSchema,spacePlanningSchema,validateSpace} from './layout-stages';
import {modelSchema} from '../model-schema';
import {stageContract} from '../stage-contract';
import {callValidated} from '../contracts';
import {savedStage,persistStageReuse} from './saved-stage';
import {runDir,save,read} from '../store';

const observation=()=>({landmarks:[{id:'near'},{id:'far'}],relations:[
 {id:'depth',description:'近物位于远物前方',critical:true,landmarkIds:['near','far']},
 {id:'group',description:'两处观察包含同一近物',critical:false,landmarkIds:['far','near']}
]});
const plan={requirements:[{id:'objects',critical:true,count:2}]};
function compact():any{return {version:'scene-space-plan-v2',program:{version:'geometry-v1',name:'共享观察布局',templates:[{id:'shape',label:'构件',description:'完整立体轮廓',origin:'底面中心，Z向上',bounds:{min:[-.5,-.5,0],max:[.5,.5,1]},maxParts:4}],instances:['one','two'].map((id,i)=>({id,label:'构件'+i,template:'shape',position:[0,i*2,0],rotation:[0,0,0],scale:[1,1,1],requirementIds:['objects']}))},entities:['one','two'].map(id=>({instanceId:id,role:'subject',category:'构件'})),cameras:[{name:'参考机位',referenceIndex:1,position:[4,-6,3],target:[0,1,0],fov:1},{name:'检查机位',referenceIndex:null,position:[-4,6,3],target:[0,1,0],fov:1}],observedBindings:[{landmarkId:'near',instanceIds:['one']},{landmarkId:'far',instanceIds:['one','two']}],spatialOpenings:[],spatialContacts:[],assumptions:['背面为推断']};}
const validate=(value:any)=>validateSpace(completeObservedSpacePlan(value,observation()),plan,1,'simple');

test('compact planning removes only derived relations; canonical and repair contracts stay unchanged',()=>{
 const full=spaceSchema(['objects']),small=spacePlanningSchema(['objects']);
 expect(small.properties.version.enum).toEqual(['scene-space-plan-v2']);
 expect(small.properties).not.toHaveProperty('spatialRelations');expect(small.required).not.toContain('spatialRelations');
 expect(small.required).toContain('observedBindings');
 const expected=structuredClone(full);expected.properties.version.enum=['scene-space-plan-v2'];delete expected.properties.spatialRelations;expected.required=expected.required.filter((k:string)=>k!=='spatialRelations');
 expect(small).toEqual(expected);
 expect(modelSchema('scene-space',{requirementIds:['objects'],derivedSpatialRelations:true})).toEqual(small);
 expect(modelSchema('scene-space',{requirementIds:['objects']})).toEqual(full);
 expect(modelSchema('scene-space',{grayboxRepair:true,derivedSpatialRelations:true})).toEqual(modelSchema('scene-space',{grayboxRepair:true}));
});

test('materialization preserves frozen relations, deduplicates shared instances and does not mutate inputs',()=>{
 const value=compact(),observed=observation(),before=JSON.stringify({value,observed});
 const result=completeObservedSpacePlan(value,observed);
 expect(result.version).toBe('scene-space-v1');
 expect(result.spatialRelations).toEqual([{id:'depth',description:'近物位于远物前方',critical:true,instanceIds:['one','two']},{id:'group',description:'两处观察包含同一近物',critical:false,instanceIds:['one','two']}]);
 for(const field of ['program','entities','cameras','spatialOpenings','spatialContacts','assumptions','observedBindings'])expect(result[field]).toBe(value[field]);
 expect(JSON.stringify({value,observed})).toBe(before);expect(validateSpace(result,plan,1,'simple')).toBe(result);
});

test('compact output cannot replace a frozen relation or introduce unsupported versions',()=>{
 expect(()=>completeObservedSpacePlan({...compact(),spatialRelations:[]},observation())).toThrow('不能覆盖');
 expect(()=>completeObservedSpacePlan({...compact(),version:'unknown'},observation())).toThrow('版本');
 for(const relations of [[],[{...observation().relations[0],critical:'false'}],[{...observation().relations[0],landmarkIds:['invented']}]] )expect(()=>completeObservedSpacePlan(compact(),{...observation(),relations})).toThrow();
});

test('missing, unknown and duplicate bindings cannot remove observed evidence or invent instances',()=>{
 for(const change of [
  (v:any)=>v.observedBindings.pop(),
  (v:any)=>v.observedBindings[0].instanceIds=[],
  (v:any)=>v.observedBindings[0].instanceIds=['not_in_layout'],
  (v:any)=>v.observedBindings[1].landmarkId='near',
  (v:any)=>v.program.instances.push({...v.program.instances[0],id:'invented'}),
 ]){const value=compact();change(value);expect(()=>completeObservedSpacePlan(value,observation())).toThrow();}
});

test('legacy saved records remain unchanged and must still prove their original critical constraints',()=>{
 const legacy=validate(compact());expect(completeObservedSpacePlan(legacy,observation())).toBe(legacy);
 for(const change of [
  (v:any)=>v.spatialRelations.pop(),
  (v:any)=>v.spatialRelations[0].critical=false,
  (v:any)=>v.spatialRelations[0].description='changed',
  (v:any)=>v.spatialRelations[0].instanceIds=['one'],
 ]){const value=structuredClone(legacy);change(value);const before=JSON.stringify(value);expect(()=>completeObservedSpacePlan(value,observation())).toThrow();expect(JSON.stringify(value)).toBe(before);}
});

test('derived relations cannot bypass coordinate, requirement or camera validation',()=>{
 for(const change of [
  (v:any)=>v.program.instances[0].position=[101,0,0],
  (v:any)=>v.program.instances[0].requirementIds=[],
  (v:any)=>v.cameras[0].referenceIndex=null,
 ]){const value=compact();change(value);expect(()=>validate(value)).toThrow();}
});

test('normal validated call exposes canonical space while preserving the raw compact response',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'derived-space-call-')),value=compact();let calls=0;
 try{
  const result=await callValidated({role:'scene-space',system:'测试',text:'固定观察',schemaContext:{derivedSpatialRelations:true},signal:new AbortController().signal} as any,dir,validate,async()=>{calls++;return {value,text:JSON.stringify(value),receipt:{fixture:true}} as any;});
  expect(calls).toBe(1);expect(result.value.version).toBe('scene-space-v1');expect(result.value.spatialRelations).toHaveLength(2);expect(JSON.parse(result.text).version).toBe('scene-space-plan-v2');
  expect(read(join(dir,'scene-space-attempts.json'))[0].status).toBe('passed');
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('saved compact response recovers only along the same input root and is not overwritten as legacy output',()=>{
 const root=randomUUID(),dest=randomUUID(),dir=join(runDir(root),'generation'),target=join(runDir(dest),'generation');
 const job={id:root,executionRecoveryRoot:root,reuseMode:'fresh',prompt:'同一原图',images:[{id:'image'}],modelSettings:{model:'fixture'},plan};
 const ctx={job:{...job,id:dest,recoverySourceJobId:root},plan,dir:target};
 try{
  mkdirSync(dir,{recursive:true});mkdirSync(target,{recursive:true});save(join(runDir(root),'job.json'),job);save(join(dir,'scene-space-response.txt'),compact());save(join(dir,'scene-space-receipt.json'),{requestedModel:'fixture'});
  const before=readFileSync(join(dir,'scene-space-response.txt'),'utf8'),saved=savedStage(ctx,'scene-space',validate)!;
  expect(saved.value.version).toBe('scene-space-v1');expect(saved.value.spatialRelations).toHaveLength(2);persistStageReuse(ctx,'scene-space',saved);
  expect(read(join(target,'scene-space-response.txt')).version).toBe('scene-space-plan-v2');expect(readFileSync(join(dir,'scene-space-response.txt'),'utf8')).toBe(before);
  expect(savedStage({...ctx,job:{...ctx.job,executionRecoveryRoot:dest}},'scene-space',validate)).toBeNull();
 }finally{rmSync(runDir(root),{recursive:true,force:true});rmSync(runDir(dest),{recursive:true,force:true});}
});

test('compact and legacy planning cannot share a validated cache contract',()=>{
 const legacy={role:'scene-space',schemaContext:{requirementIds:['objects']}},compact={...legacy,schemaContext:{...legacy.schemaContext,derivedSpatialRelations:true}};
 expect(stageContract(legacy)).not.toBe(stageContract(compact));expect(stageContract(legacy)).toBe(stageContract(legacy));
});
