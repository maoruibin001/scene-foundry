import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,rmSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createSpaceConstruction,spaceSkeletonSchema,spaceConstructionPrompt,SPACE_CONSTRUCTION,SPACE_CONSTRUCTION_GROUPED,selectedSpaceValue} from './space-construction';
import {validateSpace} from './layout-stages';
import {completeObservedSpacePlan} from './reference-observations';
import {assertRoleTools} from '../codex-tools';
import {savedStage,persistStageReuse} from './saved-stage';
import {modelTimeoutPolicy} from '../model-selection';
import {digest,read,save,runDir} from '../store';

const body=(v:any)=>JSON.parse(v.content[0].text);
const lattice={version:'voxel-lattice-v1',cellSize:.25,origin:[0,0,0]};
const instance=(id:string,i=0,template='shape')=>({id,label:'构件'+id,template,position:[0,i*.25,0],rotation:[0,0,0],scale:[1,1,1],requirementIds:['objects']});
const entity=(instanceId:string)=>({instanceId,role:'subject',category:'构件'});
function fixture(extraLandmarks:any[]=[]){
 const root=mkdtempSync(join(tmpdir(),'space-grouped-test-')),folder=join(root,'space-construction'),signal=new AbortController(),jobId=randomUUID();
 const plan={requirements:[{id:'objects',critical:true,count:2}]};
 const observation={landmarks:[{id:'near',label:'近构件',geometryScope:'object',critical:true},{id:'far',label:'远构件',geometryScope:'object',critical:true},{id:'gap',label:'构件间通道',geometryScope:'void',critical:false},...extraLandmarks],
  relations:[{id:'depth',description:'近构件在远构件前',critical:true,landmarkIds:['near','far']}]};
 const skeleton:any={version:'scene-space-skeleton-v1',voxelLattice:lattice,program:{version:'geometry-v1',name:'通用空间',templates:[{id:'shape',label:'构件',description:'有真实开口的立体构件',origin:'底面中心，Z向上',bounds:{min:[-.5,-.5,0],max:[.5,.5,1]},maxParts:4}]},
  cameras:[{name:'参考机位',referenceIndex:1,position:[4,-6,3],target:[0,1,0],fov:1},{name:'检查机位',referenceIndex:null,position:[-4,6,3],target:[0,1,0],fov:1}],assumptions:['背面为推断']};
 const near={groupId:'near-group',landmarkIds:['near','gap'],instances:[instance('one')],entities:[entity('one')],observedBindings:[{landmarkId:'near',instanceIds:['one']},{landmarkId:'gap',instanceIds:['one']}]};
 const far={groupId:'far-group',landmarkIds:['far'],instances:[instance('two',4)],entities:[entity('two')],observedBindings:[{landmarkId:'far',instanceIds:['two']}]};
 const validate=(v:any)=>validateSpace(completeObservedSpacePlan(v,observation),plan,1,'simple',{strictVoxel:true});
 const options={folder,jobId,rootJobId:jobId,inputKey:digest('grouped frozen input'),requirementIds:['objects'],signal:signal.signal,strictVoxel:true,observation,validate};
 const create=(extra:any={})=>createSpaceConstruction({...options,...extra});
 const sha=(tool:any)=>tool.summary().draftSha256;
 const putSkeleton=(tool:any,value=skeleton)=>tool.kit.call('save_space_skeleton',{expectedDraftSha256:sha(tool),skeletonJson:JSON.stringify(value)});
 const putGroup=(tool:any,value:any)=>tool.kit.call('save_space_component_group',{expectedDraftSha256:sha(tool),groupJson:JSON.stringify(value)});
 const removeGroup=(tool:any,groupId:string)=>tool.kit.call('remove_space_component_group',{expectedDraftSha256:sha(tool),groupId});
 const put=(tool:any,section:string,value:any)=>tool.kit.call('save_space_constraints',{expectedDraftSha256:sha(tool),section,itemsJson:JSON.stringify(value)});
 const finish=async(tool:any)=>{await putSkeleton(tool);await putGroup(tool,near);await putGroup(tool,far);await put(tool,'spatialOpenings',[]);await put(tool,'spatialContacts',[]);return {selectedSpaceSha256:tool.summary().spaceSha256,reason:'全部分组完成，等待真实灰模验收'};};
 return {root,folder,plan,observation,skeleton,near,far,options,validate,create,putSkeleton,putGroup,removeGroup,put,finish,clean:()=>rmSync(root,{recursive:true,force:true})};
}

