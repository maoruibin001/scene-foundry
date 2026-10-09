import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,rmSync,readFileSync,writeFileSync,existsSync,renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createSpaceConstruction,spaceCoreSchema,spaceConstructionPrompt,SPACE_CONSTRUCTION,selectedSpaceValue} from './space-construction';
import {spacePlanningSchema,validateSpace} from './layout-stages';
import {completeObservedSpacePlan} from './reference-observations';
import {assertRoleTools,serveCodexTools,withToolContinuation} from '../codex-tools';
import {callValidated} from '../contracts';
import {withProviderRecovery} from '../provider-recovery';
import {savedStage,persistStageReuse} from './saved-stage';
import {modelTimeoutPolicy} from '../model-selection';
import {stageContract} from '../stage-contract';
import {digest,read,save,runDir} from '../store';
import {stable} from '../validated-cache';

const body=(v:any)=>JSON.parse(v.content[0].text);
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'space-checkpoint-test-')),folder=join(root,'space-construction'),signal=new AbortController(),jobId=randomUUID();
 const plan={requirements:[{id:'objects',critical:true,count:2}]};
 const observation={landmarks:[{id:'near'},{id:'far'}],relations:[{id:'depth',description:'近构件在远构件前',critical:true,landmarkIds:['near','far']}]};
 const core:any={version:'scene-space-core-v1',program:{version:'geometry-v1',name:'通用空间',templates:[{id:'shape',label:'构件',description:'有真实开口的立体构件',origin:'底面中心，Z向上',bounds:{min:[-.5,-.5,0],max:[.5,.5,1]},maxParts:4}],instances:['one','two'].map((id,i)=>({id,label:'构件'+i,template:'shape',position:[0,i,0],rotation:[0,0,0],scale:[1,1,1],requirementIds:['objects']}))},entities:['one','two'].map(instanceId=>({instanceId,role:'subject',category:'构件'})),cameras:[{name:'参考机位',referenceIndex:1,position:[4,-6,3],target:[0,1,0],fov:1},{name:'检查机位',referenceIndex:null,position:[-4,6,3],target:[0,1,0],fov:1}],observedBindings:[{landmarkId:'near',instanceIds:['one']},{landmarkId:'far',instanceIds:['two']}],assumptions:['背面为推断']};
 const openings=[{id:'portal',label:'开口',instanceId:'one',center:[0,-.5,.5],normal:[0,1,0],up:[0,0,1],width:.5,height:.5,clearDepth:.5,expectedBeyond:'geometry',beyondDescription:'后方构件',referenceIndices:[1],evidence:'测试参考开口'}];
 const contacts=[{id:'support',label:'相邻连接',kind:'support',aId:'one',bId:'two',points:[[0,.5,.5]],referenceIndices:[1],evidence:'测试可见接触'}];
 const validate=(v:any)=>validateSpace(completeObservedSpacePlan(v,observation),plan,1,'simple');
 const options={folder,jobId,rootJobId:jobId,inputKey:digest('frozen prompt images observations model policy'),requirementIds:['objects'],signal:signal.signal,validate};
 const create=(extra:any={})=>createSpaceConstruction({...options,...extra});
 const putCore=(tool:any,value=core,sha=tool.summary().draftSha256)=>tool.kit.call('save_space_core',{expectedDraftSha256:sha,coreJson:JSON.stringify(value)});
 const put=(tool:any,section:string,value:any,sha=tool.summary().draftSha256)=>tool.kit.call('save_space_constraints',{expectedDraftSha256:sha,section,itemsJson:JSON.stringify(value)});
 const finish=async(tool:any)=>{await putCore(tool);await put(tool,'spatialOpenings',openings);await put(tool,'spatialContacts',contacts);return {selectedSpaceSha256:tool.summary().spaceSha256,reason:'全部声明完成，等待真实灰模验收'};};
 return {root,folder,signal,plan,observation,core,openings,contacts,options,validate,create,putCore,put,finish,clean:()=>rmSync(root,{recursive:true,force:true})};
}

