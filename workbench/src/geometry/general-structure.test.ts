import {test,expect} from 'bun:test';
import {rmSync} from 'node:fs';
import {join} from 'node:path';
import {applyGrayboxLocalParts} from './graybox-local-parts';
import {compileGeometryProgram} from './program';
import {assetGeometryBasis,assetGeometryBasisMatches} from './asset-geometry-basis';
import {assetInput} from './asset-input';
import {assetKey,AssetCache,cacheCheckpointAssets} from './asset-cache';
import {checkpointFixture} from './checkpoint-fixture';
import {read,save} from '../store';
import {stable} from '../validated-cache';

import {generalStructureFixture} from './general-structure-fixture';
const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};
const box=(id:string,size:number[],position:number[])=>({...pose,id,position,shape:{type:'box',size,radius:0}});

test('家具、框架和植物使用同一整组修正契约；实体和来源不变，所有网格实际可编译',()=>{
 const f=generalStructureFixture(),before=stable(f),result=applyGrayboxLocalParts(f.source,f.space,[],f.groups);
 expect(result.changed).toEqual(['furniture/*','frame/*','organic/*']);
 expect(result.templates.map(t=>t.parts.length)).toEqual([4,3,1]);
 const compiled=compileGeometryProgram({...f.source.program,templates:result.templates});
 expect(compiled.triangles).toBeGreaterThan(84);expect(compiled.triangles).toBeLessThan(250000);
 expect(stable(f)).toBe(before);
 for(const t of result.templates)expect(t.parts.every(p=>p.material==='blockout')).toBe(true);
});
test('通用重建仍拒绝越界、未知身份、重复部件、混改、细节几何和超预算部件数',()=>{
 const f=generalStructureFixture(),valid=f.groups[0];
 const cases=[{...valid,templateId:'new'}, {...valid,parts:[]}, {...valid,parts:Array.from({length:9},(_,i)=>box('b'+i,[.1,.1,.1],[0,0,1]))}, {...valid,parts:[valid.parts[0],valid.parts[0]]}, {...valid,parts:[box('outside',[5,1,1],[0,0,1])]}, {...valid,parts:[{...valid.parts[0],shape:{type:'grid'}}]}];
 for(const group of cases)expect(()=>applyGrayboxLocalParts(f.source,f.space,[],[group])).toThrow();
 expect(()=>applyGrayboxLocalParts(f.source,f.space,[{templateId:'furniture',partId:'proxy',...pose}],[valid])).toThrow('重复修改');
 expect(()=>applyGrayboxLocalParts(f.source,f.space,[],[valid,valid])).toThrow('重复');
 expect(()=>applyGrayboxLocalParts(f.source,f.space,[],[...f.groups,valid])).toThrow('最多3');
});
test('历史枝冠专用契约仍拒绝非枝冠，读取旧预览不会扩大它的权限',()=>{
 const f=generalStructureFixture();expect(()=>applyGrayboxLocalParts(f.source,f.space,[],[f.groups[0]],false)).toThrow('历史');
 expect(applyGrayboxLocalParts(f.source,f.space,[],[f.groups[2]],false).changed).toEqual(['organic/*']);
});
test('三类资产都收到已验收局部部件结构；hash不受材质、相机和其他模板影响',()=>{
 const f=generalStructureFixture(),result=applyGrayboxLocalParts(f.source,f.space,[],f.groups),scene={program:{...f.source.program,templates:result.templates}};
 for(const group of f.groups){
  const basis=assetGeometryBasis(scene,group.templateId)!;expect(basis.template.parts.map(p=>p.shape)).toEqual(group.parts.map(p=>p.shape));
  expect(basis.template.parts.every(p=>!Object.hasOwn(p,'material'))).toBe(true);expect(basis.instructions).toContain('不是最终成品');
  const changed=structuredClone(scene);changed.program.templates.find(t=>t.id===group.templateId).parts[0].material='other';
  expect(assetGeometryBasis(changed,group.templateId)?.sha256).toBe(basis.sha256);
  changed.program.templates.find(t=>t.id===group.templateId).parts[0].position[0]+=.1;
  expect(assetGeometryBasis(changed,group.templateId)?.sha256).not.toBe(basis.sha256);
  expect(assetGeometryBasisMatches({acceptedGeometrySha256:basis.sha256},scene,group.templateId)).toBe(true);
  expect(assetGeometryBasisMatches({},scene,group.templateId)).toBe(false);
 }
 expect(()=>assetGeometryBasis(scene,'missing')).toThrow('MISSING');
});
test('实际资产输入与缓存键绑定同一已验收几何，普通非枝冠轮廓改变也会失效',()=>{
 const f=checkpointFixture();try{
  const layout=read(join(f.registration.generationDir,'layout.json')),plan=read(f.registration.planFile),brief=layout.program.templates[0],scene={program:{templates:[f.geometry.template]}};
  const input=assetInput(f.job.prompt,plan,layout,brief,{},scene),key=assetKey(f.job,plan,layout,brief,{},scene);
  expect(input.acceptedGeometry?.template.parts[0].shape).toEqual(f.geometry.template.parts[0].shape);
  const changed=structuredClone(scene);changed.program.templates[0].parts[0].position[0]+=.1;
  expect(assetKey(f.job,plan,layout,brief,{},changed)).not.toBe(key);
  expect(assetKey(f.job,plan,layout,brief,{})).not.toBe(key);
  const other=structuredClone(scene);other.program.templates.push({...f.geometry.template,id:'unrelated'});expect(assetKey(f.job,plan,layout,brief,{},other)).toBe(key);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
test('检查点仅在结构来源匹配时导入缓存，不将未知旧来源重新标为当前结构',()=>{
 const f=checkpointFixture();try{
  const snap=f.store.load(f.store.register(f.registration).id,f.job),scene={program:{templates:[f.geometry.template]}},basis=assetGeometryBasis(scene,'shape')!,cache=new AssetCache(join(f.root,'cache')),before=stable(snap);
  expect(cacheCheckpointAssets(f.job,snap.plan,snap.layout,{},[snap],cache,scene)).toBe(0);expect(stable(snap)).toBe(before);
  const known=structuredClone(snap);known.assets[0].source.acceptedGeometrySha256=basis.sha256;
  const changed=structuredClone(scene);changed.program.templates[0].parts[0].scale[0]=.9;
  expect(cacheCheckpointAssets(f.job,snap.plan,snap.layout,{},[known],cache,changed)).toBe(0);
  expect(cacheCheckpointAssets(f.job,snap.plan,snap.layout,{},[known],cache,scene)).toBe(1);
  const brief=snap.layout.program.templates[0],stored=cache.get(assetKey(f.job,snap.plan,snap.layout,brief,{},scene),brief,snap.layout,{});
  expect(stored.source.acceptedGeometrySha256).toBe(basis.sha256);expect(stored.value).toEqual(f.geometry);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
test('同根技术恢复保留资产结构来源，已知结构改变时不可复用',()=>{
 const f=checkpointFixture();try{
  const scene={program:{templates:[f.geometry.template]}},basis=assetGeometryBasis(scene,'shape')!,file=join(f.registration.generationDir,'assets/shape/checkpoint.json');
  save(file,{...read(file),acceptedGeometrySha256:basis.sha256});save(join(f.registration.generationDir,'assets/shape/accepted-geometry.json'),basis);
  const snapshot=f.store.register(f.registration),restored=f.store.restore(snapshot.id,f.job,join(f.root,'resume'));
  expect(restored.assets[0].source.acceptedGeometrySha256).toBe(basis.sha256);expect(assetGeometryBasisMatches(restored.assets[0].source,scene,'shape')).toBe(true);
  const changed=structuredClone(scene);changed.program.templates[0].parts[0].scale[0]=.9;
  expect(assetGeometryBasisMatches(restored.assets[0].source,changed,'shape')).toBe(false);
  expect(f.store.verify(snapshot.id).id).toBe(snapshot.id);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});

test('结构依据文件缺失或被修改时不注册为可恢复资产，原始产物保留',()=>{
 const f=checkpointFixture();try{
  const scene={program:{templates:[f.geometry.template]}},basis=assetGeometryBasis(scene,'shape')!,file=join(f.registration.generationDir,'assets/shape/checkpoint.json'),basisFile=join(f.registration.generationDir,'assets/shape/accepted-geometry.json');
  save(file,{...read(file),acceptedGeometrySha256:basis.sha256});
  expect(()=>f.store.register(f.registration)).toThrow('结构来源');
  save(basisFile,basis);const snapshot=f.store.register(f.registration);expect(snapshot.files['assets/shape/accepted-geometry.json']).toHaveLength(64);
  const changed=structuredClone(basis);changed.template.parts[0].position[0]=.1;save(basisFile,changed);
  expect(()=>f.store.register(f.registration)).toThrow('结构来源');expect(f.store.verify(snapshot.id).id).toBe(snapshot.id);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