test('strict voxel space uses grouped checkpoints; the derived core equals a hand-assembled one',async()=>{
 const f=fixture();try{
  const schema=spaceSkeletonSchema(['objects'],{strictVoxel:true});
  expect(schema.properties.entities).toBeUndefined();expect(schema.properties.observedBindings).toBeUndefined();expect(schema.properties.program.properties.instances).toBeUndefined();
  const tool=f.create();expect(tool.kit.version).toBe(SPACE_CONSTRUCTION_GROUPED);
  expect(spaceConstructionPrompt(tool.kit.instructions,tool.kit.version)).toContain('save_space_component_group');
  expect(()=>assertRoleTools('scene-space',tool.kit)).not.toThrow();
  expect(()=>assertRoleTools('scene-space',{...tool.kit,definitions:[...tool.kit.definitions,{name:'save_space_core',description:'',inputSchema:{}}]})).toThrow();
  // Checkpointed construction gets the tool-call timer (recorded calls ran 12–14 minutes); the stage recovery budget still caps it.
  expect(modelTimeoutPolicy('high','scene-space',0,3600000,SPACE_CONSTRUCTION_GROUPED)).toEqual(modelTimeoutPolicy('high','scene-refine',0,3600000,SPACE_CONSTRUCTION_GROUPED));
  await expect(f.putGroup(tool,f.near)).rejects.toThrow('先保存骨架');
  await f.putSkeleton(tool);await f.putGroup(tool,f.near);
  let summary=tool.summary();expect(summary.remainingLandmarkIds).toEqual(['far']);expect(summary.remainingRequiredComponents.map((r:any)=>r.landmarkId)).toEqual(['far']);
  expect(summary.instanceBudget).toEqual({used:1,maximum:64,reservedForRemaining:1});expect(summary.saved.core).toBe(false);
  expect(JSON.parse(tool.kit.continuation!().text).remainingLandmarkIds).toEqual(['far']);
  await expect(f.put(tool,'spatialOpenings',[])).rejects.toThrow('剩余 far');
  await f.putGroup(tool,f.far);summary=tool.summary();expect(summary.saved.core).toBe(true);expect(summary.remainingLandmarkIds).toEqual([]);
  const data=body(await tool.kit.call('inspect_space_draft',{}));expect(data.data.groups.map((g:any)=>g.groupId)).toEqual(['near-group','far-group']);
  await f.put(tool,'spatialOpenings',[]);await f.put(tool,'spatialContacts',[]);
  const value=tool.kit.resolveOutput!({selectedSpaceSha256:tool.summary().spaceSha256,reason:'完整'});
  const {version:_v,...rest}=f.skeleton;
  const expected=f.validate({...rest,version:'scene-space-plan-v2',program:{...f.skeleton.program,instances:[instance('one'),instance('two',4)]},entities:[entity('one'),entity('two')],
   observedBindings:[{landmarkId:'near',instanceIds:['one']},{landmarkId:'far',instanceIds:['two']},{landmarkId:'gap',instanceIds:['one']}],spatialOpenings:[],spatialContacts:[]});
  expect(value).toEqual(expected);expect(value.voxelLattice).toEqual(lattice);expect(tool.summary().writes).toBe(5);
  expect(read(join(f.folder,'selected.json')).version).toBe(SPACE_CONSTRUCTION_GROUPED);
 }finally{f.clean();}
});