test('core contract removes only construction declarations; tool output does not lower final spatial or timeout gates',()=>{
 const f=fixture();try{
  const expected=spacePlanningSchema(['objects']);expected.properties.version.enum=['scene-space-core-v1'];for(const key of ['spatialOpenings','spatialContacts']){delete expected.properties[key];expected.required=expected.required.filter(k=>k!==key);}
  expected.properties.cameras.items.required=expected.properties.cameras.items.required.filter(k=>!['projection','orthographicHeight'].includes(k));
  expect(spaceCoreSchema(['objects'])).toEqual(expected);const tool=f.create();
  expect(spaceConstructionPrompt(tool.kit.instructions)).not.toContain('不要调用工具');
  expect(spaceConstructionPrompt(tool.kit.instructions)).toContain('验收不通过不会开始资产生成');
  expect(modelTimeoutPolicy('high','scene-space',0,3600000,SPACE_CONSTRUCTION)).toEqual(modelTimeoutPolicy('high','scene-space'));
  expect(modelTimeoutPolicy('high','scene-space',1,3600000,SPACE_CONSTRUCTION)).toEqual(modelTimeoutPolicy('high','scene-space',1));
  expect(stageContract({role:'scene-space',schemaContext:{derivedSpatialRelations:true}})).not.toBe(stageContract({role:'scene-space',schemaContext:{}}));
 }finally{f.clean();}
});

test('strict space checkpoint persists and binds the common lattice; tiny mutations fail before saving',async()=>{
 const f=fixture();try{
  const core={...structuredClone(f.core),voxelLattice:{version:'voxel-lattice-v1',cellSize:.25,origin:[0,0,0]}},observation={...f.observation,landmarks:f.observation.landmarks.map(l=>({...l,geometryScope:'object',critical:true}))},options={strictVoxel:true,inputKey:digest('strict voxel frozen input'),validate:(value:any)=>validateSpace(completeObservedSpacePlan(value,observation),f.plan,1,'simple',{strictVoxel:true})};
  let tool=f.create(options);await expect(f.putCore(tool)).rejects.toThrow('缺少字段');await f.putCore(tool,core);const file=join(f.folder,'checkpoint.json'),before=readFileSync(file),draft=tool.summary().draftSha256;
  for(const mutate of [v=>v.program.instances[0].position[0]=.000123,v=>v.program.instances[0].rotation[2]=1e-8,v=>v.program.instances[0].scale[0]=1.0001,v=>v.program.templates[0].bounds.min[0]=-.500123,v=>v.voxelLattice.cellSize=.3]){const invalid=structuredClone(core);mutate(invalid);await expect(f.putCore(tool,invalid)).rejects.toThrow();expect(readFileSync(file).equals(before)).toBe(true);expect(tool.summary().draftSha256).toBe(draft);}
  tool=f.create(options);expect(tool.summary().data.core.voxelLattice).toEqual(core.voxelLattice);expect(readFileSync(file).equals(before)).toBe(true);
  await f.put(tool,'spatialOpenings',f.openings);await f.put(tool,'spatialContacts',f.contacts);const value=tool.kit.resolveOutput!({selectedSpaceSha256:tool.summary().spaceSha256,reason:'冻结完整共同格网，仍待灰模验收'});expect(value.voxelLattice).toEqual(core.voxelLattice);
  const changed={...core,voxelLattice:{...core.voxelLattice,cellSize:.125}},previous=tool.summary().draftSha256;await f.putCore(tool,changed);expect(tool.summary().draftSha256).not.toBe(previous);expect(tool.summary().saved).toEqual({core:true,spatialOpenings:false,spatialContacts:false});
 }finally{f.clean();}
});

test('strict checkpoint performs grid admission independently of the externally supplied layout validator',async()=>{
 const f=fixture();try{
  const tool=f.create({strictVoxel:true,validate:(value:any)=>value}),core={...structuredClone(f.core),voxelLattice:{version:'voxel-lattice-v1',cellSize:.25,origin:[0,0,0]}};
  core.program.instances[0].position[0]=.000123;await expect(f.putCore(tool,core)).rejects.toThrow('VOXEL_LATTICE');expect(tool.summary().writes).toBe(0);expect(existsSync(join(f.folder,'checkpoint.json'))).toBe(false);
 }finally{f.clean();}
});

test('legacy perspective checkpoints and explicit orthographic cameras preserve their declaration across recovery',async()=>{
 const f=fixture();try{
  let tool=f.create();await f.putCore(tool);expect(tool.summary().data.core.cameras).toEqual(f.core.cameras);
  const core=structuredClone(f.core);core.cameras[0].projection='orthographic';
  await expect(f.putCore(tool,core)).rejects.toThrow('覆盖高度');expect(tool.summary().writes).toBe(1);
  core.cameras[0].orthographicHeight=8;await f.putCore(tool,core);tool=f.create();
  await f.put(tool,'spatialOpenings',f.openings);await f.put(tool,'spatialContacts',f.contacts);
  const value=tool.kit.resolveOutput!({selectedSpaceSha256:tool.summary().spaceSha256,reason:'原图的正交机位'});
  expect(value.cameras).toEqual(core.cameras);expect(value.cameras[0].orthographicHeight).toBe(8);
 }finally{f.clean();}
});

