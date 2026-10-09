import {test,expect} from 'bun:test';
import {normalizeObservationIndices,validateObservations,observationSchema,observeReferences,bindObservedSpace} from './reference-observations';
import {mkdirSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {runDir,save,read} from '../store';
import {STRICT_VOXEL_CONSTRUCTION} from '../voxel/landmark-coverage';
const fixture=()=>({landmarks:[{id:'wall',label:'墙',critical:true,views:[{referenceIndex:0,box:[0,.1,.8,.9],evidence:'第一图左墙'},{referenceIndex:1,box:[.2,.1,.9,.8],evidence:'第二图同一面墙'}]}],relations:[{id:'rel',description:'墙在门后',critical:true,landmarkIds:['wall']}],cameras:[{referenceIndex:0,evidence:'左侧透视',uncertainty:'尺度'},{referenceIndex:1,evidence:'正面',uncertainty:'尺度'}],assumptions:[]});
test('complete zero-based saved evidence can be translated without modifying coordinates or original data',()=>{const raw=fixture(),normalized=normalizeObservationIndices(raw,2);expect(raw.cameras[0].referenceIndex).toBe(0);expect(normalized.cameras.map(x=>x.referenceIndex)).toEqual([1,2]);expect(normalized.landmarks[0].views[1].referenceIndex).toBe(2);expect(normalized.landmarks[0].views[0].box).toEqual(raw.landmarks[0].views[0].box);expect(validateObservations(normalized,2)).toBe(normalized);expect(normalizeObservationIndices(normalized,2)).toEqual(normalized);});
test('mixed or incomplete image indices remain invalid; new schemas explicitly require one-based indices',()=>{const raw=fixture();raw.cameras[1].referenceIndex=2;expect(()=>validateObservations(normalizeObservationIndices(raw,2),2)).toThrow('从 1 开始');expect(observationSchema().properties.cameras.items.properties.referenceIndex.minimum).toBe(1);const bad=fixture();bad.landmarks[0].views[0].box=[.8,.1,.2,.9];expect(()=>validateObservations(normalizeObservationIndices(bad,2),2)).toThrow('右>左');});
test('recovery validates and reuses saved index-only rejection without issuing a model request',async()=>{const sourceId=randomUUID(),destId=randomUUID(),folder=join(runDir(sourceId),'generation'),dest=join(runDir(destId),'generation');mkdirSync(folder,{recursive:true});try{const plan={requirements:[]},job={id:sourceId,prompt:'两图同一空间',images:[{id:'a'},{id:'b'}],plan,modelSettings:{model:'fixture',reasoningEffort:'xhigh'},pipelineVersion:{label:'source'}};save(join(runDir(sourceId),'job.json'),job);save(join(folder,'scene-observation-invalid-response.txt'),fixture());save(join(folder,'scene-observation-invalid-receipt.json'),{role:'scene-observation',requestedModel:'fixture'});const target={...job,id:destId,recoverySourceJobId:sourceId,stages:{observe:{status:'running',reused:false}}};const result=await observeReferences({job:target,plan,dir:dest,images:[{},{}],signal:new AbortController().signal});expect(result.cameras.map(c=>c.referenceIndex)).toEqual([1,2]);expect(target.stages.observe.reused).toBe(true);expect(read(join(dest,'observation-reuse.json')).sourceResponse).toBe('scene-observation-invalid-response.txt');expect(read(join(dest,'reference-observations.json')).landmarks).toHaveLength(1);}finally{rmSync(runDir(sourceId),{recursive:true,force:true});rmSync(runDir(destId),{recursive:true,force:true});}});
test('二次恢复沿记录链找到原始观察，不重复模型调用，也不绕过输入一致性',async()=>{const ids=[randomUUID(),randomUUID(),randomUUID()];try{const plan={requirements:[]},base={prompt:'同一输入',images:[{id:'a'},{id:'b'}],plan,modelSettings:{model:'fixture',reasoningEffort:'xhigh'}};for(const [i,id] of ids.entries()){mkdirSync(join(runDir(id),'generation'),{recursive:true});save(join(runDir(id),'job.json'),{...base,id,recoverySourceJobId:i?ids[i-1]:null});}const first=join(runDir(ids[0]),'generation');save(join(first,'scene-observation-response.txt'),normalizeObservationIndices(fixture(),2));save(join(first,'scene-observation-receipt.json'),{requestedModel:'fixture'});const target={...base,id:ids[2],recoverySourceJobId:ids[1],stages:{observe:{status:'running'}}};const dir=join(runDir(ids[2]),'generation');await observeReferences({job:target,plan,dir,images:[{},{}]});expect(read(join(dir,'observation-reuse.json')).chain).toEqual([ids[1],ids[0]]);expect(read(join(dir,'scene-observation-response.txt')).cameras[0].referenceIndex).toBe(1);expect(read(join(dir,'scene-observation-receipt.json')).requestedModel).toBe('fixture');}finally{for(const id of ids)rmSync(runDir(id),{recursive:true,force:true})}});
test('恢复优先取已完成的最新空间修正，灰模只复用相同空间对应的输出',async()=>{const {savedStage}=await import('./saved-stage');const id=randomUUID(),dir=join(runDir(id),'generation'),plan={requirements:[]},job={id,prompt:'空间',images:[{id:'a'}],modelSettings:{model:'fixture'},plan};try{mkdirSync(join(dir,'space-repair-1'),{recursive:true});mkdirSync(join(dir,'blockout/1'),{recursive:true});save(join(runDir(id),'job.json'),job);save(join(dir,'scene-space-response.txt'),{camera:1});save(join(dir,'scene-space-receipt.json'),{requestedModel:'fixture'});save(join(dir,'space-repair-1/scene-space-response.txt'),{camera:2});save(join(dir,'space-repair-1/scene-space-receipt.json'),{requestedModel:'fixture'});save(join(dir,'blockout/1/space.json'),{camera:2});save(join(dir,'blockout/1/scene-blockout-response.txt'),{mesh:'saved'});save(join(dir,'blockout/1/scene-blockout-receipt.json'),{requestedModel:'fixture'});const ctx={job:{...job,id:randomUUID(),recoverySourceJobId:id},plan};expect(savedStage(ctx,'scene-space',v=>v)?.value).toEqual({camera:2});expect(savedStage(ctx,'scene-blockout',v=>v,false,{camera:2})?.value).toEqual({mesh:'saved'});expect(savedStage(ctx,'scene-blockout',v=>v,false,{camera:1})).toBeNull();expect(savedStage({...ctx,job:{...ctx.job,prompt:'different'}},'scene-space',v=>v)).toBeNull();}finally{rmSync(runDir(id),{recursive:true,force:true})}});

test('fresh strict observation schema requires explicit scopes without changing the legacy contract',()=>{
 const legacy=observationSchema(2),strict=observationSchema(2,{strictVoxel:true});
 expect(legacy.properties.landmarks.items.properties.geometryScope).toBeUndefined();
 expect(strict.properties.landmarks.items.required).toContain('geometryScope');
 expect(strict.properties.landmarks.items.properties.geometryScope.enum).toEqual(['object','component','void','group']);
 const value=normalizeObservationIndices(fixture(),2),before=JSON.stringify(value);
 expect(validateObservations(value,2)).toBe(value);expect(JSON.stringify(value)).toBe(before);
 expect(()=>validateObservations(value,2,{strictVoxel:true})).toThrow('geometryScope');
 value.landmarks[0].geometryScope='object';expect(validateObservations(value,2,{strictVoxel:true})).toBe(value);
 for(const scope of [null,'plant','OBJECT']){value.landmarks[0].geometryScope=scope;expect(()=>validateObservations(value,2)).toThrow('geometryScope');}
});
test('normal fresh strict observation request carries its schema flag and component decomposition guidance',async()=>{
 const id=randomUUID(),dir=join(runDir(id),'generation'),plan={requirements:[]},value=normalizeObservationIndices(fixture(),2);value.landmarks[0].geometryScope='object';let calls=0;
 try{
  const job={id,prompt:'参考图复刻',sceneKind:'voxel',voxelConstructionVersion:STRICT_VOXEL_CONSTRUCTION,images:[{id:'a'},{id:'b'}],modelSettings:{model:'fixture'}};
  const result=await observeReferences({job,plan,dir,images:[{},{}]},(async(input:any,_dir:any,validate:any)=>{
   calls++;expect(input.schemaContext).toEqual({referenceCount:2,strictVoxel:true});
   expect(input.system).toContain('空间位置分离的关键组件区域分成独立地标');expect(input.system).toContain('不能混入整面墙');
   expect(()=>validate({...value,landmarks:[{...value.landmarks[0],geometryScope:undefined}]})).toThrow('geometryScope');
   return {value:validate(value),receipt:{fixture:true}};
  }) as any);
  expect(calls).toBe(1);expect(result).toEqual(value);expect(read(join(dir,'reference-observations.json'))).toEqual(value);
 }finally{rmSync(runDir(id),{recursive:true,force:true});}
});
test('sceneKind voxel alone does not upgrade legacy observation requests',async()=>{
 const id=randomUUID(),dir=join(runDir(id),'generation'),plan={requirements:[]},value=normalizeObservationIndices(fixture(),2);
 try{
  await observeReferences({job:{id,prompt:'旧体素目标',sceneKind:'voxel',modelSettings:{model:'fixture'}},plan,dir,images:[{},{}]},(async(input:any,_dir:any,validate:any)=>{
   expect(input.schemaContext).toEqual({referenceCount:2});expect(input.system).not.toContain('geometryScope');return {value:validate(value),receipt:{fixture:true}};
  }) as any);
  expect(read(join(dir,'reference-observations.json')).landmarks[0].geometryScope).toBeUndefined();
 }finally{rmSync(runDir(id),{recursive:true,force:true});}
});
test('strict recovery rejects unscoped saved evidence without rewriting it or requesting another model',async()=>{
 const sourceId=randomUUID(),destId=randomUUID(),folder=join(runDir(sourceId),'generation'),dest=join(runDir(destId),'generation');let calls=0;
 try{
  mkdirSync(folder,{recursive:true});const plan={requirements:[]},base={prompt:'同一旧输入',images:[{id:'a'},{id:'b'}],plan,modelSettings:{model:'fixture'}};
  save(join(runDir(sourceId),'job.json'),{...base,id:sourceId});const sourcePath=join(folder,'scene-observation-response.txt');save(sourcePath,normalizeObservationIndices(fixture(),2));save(join(folder,'scene-observation-receipt.json'),{requestedModel:'fixture'});const before=readFileSync(sourcePath,'utf8');
  await expect(observeReferences({job:{...base,id:destId,recoverySourceJobId:sourceId,voxelConstructionVersion:STRICT_VOXEL_CONSTRUCTION},plan,dir:dest,images:[{},{}]},(async()=>{calls++;throw Error('fixture must not request a model');}) as any)).rejects.toThrow('geometryScope');
  expect(calls).toBe(0);expect(readFileSync(sourcePath,'utf8')).toBe(before);
 }finally{rmSync(runDir(sourceId),{recursive:true,force:true});rmSync(runDir(destId),{recursive:true,force:true});}
});
test('bindObservedSpace enforces coverage only for explicitly strict lattice spaces',()=>{
 const observation=normalizeObservationIndices(fixture(),2),space:any={program:{instances:[{id:'i_wall',template:'t_wall'}],templates:[{id:'t_wall',bounds:{min:[0,0,0],max:[1,1,2]}}]},observedBindings:[{landmarkId:'wall',instanceIds:['i_wall']}],spatialRelations:[{id:'rel',description:'墙在门后',critical:true,instanceIds:['i_wall']}]};
 expect(bindObservedSpace(space,observation)).toBe(space);
 space.voxelLattice={version:STRICT_VOXEL_CONSTRUCTION};expect(()=>bindObservedSpace(space,observation)).toThrow('geometryScope');
 observation.landmarks[0].geometryScope='object';expect(bindObservedSpace(space,observation)).toBe(space);
 observation.landmarks.push({...observation.landmarks[0],id:'clusters',label:'附着块',geometryScope:'component'});space.observedBindings.push({landmarkId:'clusters',instanceIds:['i_wall']});
 expect(()=>bindObservedSpace(space,observation)).toThrow('独立实例');
});
