import {expect,test} from 'bun:test';
import {existsSync,mkdtempSync,readdirSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {definePackageId,executePackBuild,validatePackDefinition} from '@forgeax/engine/pack/source';
import {writeAssetPreviews,writeAssetPreviewsParallel} from './asset-previews';
import {
 clearMeshCaches,
 getCachedMeshAsset,
 getExportPlanTelemetry,
 planSpecExport,
 planSpecExportParallel,
 writeSpecPack,
} from './export-pack';
import {sampleSpec} from './fixtures';
import {
 getActiveWorkerCount,
 getParallelAssetStats,
 resetParallelAssetStats,
 runWorkerTasks,
} from './parallel-assets';
import {prepareSpecProject} from './prepare-spec';
import type {SceneSpec} from './schema';

function multiFamilySpec(primaryPattern:'deck'|'trim'='deck'):SceneSpec{
 const s=sampleSpec();
 const src=[{kind:'doc' as const,ref:'parallel-test'}];
 s.materials[0]!.surface={pattern:primaryPattern,tilesPerMeter:1};
 s.materials.push(
  {...s.materials[0]!,id:'glow',surface:null,emissive:[0.4,0.85,1],emissiveIntensity:3.5},
  {...s.materials[0]!,id:'deck_metal',surface:{pattern:'panel',tilesPerMeter:0.5}},
 );
 const nodeSlots={
  base:'steel',
  sideShell:'steel',
  sleeve:'deck_metal',
  core:'glow',
  weakpoint:'glow',
  fin:'steel',
  readout:'glow',
  topCap:'deck_metal',
 };
 s.families=[
  {
   id:'RING',
   label:'约束环',
   description:'约束环族',
   priority:'P0',
   generator:{id:'GEN-RING-01',params:{outerDiameter:[10,12,14]}},
   materialSlots:{segment:'steel',outerArmor:'deck_metal',joint:'steel',lightRail:'glow',indicator:'glow'},
   authority:'master',
   sources:src,
  },
  {
   id:'NODE',
   label:'能量节点',
   description:'能量节点族',
   priority:'P0',
   generator:{id:'GEN-NODE-01',params:{}},
   materialSlots:nodeSlots,
   authority:'master',
   sources:src,
  },
  {
   id:'PROXY_DOOR',
   label:'未实现门',
   description:'代理测试',
   priority:'P1',
   generator:{id:'GEN-UNIMPLEMENTED-99',params:{}},
   materialSlots:{frame:'steel'},
   authority:'design_fill',
   sources:src,
  },
 ];
 const mkObj=(id:string,family:string,position:[number,number,number],params:Record<string,any>={})=>({
  id,
  label:id,
  family,
  parent:null,
  transform:{position,rotationDeg:[0,0,0] as [number,number,number],rotationOrder:'XYZ' as const,scale:[1,1,1] as [number,number,number]},
  params,
  authority:'master' as const,
  sources:src,
  confidence:1,
  notes:'',
 });
 s.objects=[
  mkObj('RING_01','RING',[0,0,6]),
  mkObj('RING_02','RING',[0,0,7]),
  mkObj('RING_03','RING',[0,0,8]),
  mkObj('NODE_01','NODE',[-8,-8,0]),
  mkObj('NODE_02','NODE',[8,-8,0]),
  mkObj('NODE_03','NODE',[8,8,0]),
  mkObj('NODE_TALL','NODE',[-8,8,0],{height:3.2}),
  mkObj('DOOR_PROXY','PROXY_DOOR',[0,20,0],{size:[4,0.4,5]}),
 ];
 s.acceptance=[];
 s.shots[0]!.target=[0,0,6];
 return s;
}

test('planSpecExportParallel 与同步 planSpecExport 产出完全一致的三角数、AABB、实体批次与二进制顶点/索引',async()=>{
 const spec=multiFamilySpec();

 clearMeshCaches();
 const syncPlan=planSpecExport(spec);
 const syncAssets=new Map(syncPlan.meshes.filter(m=>m.generator!=='proxy').map(m=>[m.key,getCachedMeshAsset(m)!]));

 clearMeshCaches();
 resetParallelAssetStats();
 const parallelPlan=await planSpecExportParallel(spec,{concurrency:3,precookSurfaces:false});
 expect(getActiveWorkerCount()).toBe(0);

 const telemetry=getExportPlanTelemetry(parallelPlan);
 expect(telemetry).toBeDefined();
 expect(telemetry!.parallelWorkers).toBe(3);
 expect(telemetry!.uniqueMeshes).toBe(5);
 expect(telemetry!.workerMeshBuilds).toBe(5);

 expect(parallelPlan.triangles).toBe(syncPlan.triangles);
 expect(parallelPlan.meshes).toEqual(syncPlan.meshes);
 expect(parallelPlan.entities).toEqual(syncPlan.entities);
 expect(parallelPlan.instancing).toEqual(syncPlan.instancing);
 expect(parallelPlan.instancedInstances).toBe(syncPlan.instancedInstances);
 expect(parallelPlan.report).toEqual(syncPlan.report);
 expect(parallelPlan.instancedBatches.map(b=>({
  key:b.key,
  mesh:b.mesh,
  entityIds:b.entityIds,
  transforms:Array.from(b.transforms),
 }))).toEqual(syncPlan.instancedBatches.map(b=>({
  key:b.key,
  mesh:b.mesh,
  entityIds:b.entityIds,
  transforms:Array.from(b.transforms),
 })));

 for(const mesh of parallelPlan.meshes){
  if(mesh.generator==='proxy')continue;
  const pAsset:any=getCachedMeshAsset(mesh);
  const sAsset:any=syncAssets.get(mesh.key);
  expect(pAsset).toBeDefined();
  expect(sAsset).toBeDefined();
  expect(Buffer.from(pAsset.vertices.buffer,pAsset.vertices.byteOffset,pAsset.vertices.byteLength))
   .toEqual(Buffer.from(sAsset.vertices.buffer,sAsset.vertices.byteOffset,sAsset.vertices.byteLength));
  expect(Buffer.from(pAsset.indices.buffer,pAsset.indices.byteOffset,pAsset.indices.byteLength))
   .toEqual(Buffer.from(sAsset.indices.buffer,sAsset.indices.byteOffset,sAsset.indices.byteLength));
  expect(Array.from(pAsset.aabb)).toEqual(Array.from(sAsset.aabb));
  for(const attrName of Object.keys(sAsset.attributes)){
   const pa=pAsset.attributes[attrName],sa=sAsset.attributes[attrName];
   expect(Buffer.from(pa.buffer,pa.byteOffset,pa.byteLength))
    .toEqual(Buffer.from(sa.buffer,sa.byteOffset,sa.byteLength));
  }
 }
});

test('.mesh-cache 跨进程复用:prepareSpecProject 写入 source 外部缓存,后续 generate/build 零重跑生成器且 100% 网格与贴图预烘焙',async()=>{
 const spec=multiFamilySpec('deck');
 const projDir=mkdtempSync(join(tmpdir(),'spec-parallel-cache-'));
 clearMeshCaches();
 resetParallelAssetStats();

 // 先在无全局表面缓存下验证 Worker 池并行产出网格 + 1024²/256² 表面贴图并写入 .mesh-cache
 await planSpecExportParallel(spec,{cacheDir:join(projDir,'.mesh-cache'),concurrency:4,useGlobalSurfaceCache:false});
 expect(getActiveWorkerCount()).toBe(0);
 expect(getParallelAssetStats().surfaceWorkerRuns).toBe(2);

 const prepared=await prepareSpecProject(projDir,spec,{id:'spec-cache-e2e',concurrency:4});
 expect(getActiveWorkerCount()).toBe(0);
 expect(prepared.exportStats.meshCacheHits).toBe(5);

 // 确认 .mesh-cache 在 root 下且不在 source/ 内(不污染 pipeline.ts UTF-8 treeDigest)
 const cacheDir=join(projDir,'.mesh-cache');
 expect(existsSync(cacheDir)).toBe(true);
 const sourceEntries=readdirSync(join(projDir,'source'));
 expect(sourceEntries.some(name=>name.endsWith('.bin'))).toBe(false);

 const nonProxyMeshes=prepared.plan.meshes.filter(m=>m.generator!=='proxy');
 for(const m of nonProxyMeshes){
  expect(existsSync(join(cacheDir,`${m.key}.bin`))).toBe(true);
  expect(existsSync(join(cacheDir,`${m.key}.json`))).toBe(true);
 }
 expect(existsSync(join(cacheDir,'surface-deck-1024.bin'))).toBe(true);
 expect(existsSync(join(cacheDir,'surface-panel-256.bin'))).toBe(true);

 // 模拟 pipeline.ts generate 独立子进程:清空全部内存缓存并设置 ASSET_PIPELINE_ROOT
 clearMeshCaches();
 resetParallelAssetStats();
 const prevRoot=process.env.ASSET_PIPELINE_ROOT;
 try{
  process.env.ASSET_PIPELINE_ROOT=projDir;
  const childPlan=planSpecExport(spec);
  const packDir=join(projDir,'game/assets/generated');
  const receipt=writeSpecPack(spec,childPlan,packDir,{
   packageId:'019fb7ce-6100-7000-8000-000000000099',
   sourceKey:'scene/spec',
   name:'并行缓存测试',
  });

  const statsAfterExport=getParallelAssetStats();
  expect(statsAfterExport.meshMainThreadRuns).toBe(0);
  expect(statsAfterExport.meshWorkerRuns).toBe(0);
  expect(statsAfterExport.surfaceMainThreadRuns).toBe(0);
  expect(statsAfterExport.meshCacheHits).toBeGreaterThanOrEqual(nonProxyMeshes.length);
  expect(statsAfterExport.surfaceCacheHits).toBeGreaterThanOrEqual(2);

  // 默认 SPEC_PRECOOK_MIN_TRIANGLES=1:100% 非代理网格全部写入 cooked/*.bin
  expect(receipt.precookedMeshCount).toBe(nonProxyMeshes.length);
  for(const m of nonProxyMeshes){
   expect(existsSync(join(packDir,'cooked',`${m.key}.bin`))).toBe(true);
  }
  expect(existsSync(join(packDir,'cooked','surface-deck-1024.bin'))).toBe(true);
  expect(existsSync(join(packDir,'cooked','surface-panel-256.bin'))).toBe(true);

  const mod=(await import(pathToFileURL(join(packDir,'spec.pack.ts')).href)).default;
  expect(validatePackDefinition(mod).ok).toBe(true);
  const built=await executePackBuild(mod,{
   packageId:mod.packageId??definePackageId('019fb7ce-6100-7000-8000-000000000099'),
   readByGuid:async()=>{throw Error('unused');},
  });
  expect(built.ok).toBe(true);
  const builtAssets=((built as any).value.assets??(built as any).value) as Record<string,any>;
  expect(builtAssets['texture/deck-normal'].shape.extent.width).toBe(1024);
  expect(builtAssets['texture/panel-normal'].shape.extent.width).toBe(256);
  for(const m of nonProxyMeshes){
   expect(builtAssets['mesh/'+m.key].indices.length/3).toBe(m.triangles);
  }
 }finally{
  if(prevRoot===undefined)delete process.env.ASSET_PIPELINE_ROOT;
  else process.env.ASSET_PIPELINE_ROOT=prevRoot;
 }
},30000);

test('writeAssetPreviewsParallel 零重跑生成器,并行输出合法 PNG 头且准确统计 GPU 实例化数量',async()=>{
 const spec=multiFamilySpec();
 clearMeshCaches();
 const plan=await planSpecExportParallel(spec,{concurrency:3,precookSurfaces:false});

 resetParallelAssetStats();
 const outParallel=mkdtempSync(join(tmpdir(),'spec-previews-par-'));
 const outSync=mkdtempSync(join(tmpdir(),'spec-previews-sync-'));

 const itemsParallel=await writeAssetPreviewsParallel(spec,plan,outParallel,{concurrency:3});
 expect(getActiveWorkerCount()).toBe(0);
 const stats=getParallelAssetStats();
 expect(stats.previewGeneratorFallbacks).toBe(0);
 expect(stats.meshMainThreadRuns).toBe(0);
 expect(stats.meshWorkerRuns).toBe(0);
 expect(stats.previewWorkerRuns).toBe(5);

 const itemsSync=writeAssetPreviews(spec,plan,outSync);
 expect(getParallelAssetStats().previewGeneratorFallbacks).toBe(0);
 expect(itemsParallel).toEqual(itemsSync);

 // NODE_01..03 被合并进 GPU Instances 批次,缩略图索引仍准确记录 instances === 3
 const batchedNodeKey=plan.instancedBatches[0]!.mesh;
 const batchedItem=itemsParallel.find((x:any)=>x.key===batchedNodeKey);
 expect(batchedItem.instances).toBe(3);

 const PNG_MAGIC=[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a];
 for(const item of itemsParallel){
  if(item.generator==='proxy'){
   expect(item.image).toBeNull();
   expect(item.error).toContain('代理盒');
   continue;
  }
  expect(item.image).toBe(`${item.key}.png`);
  const pngPar=readFileSync(join(outParallel,item.image));
  const pngSync=readFileSync(join(outSync,item.image));
  expect(Array.from(pngPar.subarray(0,8))).toEqual(PNG_MAGIC);
  expect(pngPar.byteLength).toBeGreaterThan(200);
  expect(pngPar).toEqual(pngSync);
 }
});

test('Worker 线程池:空队列、跨任务复用与异常生成器均正常回收且 0 泄漏线程',async()=>{
 expect(getActiveWorkerCount()).toBe(0);

 const empty=await runWorkerTasks([]);
 expect(empty.workersUsed).toBe(0);
 expect(empty.results).toEqual([]);
 expect(getActiveWorkerCount()).toBe(0);

 // 2 个 Worker 轮询处理含异常项与正常项的混合队列,验证单任务报错不会杀死或泄漏 Worker
 const mixed=await runWorkerTasks([
  {kind:'mesh',meshKey:'bad-1',generatorId:'NON_EXISTENT_GEN',params:{}},
  {kind:'surface',pattern:'panel',size:64},
  {kind:'mesh',meshKey:'bad-2',generatorId:'NON_EXISTENT_GEN_2',params:{}},
  {kind:'surface',pattern:'grate',size:64},
 ],{concurrency:2});

 expect(getActiveWorkerCount()).toBe(0);
 expect(mixed.workersUsed).toBe(2);
 expect(mixed.results).toHaveLength(4);
 expect(mixed.results[0]!.ok).toBe(false);
 expect(mixed.results[1]!.ok).toBe(true);
 expect(mixed.results[2]!.ok).toBe(false);
 expect(mixed.results[3]!.ok).toBe(true);
});