test('core and each declaration survive reconstruction without becoming a complete layout early',async()=>{
 const f=fixture();try{
  let tool=f.create();await expect(f.put(tool,'spatialOpenings',[])).rejects.toThrow('先保存');
  await f.putCore(tool);expect(tool.summary().saved).toEqual({core:true,spatialOpenings:false,spatialContacts:false});
  expect(tool.summary().complete).toBe(false);expect(tool.summary().spaceSha256).toBeNull();
  expect(()=>tool.kit.resolveOutput!({selectedSpaceSha256:tool.summary().draftSha256,reason:'不完整'})).toThrow('尚未全部声明');
  const coreBytes=readFileSync(join(f.folder,'checkpoint.json'));tool=f.create();expect(tool.summary().data.core).toEqual(f.core);expect(readFileSync(join(f.folder,'checkpoint.json')).equals(coreBytes)).toBe(true);
  await f.put(tool,'spatialOpenings',f.openings);tool=f.create();expect(tool.summary().saved.spatialContacts).toBe(false);
  await f.put(tool,'spatialContacts',f.contacts);const value=tool.kit.resolveOutput!({selectedSpaceSha256:tool.summary().spaceSha256,reason:'完整规划'});
  expect(value).toEqual(f.validate({...f.core,version:'scene-space-plan-v2',spatialOpenings:f.openings,spatialContacts:f.contacts}));
  expect(value.spatialRelations[0].critical).toBe(true);expect(value.cameras).toEqual(f.core.cameras);expect(tool.summary().writes).toBe(3);
  for(const file of ['space.json','layout.json','scene-space-response.txt'])expect(existsSync(join(f.root,file))).toBe(false);
 }finally{f.clean();}
});

test('bounded provider retry gets a saved core; no new logical stage or retry allowance is created',async()=>{
 const f=fixture();let attempts=0;try{
  const tool=f.create(),input:any={role:'scene-space',system:spaceConstructionPrompt(tool.kit.instructions),text:'冻结输入',tools:tool.kit,signal:f.signal.signal};
  const result=await callValidated(input,f.root,f.validate,async request=>withProviderRecovery(request,f.root,async()=>{
   attempts++;const state=JSON.parse(withToolContinuation(request).text.split('真实产物，不是新评分）：\n')[1]);
   if(attempts===1){expect(state.saved.core).toBe(false);await f.putCore(tool);throw Error('PROVIDER_TIMEOUT');}
   expect(state.data.core).toEqual(f.core);expect(state.writes).toBe(1);await f.put(tool,'spatialOpenings',f.openings);await f.put(tool,'spatialContacts',f.contacts);
   return {value:tool.kit.resolveOutput!({selectedSpaceSha256:tool.summary().spaceSha256,reason:'仅补缺失声明'}),receipt:{mock:true}} as any;
  },{wait:async()=>{}}));
  expect(attempts).toBe(2);expect(result.value.spatialOpenings).toEqual(f.openings);expect(result.value.spatialContacts).toEqual(f.contacts);
  expect(read(join(f.root,'scene-space-recovery.json')).attempts.map(a=>a.status)).toEqual(['failed','passed']);
  expect(read(join(f.root,'scene-space-attempts.json')).map(a=>a.status)).toEqual(['passed']);
 }finally{f.clean();}
});

test('invalid core, constraints, stale digest and undeclared fields preserve the prior checkpoint',async()=>{
 const f=fixture();try{
  const tool=f.create(),old=tool.summary().draftSha256;await f.putCore(tool);const file=join(f.folder,'checkpoint.json'),before=readFileSync(file);
  for(const change of [
   (v:any)=>v.program.instances[0].position=[101,0,0],
   (v:any)=>v.program.instances[0].requirementIds=[],
   (v:any)=>v.cameras[0].referenceIndex=null,
   (v:any)=>v.program.templates[0].maxParts=65,
   (v:any)=>v.observedBindings.pop(),
   (v:any)=>v.program.templates[0].parts=[],
   (v:any)=>v.spatialRelations=[],
  ]){const core=structuredClone(f.core);change(core);await expect(f.putCore(tool,core)).rejects.toThrow();expect(readFileSync(file).equals(before)).toBe(true);}
  await expect(f.putCore(tool,f.core,old)).rejects.toThrow('基线摘要');
  await expect(f.put(tool,'spatialOpenings',[{...f.openings[0],width:90}])).rejects.toThrow('局部边界');
  await expect(f.put(tool,'spatialContacts',[{...f.contacts[0],points:[[0,9,.5]]}])).rejects.toThrow('边界');
  await expect(f.put(tool,'spatialOpenings',[{...f.openings[0],instanceId:'missing'}])).rejects.toThrow('所属实例');
  await expect(f.put(tool,'spatialContacts',[{...f.contacts[0],points:[[0,.5,.5],[0,.5,.5]]}])).rejects.toThrow('重复连接点');
  await expect(f.put(tool,'unknown',[])).rejects.toThrow('名称');expect(readFileSync(file).equals(before)).toBe(true);
 }finally{f.clean();}
});