test('one group save reports every cumulative conflict and preserves the prior checkpoint',async()=>{
 const f=fixture();try{
  const tool=f.create();await f.putSkeleton(tool);await f.putGroup(tool,f.near);
  const file=join(f.folder,'checkpoint.json'),before=readFileSync(file),writes=tool.summary().writes;
  const bad={groupId:'far-group',landmarkIds:['far','near','ghost'],instances:[instance('one',2),instance('three',2,'missing')],entities:[entity('one')],
   observedBindings:[{landmarkId:'far',instanceIds:['one']},{landmarkId:'near',instanceIds:['one']},{landmarkId:'ghost',instanceIds:['one']}]};
  const error=await f.putGroup(tool,bad).then(()=>null,(e:any)=>String(e.message));
  expect(error).toContain('已列出全部问题');
  for(const part of ['未知原图地标 ghost','地标 near 已属于组 near-group','实例 one 已由组 near-group 创建','不存在的模板 missing','entities须与本组实例一一对应','新实例 three 未被本组任何地标绑定'])expect(error).toContain(part);
  expect(readFileSync(file).equals(before)).toBe(true);expect(tool.summary().writes).toBe(writes);
  // Ownership: a critical object that only aliases another object's instance is reported in the same structured way as the final gate.
  const alias={groupId:'far-group',landmarkIds:['far'],instances:[],entities:[],observedBindings:[{landmarkId:'far',instanceIds:['one']}]};
  const ownership=await f.putGroup(tool,alias).then(()=>null,(e:any)=>String(e.message));
  expect(ownership).toContain('semanticOwnershipViolations');expect(ownership).toContain('"landmarkId":"far"');expect(ownership).toContain('create-independent-object');
  const lattice=await f.putGroup(tool,{...f.far,instances:[{...instance('two'),position:[0,.1,0]}]}).then(()=>null,(e:any)=>String(e.message));
  expect(lattice).toContain('VOXEL_LATTICE');expect(readFileSync(file).equals(before)).toBe(true);
 }finally{f.clean();}
});

test('cumulative instance cap reserves one exclusive instance for every uncovered critical component',async()=>{
 const extra=Array.from({length:3},(_,i)=>({id:'part'+i,label:'附着组件'+i,geometryScope:'component',critical:true}));
 const f=fixture(extra);try{
  // One part per template keeps the expanded asset budget out of this instance-cap check.
  const small=structuredClone(f.skeleton);small.program.templates[0].maxParts=1;
  const tool=f.create();await f.putSkeleton(tool,small);
  const filler=(id:string,i:number)=>({...instance(id,i),requirementIds:[]});
  const many=(n:number)=>{const ids=Array.from({length:n},(_,i)=>'n'+i);return {groupId:'near-group',landmarkIds:['near'],instances:ids.map((id,i)=>i<2?instance(id,i):filler(id,i%8)),entities:ids.map(entity),observedBindings:[{landmarkId:'near',instanceIds:ids}]};};
  // 4 critical object/component landmarks stay uncovered: 61 + 4 exceeds 64.
  const over=await f.putGroup(tool,many(61)).then(()=>null,(e:any)=>String(e.message));expect(over).toContain('实例预算不足');expect(over).toContain('至少还需 4');
  expect(String(await f.putGroup(tool,many(65)).then(()=>null,(e:any)=>e.message))).toContain('最多64');
  await f.putGroup(tool,many(60));expect(tool.summary().instanceBudget).toEqual({used:60,maximum:64,reservedForRemaining:4});
  // A void group binding existing instances does not consume the reserve.
  await f.putGroup(tool,{groupId:'gap-group',landmarkIds:['gap'],instances:[],entities:[],observedBindings:[{landmarkId:'gap',instanceIds:['n0']}]});
  for(const [i,id] of ['far','part0','part1','part2'].entries())await f.putGroup(tool,{groupId:id+'-group',landmarkIds:[id],instances:[filler('x'+i,i)],entities:[entity('x'+i)],observedBindings:[{landmarkId:id,instanceIds:['x'+i]}]});
  expect(tool.summary().instanceBudget.used).toBe(64);expect(tool.summary().saved.core).toBe(true);
 }finally{f.clean();}
});

test('skeleton changes keep compatible groups, drop invalidated groups explicitly, and clear constraints',async()=>{
 const f=fixture();try{
  const tool=f.create();await f.finish(tool);expect(tool.summary().complete).toBe(true);
  await f.putSkeleton(tool,{...f.skeleton,assumptions:['背面为推断','补充假设']});
  let s=tool.summary();expect(s.saved).toEqual({skeleton:true,groups:2,core:true,spatialOpenings:false,spatialContacts:false});
  const renamed=structuredClone(f.skeleton);renamed.program.templates[0].id='renamed';
  const reply=body(await f.putSkeleton(tool,renamed));expect(reply.droppedGroupIds).toEqual(['near-group','far-group']);
  s=tool.summary();expect(s.saved.groups).toBe(0);expect(s.remainingLandmarkIds).toEqual(['near','far','gap']);
 }finally{f.clean();}
});

