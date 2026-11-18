import {test,expect} from 'bun:test';
import {mkdtempSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {mat4} from '@forgeax/engine/math';
import {definePackageId,executePackBuild,validatePackDefinition} from '@forgeax/engine/pack/source';
import {packInstanceTransforms,planSpecExport,toEngineDecalQuat,toEngineDecalScale,toEnginePosition,toEngineQuat,writeSpecPack,type Quat} from './export-pack';
import {prepareSpecProject} from './prepare-spec';
import {resolveParams} from './generators/kit';
import {GENERATORS} from './generators/index';
import {sampleSpec} from './fixtures';
import type {SceneSpec} from './schema';

const rotate=(q:Quat,v:number[])=>{const [x,y,z,w]=q,ix=w*v[0]+y*v[2]-z*v[1],iy=w*v[1]+z*v[0]-x*v[2],iz=w*v[2]+x*v[1]-y*v[0],iw=-x*v[0]-y*v[1]-z*v[2];return [ix*w+iw*-x+iy*-z-iz*-y,iy*w+iw*-y+iz*-x-ix*-z,iz*w+iw*-z+ix*-y-iy*-x];};
const close=(a:number[],b:number[])=>a.every((v,i)=>Math.abs(v-b[i])<1e-9);

test('坐标换轴:位置 (x,y,z)→(x,z,-y);绕规格 Z 转 90° 把规格 +X 转到规格 +Y',()=>{
 expect(toEnginePosition([1,2,3])).toEqual([1,3,-2]);
 const q=toEngineQuat([0,0,90]);
 // 规格 +X = 引擎 +X;规格 +Y = 引擎 -Z
 expect(close(rotate(q,[1,0,0]),[0,0,-1])).toBe(true);
 expect(close(rotate(toEngineQuat([90,0,0]),[0,1,0]),[0,0,1])).toBe(true); // 绕规格 X 转 90°:引擎 +Y(规格 +Z)→ 规格 -Y = 引擎 +Z
 expect(toEngineQuat([0,0,0])).toEqual([0,0,0,1]);
});

function hallSpec():SceneSpec{
 const s=sampleSpec(),src=[{kind:'doc' as const,ref:'t'}];
 s.materials.push({...s.materials[0],id:'glow',emissive:[0.5,0.8,1],emissiveIntensity:4});
 s.families=[
  {id:'RING',label:'环',description:'',priority:'P0',generator:{id:'GEN-RING-01',params:{outerDiameter:[11,13,15],authorNote:'曲线'}},materialSlots:{segment:'steel',outerArmor:'steel',joint:'steel',lightRail:'glow',indicator:'glow'},authority:'master',sources:src},
  {id:'NODE',label:'节点',description:'',priority:'P0',generator:{id:'GEN-NODE-01',params:{}},materialSlots:{base:'steel'},authority:'master',sources:src},
  {id:'DOOR',label:'门',description:'',priority:'P1',generator:{id:'GEN-DOOR-01',params:{}},materialSlots:{frame:'steel'},authority:'design_fill',sources:src},
 ];
 const obj=(id:string,family:string,position:[number,number,number],params={})=>({id,label:id,family,parent:null,transform:{position,rotationDeg:[0,0,0] as [number,number,number],rotationOrder:'XYZ' as const,scale:[1,1,1] as [number,number,number]},params,authority:'master' as const,sources:src,confidence:1,notes:''});
 s.objects=[obj('RING_01','RING',[0,0,7]),obj('RING_02','RING',[0,0,7]),obj('RING_03','RING',[0,0,7]),obj('NODE_01','NODE',[-15,-15,0]),obj('DOOR_01','DOOR',[0,27,0],{size:[8,0.5,8]})];
 s.acceptance=[];s.shots[0].target=[0,0,7];
 return s;
}

test('导出计划:列表参数按族内对象分配、未知参数可见丢弃、缺槽报错、缺生成器回退代理',()=>{
 const plan=planSpecExport(hallSpec());
 expect(plan.report.derived.map(d=>[d.object,d.value])).toEqual([['RING_01',11],['RING_02',13],['RING_03',15]]);
 expect(plan.report.dropped).toEqual([{family:'RING',key:'authorNote',reason:'生成器没有这个参数（未改变几何要求）'}]);
 expect(plan.report.proxies).toEqual([{object:'DOOR_01',family:'DOOR',reason:'生成器 GEN-DOOR-01 尚未实现'}]);
 expect(plan.report.slotFallbacks.filter(f=>f.family==='NODE').map(f=>f.slot)).toContain('sideShell'); // NODE 族只给了 base 槽,其余槽补本族材质
 expect(plan.meshes.filter(m=>m.generator==='GEN-RING-01')).toHaveLength(3);
 expect(plan.entities.find(e=>e.id==='NODE_01')).toBeDefined();
 expect(plan.entities.find(e=>e.id==='RING_02')!.pos).toEqual([0,7,-0]);
});

test('写出 pack:数据、源码、生成器副本与收据',()=>{
 const spec=hallSpec();spec.families[1].materialSlots={base:'steel',sideShell:'steel',sleeve:'steel',core:'glow',weakpoint:'glow',fin:'steel',readout:'glow',topCap:'steel'};
 const plan=planSpecExport(spec);expect(plan.report.errors).toEqual([]);
 const dir=mkdtempSync(join(tmpdir(),'spec-pack-'));
 const receipt=writeSpecPack(spec,plan,dir,{packageId:'019fb7ce-6100-7000-8000-000000000000',sourceKey:'scene/sample',name:'样例'});
 expect(receipt.meshCount).toBe(5);expect(receipt.diagnostics).toEqual([]);expect(receipt.sceneGuid).toMatch(/^[0-9a-f-]{36}$/);
 for(const f of ['spec.pack.ts','spec-data.ts','spec-kit/kit.ts','spec-kit/gen-ring.ts','export-report.json'])expect(existsSync(join(dir,f))).toBe(true);
 expect(readFileSync(join(dir,'spec-data.ts'),'utf8')).toContain('"generator":"GEN-RING-01"');
});

test('全部库生成器:默认参数合法、边界合法、非法拒绝',()=>{
 for(const g of Object.values(GENERATORS)){
  expect(resolveParams(g,{}).errors).toEqual([]);
  const edge=Object.fromEntries(Object.entries(g.params).filter(([,d]:any)=>d.type==='number'||d.type==='int').map(([k,d]:any)=>[k,d.min]));
  expect(resolveParams(g,edge).errors).toEqual([]);
  const bad=Object.fromEntries(Object.entries(g.params).filter(([,d]:any)=>d.type==='number'||d.type==='int'||d.type==='vec3').slice(0,1).map(([k,d]:any)=>[k,d.type==='vec3'?[d.max*10+1,0,0]:d.max*10+1]));
  expect(resolveParams(g,{...bad,unknownKey:1}).errors.length).toBe(2);
 }
});

test('整组生成器:族内只出一个实例,其它对象记为组成部分;无主控对象时在族原点合成',()=>{
 const s=hallSpec();
 s.families.push({id:'HALLS',label:'骨架',description:'',priority:'P0',generator:{id:'GEN-HALL-01',params:{}},materialSlots:Object.fromEntries(['column','beam','roofTruss','roofDeck','wallPanel','inspectionPanel','panelBolt','skirting','skylight'].map(k=>[k,'steel'])),authority:'design_fill',sources:[{kind:'doc',ref:'t'}]});
 const part=(id:string,authority:'master'|'design_fill')=>({...s.objects[0],id,family:'HALLS',authority});
 s.objects.push(part('WALL_W','design_fill'),part('WALL_E','design_fill'));
 let plan=planSpecExport(s);
 expect(plan.entities.filter(e=>e.id.startsWith('HALLS')).map(e=>e.id)).toEqual(['HALLS-assembly']);
 expect(plan.report.covered.map(c=>c.object)).toEqual(['WALL_E','WALL_W']);
 s.objects.push(part('HALL_001','master'));plan=planSpecExport(s);
 expect(plan.entities.some(e=>e.id==='HALL_001')).toBe(true);
 expect(plan.report.covered.map(c=>c.by)).toEqual(['HALL_001','HALL_001']);
},60000);

test('核心 Goldberg 分区:10f²+2 个面,恰好 12 个五边形,其余六边形',async()=>{
 const {goldbergFaces}=await import('./generators/gen-core');
 for(const f of [1,3,5]){const faces=goldbergFaces(f);expect(faces.length).toBe(10*f*f+2);expect(faces.filter(x=>x.length===5).length).toBe(12);expect(faces.every(x=>x.length===5||x.length===6)).toBe(true);}
});

const buildPack=(mod:any)=>executePackBuild(mod,{packageId:mod.packageId??definePackageId('019fb7ce-6100-7000-8000-000000000000'),readByGuid:async()=>{throw Error('unused');}});

test('GPU Instances 批处理:同网格非绑定件合并为 Float32Array 矩阵批次,保留 ring/band/core 单体,且 audit bindingKey 100% 可解析',async()=>{
 const s=hallSpec(),src=[{kind:'doc' as const,ref:'t'}];
 for(const f of s.families)f.description=f.label;
 s.families[1]!.materialSlots={base:'steel',sideShell:'steel',sleeve:'steel',core:'glow',weakpoint:'glow',fin:'steel',readout:'glow',topCap:'steel'};
 // 3 个同参数 NODE 应合并为一个 GPU Instances 批次;2 个同参数 RING 因匹配 /ring|band|core/i 默认保留单体以供运行时旋转绑定。
 s.families[0]!.generator={id:'GEN-RING-01',params:{outerDiameter:12}};
 s.objects=[
  {id:'RING_A',label:'环A',family:'RING',parent:null,transform:{position:[0,0,7],rotationDeg:[0,0,0],rotationOrder:'XYZ',scale:[1,1,1]},params:{},authority:'master',sources:src,confidence:1,notes:''},
  {id:'RING_B',label:'环B',family:'RING',parent:null,transform:{position:[0,0,8],rotationDeg:[15,0,0],rotationOrder:'XYZ',scale:[1,1,1]},params:{},authority:'master',sources:src,confidence:1,notes:''},
  {id:'CORE_MAIN',label:'核心A',family:'DOOR',parent:null,transform:{position:[0,0,6],rotationDeg:[0,0,0],rotationOrder:'XYZ',scale:[1,1,1]},params:{size:[2,2,2]},authority:'design_fill',sources:src,confidence:1,notes:''},
  {id:'CORE_AUX',label:'核心B',family:'DOOR',parent:null,transform:{position:[0,2,6],rotationDeg:[0,0,0],rotationOrder:'XYZ',scale:[1,1,1]},params:{size:[2,2,2]},authority:'design_fill',sources:src,confidence:1,notes:''},
  {id:'NODE_01',label:'节点1',family:'NODE',parent:null,transform:{position:[-10,-10,0],rotationDeg:[0,0,0],rotationOrder:'XYZ',scale:[1,1,1]},params:{},authority:'master',sources:src,confidence:1,notes:''},
  {id:'NODE_02',label:'节点2',family:'NODE',parent:null,transform:{position:[10,-10,0],rotationDeg:[0,0,90],rotationOrder:'XYZ',scale:[1,1,2]},params:{},authority:'master',sources:src,confidence:1,notes:''},
  {id:'NODE_03',label:'节点3',family:'NODE',parent:null,transform:{position:[10,10,0],rotationDeg:[0,0,180],rotationOrder:'XYZ',scale:[1,1,1]},params:{},authority:'master',sources:src,confidence:1,notes:''},
 ];
 const plan=planSpecExport(s);
 expect(plan.instancing).toEqual({batches:1,totalInstances:3,savedEntities:2});
 expect(plan.instancedInstances).toBe(3);
 expect(plan.instancedBatches).toHaveLength(1);
 const batch=plan.instancedBatches[0]!;
 expect(batch.entityIds).toEqual(['NODE_01','NODE_02','NODE_03']);
 expect(batch.transforms).toBeInstanceOf(Float32Array);
 expect(batch.transforms.length).toBe(48);
 // 验证列主序 4x4 矩阵平移分量与缩放分量:NODE_01 位于 (-10, 0, 10),NODE_02 位于 (10, 0, 10) 且引擎 Y 缩放 2
 expect(Array.from(batch.transforms.slice(12,16))).toEqual([-10,0,10,1]);
 expect(Array.from(batch.transforms.slice(28,32))).toEqual([10,0,10,1]);
 expect(Math.hypot(batch.transforms[20]!,batch.transforms[21]!,batch.transforms[22]!)).toBeCloseTo(2,5);
 // ring / core 单体未被合并,bindingKey 保持自身 ID;NODE_01..03 的 bindingKey 全部指向批次实体键
 for(const rigId of ['RING_A','RING_B','CORE_MAIN','CORE_AUX'])expect(plan.entities.find(e=>e.id===rigId)!.bindingKey).toBe(rigId);
 for(const nodeId of ['NODE_01','NODE_02','NODE_03'])expect(plan.entities.find(e=>e.id===nodeId)!.bindingKey).toBe(batch.key);

 // SPEC_KEEP_RIG_ENTITIES=0 时允许合并 ring/core;SPEC_GPU_INSTANCES=0 时完全关闭硬件实例化
 const prevKeep=process.env.SPEC_KEEP_RIG_ENTITIES,prevInst=process.env.SPEC_GPU_INSTANCES;
 try{
  process.env.SPEC_KEEP_RIG_ENTITIES='0';
  const allBatched=planSpecExport(s);
  expect(allBatched.instancing).toEqual({batches:3,totalInstances:7,savedEntities:4});
  process.env.SPEC_GPU_INSTANCES='0';
  const unbatched=planSpecExport(s);
  expect(unbatched.instancing).toEqual({batches:0,totalInstances:0,savedEntities:0});
 }finally{
  if(prevKeep===undefined)delete process.env.SPEC_KEEP_RIG_ENTITIES;else process.env.SPEC_KEEP_RIG_ENTITIES=prevKeep;
  if(prevInst===undefined)delete process.env.SPEC_GPU_INSTANCES;else process.env.SPEC_GPU_INSTANCES=prevInst;
 }

 // 端到端验证 prepareSpecProject 生成的 scene-audit.json parts.bindingKey 全部命中编译后的 spec.pack 场景实体
 const projDir=mkdtempSync(join(tmpdir(),'spec-proj-inst-'));
 await prepareSpecProject(projDir,s,{id:'spec-inst-test'});
 const audit=JSON.parse(readFileSync(join(projDir,'game/assets/scene-audit.json'),'utf8'));
 expect(audit.parts).toHaveLength(7);
 const packDir=join(projDir,'game/assets/generated');
 writeSpecPack(s,plan,packDir,{packageId:'019fb7ce-6100-7000-8000-000000000011',sourceKey:'scene/spec',name:'实例化测试'});
 const mod=(await import(pathToFileURL(join(packDir,'spec.pack.ts')).href)).default;
 expect(validatePackDefinition(mod).ok).toBe(true);
 const built=await buildPack(mod);
 expect(built.ok).toBe(true);
 const assets=((built as any).value.assets??(built as any).value) as Record<string,any>;
 const sceneEntities=assets['scene/spec'].entities as Record<string,any>;
 expect(Object.keys(sceneEntities)).toHaveLength(5); // 4 个单体 + 1 个 GPU Instances 批次
 expect(sceneEntities[batch.key].components.Instances.transforms).toBeInstanceOf(Float32Array);
 expect(sceneEntities[batch.key].components.Transform).toEqual({pos:[0,0,0],quat:[0,0,0,1],scale:[1,1,1]});
 for(const part of audit.parts)expect(sceneEntities[part.bindingKey]).toBeDefined();
});

test('ProjectedDecal 导出与朝向契约:地面/立面法线对齐、可逆 float32 投影盒、程序化贴图编译及自动切 deferred 管线',async()=>{
 // 1. 地面贴花 [0,0,yaw]:局部 +Z 朝引擎地面法线 +Y;立面贴花 [90,0,yaw]:局部 +Z 水平朝墙外法线且局部 +Y 竖直朝上
 expect(close(rotate(toEngineDecalQuat([0,0,0]),[0,0,1]),[0,1,0])).toBe(true);
 expect(close(rotate(toEngineDecalQuat([0,0,90]),[0,0,1]),[0,1,0])).toBe(true);
 expect(close(rotate(toEngineDecalQuat([90,0,0]),[0,0,1]),[0,0,1])).toBe(true);
 expect(close(rotate(toEngineDecalQuat([90,0,90]),[0,0,1]),[1,0,0])).toBe(true);
 expect(close(rotate(toEngineDecalQuat([90,0,90]),[0,1,0]),[0,1,0])).toBe(true);
 expect(toEngineDecalScale([2,1,0.01])).toEqual([2,1,0.05]);

 const s=sampleSpec();
 s.materials[0]!.surface={pattern:'trim',tilesPerMeter:1};
 s.decals=[
  {id:'STENCIL_01',label:'一区喷字',kind:'stencil',text:'SECTOR 01',color:[0.95,0.78,0.22],position:[0,-8,0.02],rotationDeg:[0,0,0],size:[3.2,0.8,0.25],opacity:0.92,roughness:0.7},
  {id:'HAZARD_01',label:'安全警戒线',kind:'hazard',position:[3,-6,0.02],rotationDeg:[0,0,45],size:[4,0.6,0.2]},
  {id:'PUDDLE_01',label:'地面积水',kind:'puddle',position:[-2,-5,0.02],rotationDeg:[0,0,0],size:[2.4,1.8,0.2],roughness:0.03},
  {id:'WALL_TAG',label:'北墙标识',kind:'stencil',text:'BAY-04',position:[0,28,3],rotationDeg:[90,0,0],size:[2.4,0.6,0.25]},
 ];
 const plan=planSpecExport(s);
 expect(plan.decals).toHaveLength(4);
 for(const d of plan.decals){
  const m=mat4.compose(mat4.create(),d.pos,d.quat,d.scale);
  const inv=mat4.invert(mat4.create(),m);
  expect(mat4.equals(mat4.multiply(mat4.create(),inv,m),mat4.identity(mat4.create()),1e-4)).toBe(true);
 }

 // 2. prepareSpecProject 在未开 GI 但含 decals 时自动切为 renderPath: 'deferred',并编译 spec.pack.ts 验证 ProjectedDecal 与材质
 const projDir=mkdtempSync(join(tmpdir(),'spec-proj-decal-'));
 await prepareSpecProject(projDir,s,{id:'spec-decal-test'});
 const profile=JSON.parse(readFileSync(join(projDir,'render-profile.json'),'utf8'));
 expect(profile.renderPath).toBe('deferred');

 const packDir=join(projDir,'game/assets/generated');
 writeSpecPack(s,plan,packDir,{packageId:'019fb7ce-6100-7000-8000-000000000022',sourceKey:'scene/spec',name:'贴花测试'});
 const mod=(await import(pathToFileURL(join(packDir,'spec.pack.ts')).href)).default;
 const built=await buildPack(mod);
 expect(built.ok).toBe(true);
 const assets=((built as any).value.assets??(built as any).value) as Record<string,any>;
 expect(assets['texture/trim-normal'].shape.extent.width).toBe(1024);
 expect(existsSync(join(projDir,'game/assets/projected-decals.plugin.ts'))).toBe(true);
 const decalPluginSource=readFileSync(join(projDir,'game/assets/projected-decals.plugin.ts'),'utf8');
 expect(decalPluginSource).toContain('ProjectedDecal');
 for(const d of plan.decals){
  expect(decalPluginSource).toContain(d.entityKey);
  expect(assets['material/'+d.material].values.baseColorTexture).toBeDefined();
  expect(assets['material/'+d.material].values.roughnessTexture).toBeDefined();
 }
});

test('离线二进制网格预烘焙:重网格生成 cooked/*.bin 与缓存戳,加载及缺失回退均一致通过',async()=>{
 const s=sampleSpec();
 const prevMin=process.env.SPEC_PRECOOK_MIN_TRIANGLES;
 try{
  process.env.SPEC_PRECOOK_MIN_TRIANGLES='100';
  const projDir=mkdtempSync(join(tmpdir(),'spec-proj-cook-'));
  const {plan}=await prepareSpecProject(projDir,s,{id:'spec-cook-test'});
  expect(plan.meshes[0]!.triangles).toBeGreaterThanOrEqual(100);
  const packDir=join(projDir,'game/assets/generated');
  const receipt=writeSpecPack(s,plan,packDir,{packageId:'019fb7ce-6100-7000-8000-000000000033',sourceKey:'scene/spec',name:'预烘焙测试'});
  expect(receipt.precookedMeshCount).toBe(1);
  const binPath=join(packDir,'cooked',plan.meshes[0]!.key+'.bin');
  expect(existsSync(binPath)).toBe(true);
  expect(readFileSync(join(packDir,'cooked-stamp.ts'),'utf8')).not.toContain('"none"');

  const mod=(await import(pathToFileURL(join(packDir,'spec.pack.ts')).href)).default;
  const builtCooked=await buildPack(mod);
  expect(builtCooked.ok).toBe(true);
  const meshFromBin=(((builtCooked as any).value.assets??(builtCooked as any).value) as Record<string,any>)['mesh/'+plan.meshes[0]!.key];
  expect(meshFromBin.indices.length/3).toBe(plan.meshes[0]!.triangles);

  // 删除 .bin 后回退到实时 runGenerator 仍得到一致网格
  rmSync(binPath);
  const builtFallback=await buildPack(mod);
  expect(builtFallback.ok).toBe(true);
  const meshFallback=(((builtFallback as any).value.assets??(builtFallback as any).value) as Record<string,any>)['mesh/'+plan.meshes[0]!.key];
  expect(meshFallback.indices.length).toBe(meshFromBin.indices.length);
  expect(Array.from(meshFallback.aabb)).toEqual(Array.from(meshFromBin.aabb));
 }finally{
  if(prevMin===undefined)delete process.env.SPEC_PRECOOK_MIN_TRIANGLES;else process.env.SPEC_PRECOOK_MIN_TRIANGLES=prevMin;
 }
});