test('identical core is idempotent; changed core invalidates both declarations until revalidated',async()=>{
 const f=fixture();try{
  const tool=f.create(),selection=await f.finish(tool),before=readFileSync(join(f.folder,'checkpoint.json'));
  expect(body(await f.putCore(tool)).unchanged).toBe(true);expect(tool.summary().complete).toBe(true);expect(tool.summary().writes).toBe(3);expect(readFileSync(join(f.folder,'checkpoint.json')).equals(before)).toBe(true);
  const changed=structuredClone(f.core);changed.program.instances[1].position[1]=2;await f.putCore(tool,changed);
  expect(tool.summary().saved).toEqual({core:true,spatialOpenings:false,spatialContacts:false});expect(()=>tool.kit.resolveOutput!(selection)).toThrow('尚未全部');
  await f.put(tool,'spatialOpenings',f.openings);await expect(f.put(tool,'spatialContacts',f.contacts)).rejects.toThrow('边界');
  expect(tool.summary().saved.spatialContacts).toBe(false);
 }finally{f.clean();}
});

test('identity, tampering, concurrent modification and interrupted filesystem writes fail closed',async()=>{
 const f=fixture();try{
  const tool=f.create();await f.putCore(tool);const file=join(f.folder,'checkpoint.json'),before=readFileSync(file),second=f.create(),old=second.summary().draftSha256;
  for(const extra of [{jobId:'different'},{rootJobId:'different'},{inputKey:digest('different')}])expect(()=>f.create(extra)).toThrow('身份');
  const bad=read(file);bad.writes=0;save(file,bad);expect(()=>f.create()).toThrow('摘要');writeFileSync(file,before);
  renameSync(join(f.folder,'revisions'),join(f.folder,'revisions-saved'));writeFileSync(join(f.folder,'revisions'),'injected filesystem failure');
  await expect(f.put(tool,'spatialOpenings',f.openings)).rejects.toThrow();expect(readFileSync(file).equals(before)).toBe(true);
  rmSync(join(f.folder,'revisions'));renameSync(join(f.folder,'revisions-saved'),join(f.folder,'revisions'));await f.put(tool,'spatialOpenings',f.openings);
  await expect(f.put(second,'spatialContacts',f.contacts,old)).rejects.toThrow('其他执行');
  f.signal.abort();expect(()=>tool.summary()).toThrow();
 }finally{f.clean();}
});

test('write cap persists after reconstruction and cannot be reset by identical saves',async()=>{
 const f=fixture();try{
  let tool=f.create();for(let n=0;n<12;n++)await f.putCore(tool,{...f.core,assumptions:['推断 '+n]});
  tool=f.create();expect(tool.summary().writes).toBe(12);await expect(f.putCore(tool)).rejects.toThrow('次数上限');
  expect(body(await f.putCore(tool,{...f.core,assumptions:['推断 11']})).unchanged).toBe(true);expect(tool.summary().writes).toBe(12);
 }finally{f.clean();}
});

test('empty declarations must be explicit; selection is bound to current complete data and preserved history',async()=>{
 const f=fixture();try{
  const tool=f.create();await f.putCore(tool);await f.put(tool,'spatialOpenings',[]);await f.put(tool,'spatialContacts',[]);
  const selection={selectedSpaceSha256:tool.summary().spaceSha256,reason:'明确无声明，独立灰模仍待验'};
  expect(()=>tool.kit.resolveOutput!({...selection,selectedSpaceSha256:digest('invented')})).toThrow('当前完整');
  const value=tool.kit.resolveOutput!(selection);expect(value.spatialOpenings).toEqual([]);expect(selectedSpaceValue(f.root,selection,{id:f.options.jobId})).toEqual(value);
  expect(()=>selectedSpaceValue(f.root,{...selection,reason:'different'},{id:f.options.jobId})).toThrow('原始选择');
  expect(()=>selectedSpaceValue(f.root,selection,{id:'wrong'})).toThrow('来源身份');
  const proof=read(join(f.folder,'selected.json'));proof.value.cameras[0].position[0]=99;save(join(f.folder,'selected.json'),proof);expect(()=>selectedSpaceValue(f.root,selection,{id:f.options.jobId})).toThrow('摘要');
 }finally{f.clean();}
});