test('removal cannot leave dangling references; identical saves consume no write; replacement by groupId',async()=>{
 const f=fixture();try{
  const tool=f.create();await f.putSkeleton(tool);await f.putGroup(tool,f.far);
  await f.putGroup(tool,{groupId:'gap-group',landmarkIds:['gap'],instances:[],entities:[],observedBindings:[{landmarkId:'gap',instanceIds:['two']}]});
  const before=readFileSync(join(f.folder,'checkpoint.json'));
  await expect(f.removeGroup(tool,'far-group')).rejects.toThrow('引用不存在或已移除的实例 two');expect(readFileSync(join(f.folder,'checkpoint.json')).equals(before)).toBe(true);
  const writes=tool.summary().writes;expect(body(await f.putGroup(tool,f.far)).unchanged).toBe(true);expect(body(await f.putSkeleton(tool)).unchanged).toBe(true);expect(tool.summary().writes).toBe(writes);
  await f.putGroup(tool,{...f.far,instances:[instance('two',2)]});expect(tool.summary().groups.length).toBe(2);expect(tool.summary().writes).toBe(writes+1);
  await f.removeGroup(tool,'gap-group');expect(tool.summary().groups.map((g:any)=>g.groupId)).toEqual(['far-group']);
  await expect(f.removeGroup(tool,'gap-group')).rejects.toThrow('组件组不存在');
 }finally{f.clean();}
});

test('reconstruction resumes grouped state; an interrupted v1 checkpoint keeps its original contract; tampering fails closed',async()=>{
 const f=fixture();try{
  let tool=f.create();await f.putSkeleton(tool);await f.putGroup(tool,f.near);
  tool=f.create();expect(tool.summary().groups.map((g:any)=>g.groupId)).toEqual(['near-group']);
  const file=join(f.folder,'checkpoint.json'),row=read(file);save(file,{...row,writes:row.writes+1});expect(()=>f.create()).toThrow();
 }finally{f.clean();}
 const g=fixture();try{
  const legacy=createSpaceConstruction({...g.options,observation:undefined});expect(legacy.kit.version).toBe(SPACE_CONSTRUCTION);
  const core={version:'scene-space-core-v1',voxelLattice:lattice,program:{...g.skeleton.program,instances:[instance('one'),instance('two',4)]},entities:[entity('one'),entity('two')],cameras:g.skeleton.cameras,
   observedBindings:[{landmarkId:'near',instanceIds:['one']},{landmarkId:'far',instanceIds:['two']},{landmarkId:'gap',instanceIds:['one']}],assumptions:g.skeleton.assumptions};
  await legacy.kit.call('save_space_core',{expectedDraftSha256:legacy.summary().draftSha256,coreJson:JSON.stringify(core)});
  expect(g.create().kit.version).toBe(SPACE_CONSTRUCTION);
 }finally{g.clean();}
});

test('grouped selection follows same-input recovery and normalizes to canonical space',async()=>{
 const f=fixture(),sourceId=randomUUID(),nextId=randomUUID(),sourceDir=join(runDir(sourceId),'generation'),target=join(runDir(nextId),'generation');
 try{
  mkdirSync(sourceDir,{recursive:true});mkdirSync(target,{recursive:true});
  const job={id:sourceId,executionRecoveryRoot:sourceId,reuseMode:'fresh',prompt:'同一原图',images:[{id:'reference'}],modelSettings:{model:'fixture'},plan:f.plan};save(join(runDir(sourceId),'job.json'),job);
  const tool=f.create({folder:join(sourceDir,'space-construction'),jobId:sourceId,rootJobId:sourceId}),selection=await f.finish(tool),value=tool.kit.resolveOutput!(selection);
  expect(selectedSpaceValue(sourceDir,selection,{id:sourceId})).toEqual(value);
  save(join(sourceDir,'scene-space-response.txt'),selection);save(join(sourceDir,'scene-space-receipt.json'),{requestedModel:'fixture',toolsContract:SPACE_CONSTRUCTION_GROUPED,stopReason:'completed'});
  const ctx={job:{...job,id:nextId,recoverySourceJobId:sourceId},plan:f.plan,dir:target};
  const saved=savedStage(ctx,'scene-space',f.validate)!;expect(saved.value).toEqual(value);persistStageReuse(ctx,'scene-space',saved);
  const receipt=read(join(target,'scene-space-receipt.json'));expect(receipt.kind).toBe('reused-canonical-space');expect(receipt.sourceToolsContract).toBe(SPACE_CONSTRUCTION_GROUPED);
  expect(existsSync(join(target,'scene-space-reuse.json'))).toBe(true);
 }finally{f.clean();for(const id of [sourceId,nextId])rmSync(runDir(id),{recursive:true,force:true});}
});