test('completed selection follows normal same-input recovery, preserving raw source and enabling a second recovery',async()=>{
 const f=fixture(),sourceId=randomUUID(),nextId=randomUUID(),thirdId=randomUUID(),sourceDir=join(runDir(sourceId),'generation'),target=join(runDir(nextId),'generation');
 try{
  mkdirSync(sourceDir,{recursive:true});mkdirSync(target,{recursive:true});
  const job={id:sourceId,executionRecoveryRoot:sourceId,reuseMode:'fresh',prompt:'同一原图',images:[{id:'reference'}],modelSettings:{model:'fixture'},plan:f.plan};save(join(runDir(sourceId),'job.json'),job);
  const tool=f.create({folder:join(sourceDir,'space-construction'),jobId:sourceId,rootJobId:sourceId}),selection=await f.finish(tool),value=tool.kit.resolveOutput!(selection);
  save(join(sourceDir,'scene-space-response.txt'),selection);save(join(sourceDir,'scene-space-receipt.json'),{requestedModel:'fixture',toolsContract:SPACE_CONSTRUCTION,stopReason:'completed'});
  const original=readFileSync(join(sourceDir,'scene-space-response.txt')),ctx={job:{...job,id:nextId,recoverySourceJobId:sourceId},plan:f.plan,dir:target};
  const saved=savedStage(ctx,'scene-space',f.validate)!;expect(saved.value).toEqual(value);persistStageReuse(ctx,'scene-space',saved);save(join(runDir(nextId),'job.json'),ctx.job);
  expect(readFileSync(join(sourceDir,'scene-space-response.txt')).equals(original)).toBe(true);expect(read(join(target,'scene-space-response.txt')).version).toBe('scene-space-v1');
  expect(read(join(target,'scene-space-receipt.json')).kind).toBe('reused-canonical-space');expect(read(join(target,'scene-space-reuse.json')).sourceJobId).toBe(sourceId);
  expect(savedStage({...ctx,job:{...ctx.job,id:thirdId,recoverySourceJobId:nextId}},'scene-space',f.validate)?.value).toEqual(value);
  expect(savedStage({...ctx,job:{...ctx.job,executionRecoveryRoot:nextId}},'scene-space',f.validate)).toBeNull();
 }finally{f.clean();for(const id of [sourceId,nextId,thirdId])rmSync(runDir(id),{recursive:true,force:true});}
});

test('space-only audited tools expose complete schemas and work through normal HTTP transport without models',async()=>{
 const f=fixture();let server:ReturnType<typeof serveCodexTools>|undefined;try{
  const tool=f.create();expect(()=>assertRoleTools('scene-space',tool.kit)).not.toThrow();for(const role of ['geometry-asset','scene-refine'])expect(()=>assertRoleTools(role,tool.kit)).toThrow('不允许');
  expect(()=>assertRoleTools('scene-space',{...tool.kit,version:'graybox-space-preview-v9'})).toThrow('不允许');
  server=serveCodexTools(tool.kit,f.signal.signal,join(f.root,'audit.jsonl'));const arg=server.args.find(x=>x.startsWith('mcp_servers.scene_feedback.args='))!;const url=JSON.parse(arg.slice(arg.indexOf('=')+1))[1];
  const request=async(method:string,params?:any)=>await (await fetch(url,{method:'POST',body:JSON.stringify({method,params}),headers:{'content-type':'application/json'}})).json() as any;
  expect((await request('tools/list')).tools.map(t=>t.name)).toEqual(['save_space_core','save_space_constraints','inspect_space_draft']);
  const saved=await request('tools/call',{name:'save_space_core',arguments:{expectedDraftSha256:tool.summary().draftSha256,coreJson:JSON.stringify(f.core)}});expect(saved.isError).not.toBe(true);
  expect(body(await request('tools/call',{name:'inspect_space_draft',arguments:{}})).saved.core).toBe(true);
  const bad=await request('tools/call',{name:'save_space_constraints',arguments:{expectedDraftSha256:digest('stale'),section:'spatialContacts',itemsJson:'[]'}});expect(bad.isError).toBe(true);
  expect(readFileSync(join(f.root,'audit.jsonl'),'utf8')).toContain('基线摘要不符');
 }finally{server?.close();f.clean();}
});
