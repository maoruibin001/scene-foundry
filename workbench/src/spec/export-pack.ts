import {bindDimensionalAliases} from './parameter-binding';
/**
 * 规格 → 引擎场景 pack。网格在导出期跨 Bun Worker 线程并行生成并缓存到内存与 .mesh-cache,
 * writeSpecPack 默认预烘焙 100% 程序化网格与程序化表面贴图到 cooked/*.bin,使引擎构建零重复计算;
 * pack 源码同时保留"生成器 ID + 参数"与实时回退分支(手册 4.2 editable_geometry)。
 * 缺少库生成器的资产族按手册 4.3 回退为同 ID 灰模代理并写入 repair 列表,不静默丢弃。
 * 坐标:规格右手、米、Z 向上 → 引擎 Y 向上,位置 (x,y,z)→(x,z,-y);旋转按 X、Y、Z 依次绕固定轴。
 */
import {cpSync,existsSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {mat4} from '@forgeax/engine/math';
import {AssetGuid} from '@forgeax/engine/pack/guid';
import {definePackageId} from '@forgeax/engine/pack/source';
import type {MeshAsset} from '@forgeax/engine/types';
import {GENERATORS,GENERATOR_SOURCES} from './generators/index';
import {resolveParams,runGenerator,type ParamValue} from './generators/kit';
import {surfaceMaps,type SurfacePattern} from './generators/textures';
import {
 bufferToStandaloneArrayBuffer,
 bumpParallelStat,
 decodeCookedMesh,
 encodeCookedMesh,
 runWorkerTasks,
 type CookedDType,
 type CookedMeshMeta,
 type CookedSlice,
 type WorkerTaskPayload,
} from './parallel-assets';
import type {SceneSpec,SpecDecal,SpecMaterial,SpecObject,Vec3} from './schema';

export type {CookedDType,CookedSlice,CookedMeshMeta};
export type Quat=[number,number,number,number];
export const toEnginePosition=(p:Vec3):Vec3=>[p[0],p[2],-p[1]];
export const toEngineScale=(s:Vec3):Vec3=>[s[0],s[2],s[1]];
const axisQuat=(axis:Vec3,deg:number):Quat=>{const h=deg*Math.PI/360,s=Math.sin(h);return [axis[0]*s,axis[1]*s,axis[2]*s,Math.cos(h)];};
const mul=(a:Quat,b:Quat):Quat=>[a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];
/** 规格 XYZ 欧拉(度,依次绕固定 X、Y、Z)→ 引擎四元数 [x,y,z,w]:规格 X→引擎 X,规格 Y→引擎 -Z,规格 Z→引擎 Y。 */
export function toEngineQuat(r:Vec3):Quat{
 return mul(axisQuat([0,1,0],r[2]),mul(axisQuat([0,0,-1],r[1]),axisQuat([1,0,0],r[0])));
}
/**
 * 贴花投影盒旋转:引擎 ProjectedDecal 约定单位盒 [-0.5..0.5]^3 的局部 +Z 朝向受投表面法线,局部 +X/+Y 为贴花切平面宽高。
 * 右乘绕引擎 +X 转 -90° 的基准四元数,将贴花局部 (+X,+Y,+Z) 映到规格 (+X,+Y,+Z) = 引擎 (+X,-Z,+Y):
 * - rotationDeg=[0,0,yaw] → 水平地面贴花,局部 +Z 朝引擎 +Y(地面法线),绕竖直轴旋 yaw;
 * - rotationDeg=[90,0,yaw] → 竖直墙面贴花,局部 +Z 水平朝墙外法线,局部 +Y 竖直朝 +Y(文字正立)。
 */
export function toEngineDecalQuat(r:Vec3):Quat{
 return mul(toEngineQuat(r),axisQuat([1,0,0],-90));
}
export const toEngineDecalScale=(s:Vec3):Vec3=>[Math.max(0.05,s[0]),Math.max(0.05,s[1]),Math.max(0.05,s[2])];
export function packInstanceTransforms(items:readonly Pick<ExportEntity,'pos'|'quat'|'scale'>[]):Float32Array{
 const out=new Float32Array(items.length*16);
 items.forEach((it,i)=>{mat4.compose(out.subarray(i*16,i*16+16),it.pos,it.quat,it.scale);});
 return out;
}
export const sourceSegment=(id:string)=>id.toLowerCase().replace(/[^a-z0-9._-]+/g,'-').replace(/^[^a-z0-9]+/,'');

/** aabb:网格局部包围盒(引擎 Y 向上)[minX,minY,minZ,maxX,maxY,maxZ],供取景检查与地标使用。 */
export type ExportMesh={key:string;family:string;generator:string;params:Record<string,ParamValue>;slots:Record<string,string>;triangles:number;aabb:number[]};
export type ExportEntity={id:string;label:string;mesh:string;pos:Vec3;quat:Quat;scale:Vec3;bindingKey:string};
export type ExportInstanceBatch={key:string;label:string;mesh:string;entityIds:string[];transforms:Float32Array};
export type ExportDecal={id:string;entityKey:string;label:string;kind:SpecDecal['kind'];text:string;color:Vec3;material:string;pos:Vec3;quat:Quat;scale:Vec3;order:number;opacity:number;roughness:number;normalThreshold:number;colorOpacity:number;normalOpacity:number;roughnessOpacity:number};
export type ExportReport={unresolved:{object:string;family:string;key:string;input:unknown;reason:string}[];expanded:{object:string;count:number}[];slotFallbacks:{family:string;slot:string;material:string}[];covered:{object:string;family:string;by:string}[];proxies:{object:string;family:string;reason:string}[];dropped:{family:string;key:string;reason:string}[];derived:{object:string;key:string;value:ParamValue}[];errors:string[]};
export type ExportPlan={meshes:ExportMesh[];entities:ExportEntity[];materials:{key:string;options:Record<string,unknown>;surface?:{pattern:string;tilesPerMeter:number}}[];decals:ExportDecal[];instancing:{batches:number;totalInstances:number;savedEntities:number};instancedBatches:ExportInstanceBatch[];instancedInstances:number;report:ExportReport;triangles:number};

export interface ExportPlanTelemetry{
 parallelWorkers:number;
 durationMs:number;
 uniqueMeshes:number;
 workerMeshBuilds:number;
 meshCacheHits:number;
 surfaceBuilds:number;
}

type CachedMeshRecord={
 contentHash:string;
 asset:MeshAsset;
 bin:Buffer;
 meta:CookedMeshMeta;
 rawAabb:number[];
 triangles:number;
};
type CachedSurfaceRecord={bin:Buffer;size:number;sha256:string};
type DiskMeshManifest={version:1;key:string;contentHash:string;rawAabb:number[];triangles:number;meta:CookedMeshMeta};

const MAX_MEM_MESHES=512;
const MAX_MEM_SURFACES=16;
const COOKED_MESH_CACHE=new WeakMap<ExportMesh,MeshAsset>();
const MESH_BY_KEY_CACHE=new Map<string,CachedMeshRecord>();
const SURFACE_BY_KEY_CACHE=new Map<string,CachedSurfaceRecord>();
const PLAN_TELEMETRY=new WeakMap<ExportPlan,ExportPlanTelemetry>();
const RIG_ENTITY_RE=/ring|band|core/i;
const HEAVY_GEN_RE=/HALL|CORE|FUTURE|WALLKIT|RING|WALK|STAIR/i;
const GLOBAL_SURFACE_CACHE_DIR=join(tmpdir(),'scene-foundry-surface-cache-v1');
const GENERATOR_KIT_DIGEST=(()=>{
 const h=createHash('sha256');
 for(const file of GENERATOR_SOURCES){
  h.update(file);
  h.update(readFileSync(join(import.meta.dir,'generators',file)));
 }
 return h.digest('hex').slice(0,12);
})();

function hash(v:unknown){return createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0,10);}
const meshContentHash=(generator:string,params:Record<string,ParamValue>)=>hash({g:generator,params});

function setBounded<K,V>(map:Map<K,V>,key:K,val:V,limit:number){
 if(map.has(key))map.delete(key);
 map.set(key,val);
 while(map.size>limit){
  const oldest=map.keys().next().value;
  if(oldest===undefined)break;
  map.delete(oldest);
 }
}

function envMeshCacheDirs(extraDir?:string):string[]{
 const out:string[]=[];
 const push=(d?:string)=>{if(d&&!out.includes(d))out.push(d);};
 push(extraDir);
 push(process.env.SPEC_MESH_CACHE_DIR);
 if(process.env.ASSET_PIPELINE_ROOT)push(join(process.env.ASSET_PIPELINE_ROOT,'.mesh-cache'));
 return out;
}

function atomicWrite(filePath:string,content:Buffer|string){
 const tmp=`${filePath}.${process.pid}.${Math.random().toString(36).slice(2,8)}.tmp`;
 writeFileSync(tmp,content);
 renameSync(tmp,filePath);
}

function loadMeshFromDisk(key:string,expectedHash:string,dirs:readonly string[]):CachedMeshRecord|null{
 for(const dir of dirs){
  const jsonPath=join(dir,`${key}.json`),binPath=join(dir,`${key}.bin`);
  if(!existsSync(jsonPath)||!existsSync(binPath))continue;
  try{
   const parsed=JSON.parse(readFileSync(jsonPath,'utf8')) as DiskMeshManifest;
   if(parsed.version!==1||parsed.contentHash!==expectedHash)continue;
   const raw=readFileSync(binPath);
   if(raw.byteLength!==parsed.meta.byteLength)continue;
   const ab=bufferToStandaloneArrayBuffer(raw);
   const asset=decodeCookedMesh(ab,parsed.meta);
   const rec:CachedMeshRecord={
    contentHash:expectedHash,
    asset,
    bin:Buffer.from(ab),
    meta:parsed.meta,
    rawAabb:parsed.rawAabb,
    triangles:parsed.triangles,
   };
   setBounded(MESH_BY_KEY_CACHE,key,rec,MAX_MEM_MESHES);
   return rec;
  }catch{
   continue;
  }
 }
 return null;
}

function saveMeshToDisk(cacheDir:string,key:string,rec:CachedMeshRecord){
 mkdirSync(cacheDir,{recursive:true});
 const manifest:DiskMeshManifest={
  version:1,
  key,
  contentHash:rec.contentHash,
  rawAabb:rec.rawAabb,
  triangles:rec.triangles,
  meta:rec.meta,
 };
 atomicWrite(join(cacheDir,`${key}.bin`),rec.bin);
 atomicWrite(join(cacheDir,`${key}.json`),JSON.stringify(manifest));
}

function getCachedMeshRecord(key:string,generator:string,params:Record<string,ParamValue>,extraDirs:readonly string[]=[]):CachedMeshRecord|null{
 const expectedHash=meshContentHash(generator,params);
 const mem=MESH_BY_KEY_CACHE.get(key);
 if(mem&&mem.contentHash===expectedHash){
  bumpParallelStat('meshCacheHits');
  return mem;
 }
 const dirs=[...extraDirs,...envMeshCacheDirs()];
 const disk=loadMeshFromDisk(key,expectedHash,dirs);
 if(disk){
  bumpParallelStat('meshCacheHits');
  return disk;
 }
 return null;
}

/** 0ms 获取已生成/已缓存的 MeshAsset(按 ExportMesh 引用、mesh.key 内存缓存或 .mesh-cache 磁盘缓存查找)。 */
export function getCachedMeshAsset(mesh:ExportMesh,cacheDir?:string):MeshAsset|undefined{
 if(mesh.generator==='proxy')return undefined;
 const byObj=COOKED_MESH_CACHE.get(mesh);
 if(byObj){
  bumpParallelStat('meshCacheHits');
  return byObj;
 }
 const rec=getCachedMeshRecord(mesh.key,mesh.generator,mesh.params,cacheDir?[cacheDir]:[]);
 if(rec){
  COOKED_MESH_CACHE.set(mesh,rec.asset);
  return rec.asset;
 }
 return undefined;
}

/** 清空进程级按 key 网格与表面贴图缓存(供跨进程 .mesh-cache 命中测试与内存回收使用)。 */
export function clearMeshCaches(){
 MESH_BY_KEY_CACHE.clear();
 SURFACE_BY_KEY_CACHE.clear();
}

export function inspectSpecParameters(spec:SceneSpec){return prepareExportPlacements(spec).report;}

export const getExportPlanTelemetry=(plan:ExportPlan):ExportPlanTelemetry|undefined=>PLAN_TELEMETRY.get(plan);

function surfaceFileName(safeKey:string,size:number){
 return `surface-${safeKey}-${size}.bin`;
}
function globalSurfaceCachePath(safeKey:string,size:number){
 return join(GLOBAL_SURFACE_CACHE_DIR,`${GENERATOR_KIT_DIGEST}-${safeKey}-${size}.bin`);
}

function collectSurfaceSpecs(materials:ExportPlan['materials']):{pattern:string;safeKey:string;size:number}[]{
 const patterns=[...new Set(materials.flatMap(m=>m.surface&&!m.surface.pattern.startsWith('polyhaven:')?[m.surface.pattern]:[]))];
 return patterns.map(pattern=>({
  pattern,
  safeKey:sourceSegment(pattern),
  size:pattern==='deck'||pattern==='worn'||pattern==='trim'?1024:256,
 }));
}

function getCachedSurfaceRecord(pattern:string,safeKey:string,size:number,extraDirs:readonly string[]=[],useGlobal=true):CachedSurfaceRecord|null{
 const memKey=`${pattern}:${size}`;
 const mem=SURFACE_BY_KEY_CACHE.get(memKey);
 if(mem){
  bumpParallelStat('surfaceCacheHits');
  return mem;
 }
 const expectedLen=size*size*4*3;
 const file=surfaceFileName(safeKey,size);
 const candidates=[...extraDirs,...envMeshCacheDirs()].map(dir=>join(dir,file));
 if(useGlobal&&process.env.SPEC_GLOBAL_SURFACE_CACHE!=='0')candidates.push(globalSurfaceCachePath(safeKey,size));
 for(const p of candidates){
  if(!existsSync(p))continue;
  try{
   const raw=readFileSync(p);
   if(raw.byteLength!==expectedLen)continue;
   const ab=bufferToStandaloneArrayBuffer(raw);
   const bin=Buffer.from(ab);
   const sha256=createHash('sha256').update(bin).digest('hex').slice(0,16);
   const rec:CachedSurfaceRecord={bin,size,sha256};
   setBounded(SURFACE_BY_KEY_CACHE,memKey,rec,MAX_MEM_SURFACES);
   bumpParallelStat('surfaceCacheHits');
   return rec;
  }catch{
   continue;
  }
 }
 return null;
}

function saveSurfaceToDisk(cacheDir:string,safeKey:string,rec:CachedSurfaceRecord){
 mkdirSync(cacheDir,{recursive:true});
 atomicWrite(join(cacheDir,surfaceFileName(safeKey,rec.size)),rec.bin);
}
function saveGlobalSurfaceCache(safeKey:string,rec:CachedSurfaceRecord){
 if(process.env.SPEC_GLOBAL_SURFACE_CACHE==='0')return;
 try{
  mkdirSync(GLOBAL_SURFACE_CACHE_DIR,{recursive:true});
  const target=globalSurfaceCachePath(safeKey,rec.size);
  if(!existsSync(target))atomicWrite(target,rec.bin);
 }catch{}
}

function buildSurfaceSync(pattern:string,safeKey:string,size:number):CachedSurfaceRecord{
 bumpParallelStat('surfaceMainThreadRuns');
 let t:ReturnType<typeof surfaceMaps>;
 try{t=surfaceMaps(pattern as SurfacePattern,size);if(!t?.normal)throw 0;}
 catch{t=surfaceMaps('panel' as SurfacePattern,size);}
 const plane=t.size*t.size*4;
 const ab=new ArrayBuffer(plane*3),u8=new Uint8Array(ab);
 u8.set(t.normal,0);
 u8.set(t.metallicRoughness,plane);
 u8.set(t.baseColor,plane*2);
 const bin=Buffer.from(ab);
 const sha256=createHash('sha256').update(u8).digest('hex').slice(0,16);
 const rec:CachedSurfaceRecord={bin,size:t.size,sha256};
 setBounded(SURFACE_BY_KEY_CACHE,`${pattern}:${size}`,rec,MAX_MEM_SURFACES);
 saveGlobalSurfaceCache(safeKey,rec);
 return rec;
}

export const PROXY_MATERIAL='spec-proxy';
export function materialOptions(m:SpecMaterial){
 // 只传非默认的物理层:引擎按传入字段启用清漆/透射层,透射材质自动关闭深度写入。
 return {baseColor:m.baseColor,metallic:m.metallic,roughness:m.roughness,
  ...(m.emissive&&m.emissiveIntensity>0?{emissive:m.emissive,emissiveIntensity:m.emissiveIntensity}:{}),
  // 清透玻璃:alpha 混合 + 不写深度 + 双面;透射关闭(两者互斥,透射会把后方发光体模糊成乳白)。
  ...(m.opacity!=null&&m.opacity<1?{baseColor:[m.baseColor[0],m.baseColor[1],m.baseColor[2],m.opacity],renderState:{blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}},depthWriteEnabled:false,cullMode:'none'}}
   :m.transmission>0?{transmission:m.transmission,ior:m.ior,thickness:m.thickness}:{}),
  ...(m.clearcoat>0?{clearcoat:m.clearcoat,clearcoatRoughness:m.clearcoatRoughness,staticSwitches:{clearcoat:true}}:{})};
}

type PendingPlacement=
 |{kind:'proxy';object:SpecObject;mesh:ExportMesh}
 |{kind:'generated';object:SpecObject;family:SceneSpec['families'][number];key:string;generatorId:string;params:Record<string,ParamValue>};

type UniqueMeshJob={key:string;generatorId:string;params:Record<string,ParamValue>;family:string};
type BuiltMeshOutcome={ok:true;record:CachedMeshRecord}|{ok:false;error:string};

function prepareExportPlacements(spec:SceneSpec){
 const report:ExportReport={unresolved:[],expanded:[],slotFallbacks:[],covered:[],proxies:[],dropped:[],derived:[],errors:[]};
 // 平面反射只作用于反射对象所属族里的光滑材质(roughness≤0.15,如池水);引擎要求材质在 pack 里烘焙该开关。
 const state=spec.lighting.states.find(s=>s.id===spec.lighting.defaultState),planar=state?.post.planarReflections[0];
 const planarFamily=planar?spec.families.find(f=>f.id===spec.objects.find(o=>o.id===planar.object)?.family):undefined;
 const mirrored=new Set(Object.values(planarFamily?.materialSlots??{}).filter(id=>(spec.materials.find(m=>m.id===id)?.roughness??1)<=0.15));
 // 质感默认:没有指定表面纹样、不发光、不透光的材质自动套"使用痕迹"纹样(粗糙度/底色变化,去塑料感);
 // 规格写 surface:null 以外的值或 SPEC_DEFAULT_WEAR=0 时不套。
 const wear=(m:SceneSpec['materials'][number])=>process.env.SPEC_DEFAULT_WEAR!=='0'&&m.surface===undefined&&!(m.emissiveIntensity>0)&&!((m.transmission??0)>0.3)&&!((m as any).opacity<1)?{pattern:'worn',tilesPerMeter:0.8}:null;
 const materials=spec.materials.map(m=>{const surface=m.surface??wear(m);return {key:sourceSegment(m.id),options:{...materialOptions(m),...(mirrored.has(m.id)?{planarReflection:true}:{})},...(surface?{surface}:{})};});
 // 灰模代理压成暗色:它只占位,不应在画面里抢眼(仍保留可见,如实标示缺生成器)。
 materials.push({key:PROXY_MATERIAL,options:{baseColor:[0.06,0.065,0.07,1],metallic:0.3,roughness:0.6}});

 const expanded=expandInstances(spec.objects,report);
 const placements:PendingPlacement[]=[];
 const uniqueJobs=new Map<string,UniqueMeshJob>();

 for(const family of spec.families){
  let objects=expanded.filter(o=>o.family===family.id).sort((a,b)=>a.id.localeCompare(b.id));
  const baseGen=family.generator?GENERATORS[family.generator.id]:undefined;
  if(baseGen?.assembly&&objects.length){
   // 整组生成器:主控对象作实例(没有就在族原点合成一个),其余对象是它的组成部分,不再各出一份网格。
   const masters=objects.filter(o=>o.authority==='master');
   const instance=masters[0]??{...objects[0]!,id:`${family.id}-assembly`,label:`${family.label}(整组)`,transform:{...objects[0]!.transform,position:[0,0,0] as Vec3,rotationDeg:[0,0,0] as Vec3,scale:[1,1,1] as Vec3},params:{}};
   for(const o of objects)if(o.id!==instance.id&&!masters.slice(1).includes(o))report.covered.push({object:o.id,family:family.id,by:instance.id});
   objects=[instance,...masters.slice(1)];
  }
  const sourceFamily=family;
  objects.forEach((o:SpecObject,index)=>{
   const family=o.geometryBinding?{...sourceFamily,generator:o.geometryBinding}:sourceFamily;
   const gen=o.geometryBinding?GENERATORS[o.geometryBinding.id]:baseGen;
   const inputParams=o.geometryBinding?{}:o.params;
   const addProxy=(reason:string)=>{
    const rawSize=o.params.size??o.params.envelope??family.generator?.params.size;
    const size=Array.isArray(rawSize)&&rawSize.length===3&&rawSize.every(n=>typeof n==='number'&&Number.isFinite(n)&&n>0)?rawSize as Vec3:null;
    report.proxies.push({object:o.id,family:family.id,reason});
    const params={size:size??[1,1,1],floor:o.transform.position[2]<=0.05};
    const [sx,sy,sz]=params.size,base=params.floor?0:-sz/2;
    const mesh:ExportMesh={key:`${sourceSegment(family.id)}-proxy-${hash(params)}`,family:family.id,generator:'proxy',params:params as any,slots:{proxy:PROXY_MATERIAL},triangles:12,aabb:[-sx/2,base,-sy/2,sx/2,base+sz,sy/2]};
    placements.push({kind:'proxy',object:o,mesh});
   };
   if(!gen){addProxy(family.generator?`生成器 ${family.generator.id} 尚未实现`:'资产族未指定生成器');return;}
   const pending:{key:string;input:unknown;reason:string}[]=[];
   const merged:Record<string,ParamValue>={};
   // 族参数与对象参数分别过生成器适配(区间/合并向量 → 生成器参数),对象值覆盖族值。
   const ctx={id:o.id,position:o.transform.position},binding=bindDimensionalAliases(gen,{...family.generator!.params,...inputParams},ctx);
   const familyParams={},objectParams=binding.values;
   report.derived.push(...binding.derived.map(q=>({object:o.id,...q})));
   for(const [key,value] of Object.entries({...familyParams,...objectParams})){
    const drop=(reason:string)=>{if(!report.dropped.some(d=>d.family===family.id&&d.key===key))report.dropped.push({family:family.id,key,reason});};
    if(!(key in gen.params)){
     const structural=/^(size|envelope|path|position|rotation|scale|dimensions|footprint)$/i.test(key);
     if(structural)pending.push({key,input:value,reason:'生成器没有可验证的结构参数映射'});
     else drop('生成器没有这个参数（未改变几何要求）');
     continue;
    }

    if(Array.isArray(value)&&gen.params[key]!.type!=='vec3'&&gen.params[key]!.type!=='list'){
     // 手册里一族多尺寸/区间(外径 11/13/15、管径 0.1/0.25/0.5、件数 [4,6])按族内对象序号确定性分配;模型复制到对象级 params 时同样生效。
     if(value.length===objects.length){
      const picked=value[index]!;
      if(!resolveParams(gen,{[key]:picked}).errors.length){merged[key]=picked;report.derived.push({object:o.id,key,value:picked});continue;}
     }
     pending.push({key,input:value,reason:`列表无法按族内对象数 ${objects.length} 唯一对应`});continue;
    }
    if(resolveParams(gen,{[key]:value}).errors.length){
     // 模型在对象 params 上生成的布尔/超界/枚举猜测参数统一走合约回退:回退到族级合法值或生成器默认值并记录在 report.dropped,不让非结构性参数猜测打崩整厅构建。
     pending.push({key,input:value,reason:`输入不合 ${gen.id} 参数契约，未使用默认值替代`});continue;
    }
    const canonical=resolveParams(gen,{[key]:value}).params[key];merged[key]=canonical as ParamValue;
    if(JSON.stringify(canonical)!==JSON.stringify(value))report.derived.push({object:o.id,key,value:canonical as ParamValue});
   }
   if(pending.length){for(const q of pending)report.unresolved.push({object:o.id,family:family.id,...q});addProxy('关键参数待处理：'+pending.map(q=>q.key).join(', '));return;}
   const {params,errors}=resolveParams(gen,merged);
   if(errors.length){report.errors.push(...errors.map(e=>`${o.id}: ${e}`));return;}
   const key=`${sourceSegment(family.id)}-${meshContentHash(gen.id,params as Record<string,ParamValue>)}`;
   if(!uniqueJobs.has(key)){
    uniqueJobs.set(key,{key,generatorId:gen.id,params:params as Record<string,ParamValue>,family:family.id});
   }
   placements.push({kind:'generated',object:o,family,key,generatorId:gen.id,params:params as Record<string,ParamValue>});
  });
 }
 return {report,materials,placements,uniqueJobs};
}

function finalizeExportPlan(
 spec:SceneSpec,
 prepared:ReturnType<typeof prepareExportPlacements>,
 resolveBuilt:(job:UniqueMeshJob)=>BuiltMeshOutcome,
):ExportPlan{
 const {report,materials,placements}=prepared;
 const meshes=new Map<string,ExportMesh>(),entities:ExportEntity[]=[];
 const matKey=(id:string)=>sourceSegment(id);

 for(const item of placements){
  const o=item.object;
  let mesh:ExportMesh;
  if(item.kind==='proxy'){
   mesh=meshes.get(item.mesh.key)??item.mesh;
   meshes.set(mesh.key,mesh);
  }else{
   const {family,key,generatorId,params}=item;
   if(!meshes.has(key)){
    const outcome=resolveBuilt({key,generatorId,params,family:family.id});
    if(!outcome.ok){report.errors.push(`${o.id}: ${outcome.error.slice(0,300)}`);continue;}
    const {asset,rawAabb,triangles}=outcome.record;
    const slots:Record<string,string>={};
    // 规格没写到的生成器槽用本族最常用的材质补上(留痕);族里一个材质都没有才算错误。
    const used=Object.values(family.materialSlots),common=used.sort((a,b)=>used.filter(x=>x===b).length-used.filter(x=>x===a).length)[0];
    const missing=(asset.materialSlots??[]).map(s=>s.slotName).filter(n=>!family.materialSlots[n]);
    if(missing.length&&!common){report.errors.push(`${family.id}: 生成器槽 ${missing.join(',')} 在规格材质槽里没有对应材质`);continue;}
    for(const slot of missing)if(!report.slotFallbacks.some(f=>f.family===family.id&&f.slot===slot))report.slotFallbacks.push({family:family.id,slot,material:common!});
    for(const s of asset.materialSlots??[])slots[s.slotName]=matKey(family.materialSlots[s.slotName]??common!);
    const entry:ExportMesh={key,family:family.id,generator:generatorId,params:params as any,slots,triangles,aabb:rawAabb};
    COOKED_MESH_CACHE.set(entry,asset);
    meshes.set(key,entry);
   }
   mesh=meshes.get(key)!;
   meshes.set(mesh.key,mesh);
  }
  // 贴墙立面朝向校正:GEN-WALLKIT-01 的正面是局部 +Z(不旋转时朝规格 -Y);按对象离哪面墙最近,
  // 把绕 Z 的角度改成正面朝场景中心(西墙 90、东墙 -90、北墙 180、南墙 0)。模型常把左右写反,看到的是背板。
  let rot=o.transform.rotationDeg;
  if(mesh.generator==='GEN-WALLKIT-01'&&process.env.SPEC_WALL_FIX!=='0'){
   const [x,y]=o.transform.position,b=spec.bounds,dx=Math.min(x-b.min[0],b.max[0]-x),dy=Math.min(y-b.min[1],b.max[1]-y);
   const yaw=dx<dy?(x<(b.min[0]+b.max[0])/2?90:-90):(y>(b.min[1]+b.max[1])/2?180:0);
   if(Math.abs((((rot[2]-yaw)%360)+540)%360-180)>1){report.derived.push({object:o.id,key:'rotationDeg',value:[rot[0],rot[1],yaw]});rot=[rot[0],rot[1],yaw];}
  }
  // 贴侧墙的回廊与楼梯:长轴(局部 Z,不旋转时沿规格 Y)应顺墙走;贴南北端墙时应转 90° 沿规格 X 顺墙走。
  if(['GEN-WALK-01','GEN-STAIR-01'].includes(mesh.generator)){
   const [x,y]=o.transform.position,b=spec.bounds,dx=Math.min(x-b.min[0],b.max[0]-x),dy=Math.min(y-b.min[1],b.max[1]-y);
   const halfX=(b.max[0]-b.min[0])/2,halfY=(b.max[1]-b.min[1])/2;
   const yaw=((rot[2]%360)+360)%360;
   if(dx<halfX*0.35&&(Math.abs(yaw-90)<1||Math.abs(yaw-270)<1)){report.derived.push({object:o.id,key:'rotationDeg',value:[rot[0],rot[1],0]});rot=[rot[0],rot[1],0];}
   else if(mesh.generator==='GEN-WALK-01'&&dy<halfY*0.35&&dx>=halfX*0.35&&(yaw<1||Math.abs(yaw-180)<1)){report.derived.push({object:o.id,key:'rotationDeg',value:[rot[0],rot[1],90]});rot=[rot[0],rot[1],90];}
  }
  // 玻璃控制室朝向校正:GEN-CONTROLROOM-01 的玻璃观察立面在局部 +X;东侧(x>0)必须绕 Z 转 180° 让玻璃窗朝大厅中心(-X),西侧(x<0)为 0°。
  if(mesh.generator==='GEN-CONTROLROOM-01'){
   const [x]=o.transform.position,cx=(spec.bounds.min[0]+spec.bounds.max[0])/2;
   if(Math.abs(x-cx)>4){
    const targetYaw=x>cx?180:0;
    if(Math.abs((((rot[2]-targetYaw)%360)+540)%360-180)>1){report.derived.push({object:o.id,key:'rotationDeg',value:[rot[0],rot[1],targetYaw]});rot=[rot[0],rot[1],targetYaw];}
   }
  }
  entities.push({id:o.id,label:o.label,mesh:mesh.key,pos:toEnginePosition(o.transform.position),quat:toEngineQuat(rot),scale:toEngineScale(o.transform.scale),bindingKey:o.id});
 }

 const usedKeys=new Set(entities.map(e=>e.id));
 const instancedBatches:ExportInstanceBatch[]=[];
 if(process.env.SPEC_GPU_INSTANCES!=='0'){
  const keepRig=process.env.SPEC_KEEP_RIG_ENTITIES!=='0';
  const byMesh=new Map<string,ExportEntity[]>();
  for(const e of entities){
   if(keepRig&&RIG_ENTITY_RE.test(e.id))continue;
   const g=byMesh.get(e.mesh)??[];g.push(e);byMesh.set(e.mesh,g);
  }
  for(const [meshKey,group] of byMesh){
   if(group.length<2)continue;
   let key=`inst_${meshKey}`;while(usedKeys.has(key))key+='_b';usedKeys.add(key);
   for(const e of group)e.bindingKey=key;
   instancedBatches.push({key,label:`${group[0]!.label} (×${group.length})`,mesh:meshKey,entityIds:group.map(e=>e.id),transforms:packInstanceTransforms(group)});
  }
 }
 const instancedInstances=instancedBatches.reduce((n,b)=>n+b.entityIds.length,0);
 const instancing={batches:instancedBatches.length,totalInstances:instancedInstances,savedEntities:instancedInstances-instancedBatches.length};
 const decals:ExportDecal[]=(spec.decals??[]).map((d,idx)=>{
  const color:Vec3=d.color??(d.kind==='hazard'?[0.92,0.62,0.05]:d.kind==='puddle'?[0.03,0.035,0.045]:[0.92,0.74,0.22]);
  const roughness=d.roughness??(d.kind==='puddle'?0.04:d.kind==='hazard'?0.58:0.72);
  const text=(d.text??d.label??'SECTOR 01').trim();
  const matKeyDecal=`decal-${d.kind}-${hash({kind:d.kind,text:d.kind==='stencil'?text:'',color,roughness})}`;
  let entityKey=`decal_${d.id}`;while(usedKeys.has(entityKey))entityKey+='_d';usedKeys.add(entityKey);
  return {
   id:d.id,entityKey,label:d.label,kind:d.kind,text,color,material:matKeyDecal,
   pos:toEnginePosition(d.position),quat:toEngineDecalQuat(d.rotationDeg),scale:toEngineDecalScale(d.size),
   order:d.kind==='puddle'?idx:10+idx,opacity:d.opacity??0.9,roughness,
   normalThreshold:d.kind==='puddle'?0.5:0.25,
   colorOpacity:d.kind==='puddle'?0.38:1,
   normalOpacity:d.kind==='puddle'?0.85:0,
   roughnessOpacity:d.kind==='puddle'?0.95:0.7,
  };
 });
 const triangles=entities.reduce((n,e)=>n+(meshes.get(e.mesh)?.triangles??0),0);
 return {meshes:[...meshes.values()],entities,materials,decals,instancing,instancedBatches,instancedInstances,report,triangles};
}

export function planSpecExport(spec:SceneSpec):ExportPlan{
 const prepared=prepareExportPlacements(spec);
 const outcomes=new Map<string,BuiltMeshOutcome>();
 return finalizeExportPlan(spec,prepared,job=>{
  const existing=outcomes.get(job.key);
  if(existing)return existing;
  const cached=getCachedMeshRecord(job.key,job.generatorId,job.params);
  if(cached){
   const out:BuiltMeshOutcome={ok:true,record:cached};
   outcomes.set(job.key,out);
   return out;
  }
  try{
   bumpParallelStat('meshMainThreadRuns');
   const gen=GENERATORS[job.generatorId]!;
   const asset=runGenerator(gen,job.params as any,job.key);
   const triangles=(asset.indices?.length??0)/3;
   const rawAabb=Array.from(asset.aabb as ArrayLike<number>);
   const {bin,meta}=encodeCookedMesh(asset);
   const record:CachedMeshRecord={
    contentHash:meshContentHash(job.generatorId,job.params),
    asset,
    bin,
    meta,
    rawAabb,
    triangles,
   };
   setBounded(MESH_BY_KEY_CACHE,job.key,record,MAX_MEM_MESHES);
   const out:BuiltMeshOutcome={ok:true,record};
   outcomes.set(job.key,out);
   return out;
  }catch(error){
   return {ok:false,error:String(error)};
  }
 });
}

/**
 * 跨 Bun Worker 线程池并行执行所有唯一网格生成器与程序化表面贴图,
 * 并将构建出的 MeshAsset 存入内存缓存(WeakMap + Map)与可选 .mesh-cache 目录。
 */
export async function planSpecExportParallel(
 spec:SceneSpec,
 opts?:{concurrency?:number;cacheDir?:string;precookSurfaces?:boolean;useGlobalSurfaceCache?:boolean},
):Promise<ExportPlan>{
 const t0=performance.now();
 const prepared=prepareExportPlacements(spec);
 const outcomes=new Map<string,BuiltMeshOutcome>();
 const extraDirs=opts?.cacheDir?[opts.cacheDir]:[];
 const useGlobalSurfaceCache=opts?.useGlobalSurfaceCache??true;
 let meshCacheHits=0;

 const uncachedMeshes:UniqueMeshJob[]=[];
 for(const job of prepared.uniqueJobs.values()){
  const cached=getCachedMeshRecord(job.key,job.generatorId,job.params,extraDirs);
  if(cached){
   meshCacheHits++;
   outcomes.set(job.key,{ok:true,record:cached});
   if(opts?.cacheDir&&!existsSync(join(opts.cacheDir,`${job.key}.bin`))){
    saveMeshToDisk(opts.cacheDir,job.key,cached);
   }
  }else{
   uncachedMeshes.push(job);
  }
 }
 // 重生成器优先入队(LPT 调度),避免末尾单线程拖尾。
 uncachedMeshes.sort((a,b)=>Number(HEAVY_GEN_RE.test(b.generatorId))-Number(HEAVY_GEN_RE.test(a.generatorId)));

 const precookSurfaces=(opts?.precookSurfaces??true)&&process.env.SPEC_PRECOOK_MESHES!=='0'&&process.env.SPEC_PRECOOK_SURFACES!=='0';
 const uncachedSurfaces:{pattern:string;safeKey:string;size:number}[]=[];
 if(precookSurfaces){
  for(const s of collectSurfaceSpecs(prepared.materials)){
   const cached=getCachedSurfaceRecord(s.pattern,s.safeKey,s.size,extraDirs,useGlobalSurfaceCache);
   if(cached){
    if(opts?.cacheDir&&!existsSync(join(opts.cacheDir,surfaceFileName(s.safeKey,s.size)))){
     saveSurfaceToDisk(opts.cacheDir,s.safeKey,cached);
    }
   }else{
    uncachedSurfaces.push(s);
   }
  }
  uncachedSurfaces.sort((a,b)=>b.size-a.size);
 }

 const tasks:WorkerTaskPayload[]=[];
 const taskBindings:({type:'surface';spec:{pattern:string;safeKey:string;size:number}}|{type:'mesh';job:UniqueMeshJob})[]=[];

 for(const s of uncachedSurfaces){
  tasks.push({kind:'surface',pattern:s.pattern,size:s.size});
  taskBindings.push({type:'surface',spec:s});
 }
 for(const job of uncachedMeshes){
  tasks.push({kind:'mesh',meshKey:job.key,generatorId:job.generatorId,params:job.params});
  taskBindings.push({type:'mesh',job});
 }

 const {results,workersUsed}=await runWorkerTasks(tasks,{concurrency:opts?.concurrency});

 for(let i=0;i<results.length;i++){
  const res=results[i]!,binding=taskBindings[i]!;
  if(binding.type==='surface'){
   if(res.ok&&res.kind==='surface'){
    bumpParallelStat('surfaceWorkerRuns');
    const rec:CachedSurfaceRecord={bin:Buffer.from(res.ab),size:res.size,sha256:res.sha256};
    setBounded(SURFACE_BY_KEY_CACHE,`${binding.spec.pattern}:${binding.spec.size}`,rec,MAX_MEM_SURFACES);
    saveGlobalSurfaceCache(binding.spec.safeKey,rec);
    if(opts?.cacheDir)saveSurfaceToDisk(opts.cacheDir,binding.spec.safeKey,rec);
   }
  }else{
   const {job}=binding;
   if(res.ok&&res.kind==='mesh'){
    bumpParallelStat('meshWorkerRuns');
    const asset=decodeCookedMesh(res.ab,res.meta);
    const record:CachedMeshRecord={
     contentHash:meshContentHash(job.generatorId,job.params),
     asset,
     bin:Buffer.from(res.ab),
     meta:res.meta,
     rawAabb:res.rawAabb,
     triangles:res.triangles,
    };
    setBounded(MESH_BY_KEY_CACHE,job.key,record,MAX_MEM_MESHES);
    if(opts?.cacheDir)saveMeshToDisk(opts.cacheDir,job.key,record);
    outcomes.set(job.key,{ok:true,record});
   }else{
    outcomes.set(job.key,{ok:false,error:res.ok?'Unexpected worker response':res.error});
   }
  }
 }

 const plan=finalizeExportPlan(spec,prepared,job=>outcomes.get(job.key)??{ok:false,error:'Missing worker mesh result'});
 PLAN_TELEMETRY.set(plan,{
  parallelWorkers:workersUsed,
  durationMs:Math.round(performance.now()-t0),
  uniqueMeshes:prepared.uniqueJobs.size,
  workerMeshBuilds:uncachedMeshes.length,
  meshCacheHits,
  surfaceBuilds:uncachedSurfaces.length,
 });
 return plan;
}

/**
 * 规格里的"一对象多实例"与世界坐标参数在导出时确定性展开,生成器只处理单个局部实例:
 * - params.positions(x,y,z…,世界坐标)→ 每点一个实例,ID 为 <对象>__<序号>;可选 yawDeg 数列给每个实例的绕 Z 角。
 * - params.yPositions(数列)→ 在对象 X、Z 不变处沿 Y 排列实例。
 * - 以 World 结尾的点参数(pathPointsWorld、endPointWorld)→ 减去对象位置、换到引擎局部轴,去掉 World 后缀;
 *   对象有旋转时不换算(无法唯一确定),丢弃并记录。
 */
export function expandInstances(objects:SpecObject[],report:ExportReport):SpecObject[]{
 const out:SpecObject[]=[];
 for(const o of objects){
  const pts=Array.isArray(o.params.positions)&&o.params.positions.length>=6&&o.params.positions.length%3===0?o.params.positions as number[]:null;
  const ys=Array.isArray(o.params.yPositions)&&o.params.yPositions.length>=2?o.params.yPositions as number[]:null;
  const local=(params:SpecObject['params'],origin:Vec3)=>{const q:SpecObject['params']={};for(const [k,v] of Object.entries(params)){
   if(k.endsWith('World')&&Array.isArray(v)&&v.length%3===0&&v.every(n=>typeof n==='number')){
    if(o.transform.rotationDeg.some(r=>Math.abs(r)>1e-6)){report.dropped.push({family:o.family,key:k,reason:`${o.id} 有旋转,世界坐标点无法换到局部`});continue;}
    const n=v as number[];q[k.slice(0,-5)]=Array.from({length:n.length/3},(_,i)=>toEnginePosition([n[3*i]!-origin[0],n[3*i+1]!-origin[1],n[3*i+2]!-origin[2]])).flat();
   }else q[k]=v;}return q;};
  if(pts||ys){
   const at:Vec3[]=pts?Array.from({length:pts.length/3},(_,i)=>[pts[3*i]!,pts[3*i+1]!,pts[3*i+2]!]):ys!.map(y=>[o.transform.position[0],y,o.transform.position[2]]);
   const yaw=Array.isArray(o.params.yawDeg)?o.params.yawDeg as number[]:null,{positions:_p,yPositions:_y,yawDeg:_w,...rest}=o.params;
   at.forEach((position,i)=>out.push({...o,id:`${o.id}__${i+1}`,transform:{...o.transform,position,rotationDeg:yaw?[o.transform.rotationDeg[0],o.transform.rotationDeg[1],yaw[i]??0]:o.transform.rotationDeg},params:local(rest,position)}));
   report.expanded.push({object:o.id,count:at.length});
  }else out.push({...o,params:local(o.params,o.transform.position)});
 }
 return out;
}

const PACK_SOURCE=`// 由 scene-foundry 规格导出器生成;支持 GPU Instances 硬件实例化、ProjectedDecal 程序化贴花与网格/表面贴图离线预烘焙。
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {AssetGuid} from '@forgeax/engine/pack/guid';
import {definePack,definePackageId} from '@forgeax/engine/pack/source';
import {coverage,model,TEXT_CHARACTERS,textRegion} from '@forgeax/engine/modeling';
import {Instances,Materials,MeshFilter,MeshRenderer} from '@forgeax/engine/render';
import {Name,Transform} from '@forgeax/engine/scene';
import type {MeshAsset} from '@forgeax/engine/types';
import {ok} from '@forgeax/engine/types';
import {GENERATORS} from './spec-kit/index.ts';
import {runGenerator} from './spec-kit/kit.ts';
import {surfaceMaps,type SurfacePattern} from './spec-kit/textures.ts';
import {buildMeshCardLayout,buildMeshDistanceField,buildVisibilityDistanceField,encodeMeshDistanceField,MESH_VISIBILITY_DISTANCE_FIELD_CODEC} from '@forgeax/engine/geometry';
import COOKED_STAMP from './cooked-stamp.ts';
import data from './spec-data.ts';
import pbr from './pbr-index.ts';
const packageId=definePackageId(data.packageId);
const ref=(key:string)=>AssetGuid.format(AssetGuid.derive(packageId,key));
function proxy(size:readonly number[],floor:boolean,key:string):MeshAsset{
 const m=model();m.box({size:[size[0],size[2],size[1]],center:[0,floor?size[2]/2:0,0],material:'proxy'});m.uv.project({mode:'box',scale:0.5});
 const out=m.finish({key,normals:{mode:'weighted'}});if(!out.ok)throw out.error;return out.value['mesh/'+key] as MeshAsset;
}
function loadCookedMesh(mesh:any):MeshAsset|null{
 void COOKED_STAMP;
 const c=mesh.cooked;if(!c)return null;
 const candidates=[join(process.cwd(),'assets/generated/cooked',mesh.key+'.bin')];
 try{candidates.push(fileURLToPath(new URL('./cooked/'+mesh.key+'.bin',import.meta.url)));}catch{}
 for(const p of candidates){
  if(!existsSync(p))continue;
  const raw=readFileSync(p);if(raw.byteLength!==c.byteLength)continue;
  const ab=raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength);
  const view=(s:{dtype:string;byteOffset:number;length:number})=>
   s.dtype==='f32'?new Float32Array(ab,s.byteOffset,s.length)
   :s.dtype==='u16'?new Uint16Array(ab,s.byteOffset,s.length)
   :s.dtype==='u32'?new Uint32Array(ab,s.byteOffset,s.length)
   :new Uint8Array(ab,s.byteOffset,s.length);
  const attributes:Record<string,unknown>={};
  for(const [k,s] of Object.entries(c.attributes))attributes[k]=view(s as any);
  return {kind:'mesh',vertices:view(c.vertices) as Float32Array,indices:view(c.indices) as Uint16Array|Uint32Array,aabb:view(c.aabb) as Float32Array,attributes:attributes as any,submeshes:c.submeshes,materialSlots:c.materialSlots} as MeshAsset;
 }
 return null;
}
function loadCookedSurface(pattern:string,sz:number):{size:number;normal:Uint8Array;metallicRoughness:Uint8Array;baseColor:Uint8Array}|null{
 void COOKED_STAMP;
 const safe=pattern.toLowerCase().replace(/[^a-z0-9._-]+/g,'-').replace(/^[^a-z0-9]+/,'');
 const file='surface-'+safe+'-'+sz+'.bin',plane=sz*sz*4,expected=plane*3;
 const candidates=[join(process.cwd(),'assets/generated/cooked',file)];
 try{candidates.push(fileURLToPath(new URL('./cooked/'+file,import.meta.url)));}catch{}
 for(const p of candidates){
  if(!existsSync(p))continue;
  const raw=readFileSync(p);if(raw.byteLength!==expected)continue;
  const ab=raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength);
  return {size:sz,normal:new Uint8Array(ab,0,plane),metallicRoughness:new Uint8Array(ab,plane,plane),baseColor:new Uint8Array(ab,plane*2,plane)};
 }
 return null;
}
function srgbByte(linear:number):number{
 const c=Math.max(0,Math.min(1,linear)),s=c<=0.0031308?c*12.92:1.055*Math.pow(c,1/2.4)-0.055;
 return Math.round(Math.max(0,Math.min(255,s*255)));
}
function buildDecalMaps(dm:{kind:string;text:string;color:readonly number[];roughness:number}){
 const W=dm.kind==='stencil'?512:256,H=dm.kind==='stencil'?128:256;
 const color=new Uint8Array(W*H*4),rough=new Uint8Array(W*H*4),normal=new Uint8Array(W*H*4);
 const rByte=Math.round(Math.max(0,Math.min(1,dm.roughness))*255);
 const [cr,cg,cb]=[dm.color[0]??1,dm.color[1]??1,dm.color[2]??1].map(srgbByte);
 if(dm.kind==='stencil'){
  const allowed=new Set(TEXT_CHARACTERS.split(''));
  const clean=dm.text.toUpperCase().split('').map(ch=>allowed.has(ch)?ch:' ').join('').replace(/\\s+/g,' ').trim()||'SECTOR 01';
  const tr=textRegion(clean,{height:1,weight:0.14});
  const reg=tr.ok?((tr.value as any).region??tr.value):[];
  let minX=0,maxX=4,minY=0,maxY=1;
  if(reg.length){minX=Infinity;maxX=-Infinity;minY=Infinity;maxY=-Infinity;for(const sh of reg)for(const pt of sh.outer){if(pt[0]<minX)minX=pt[0];if(pt[0]>maxX)maxX=pt[0];if(pt[1]<minY)minY=pt[1];if(pt[1]>maxY)maxY=pt[1];}}
  const spanX=Math.max(0.5,maxX-minX),spanY=Math.max(0.4,maxY-minY),padX=spanX*0.16,padY=spanY*0.38;
  const cov=reg.length?coverage(reg,W,H,[minX-padX,minY-padY,maxX+padX,maxY+padY],4):new Float32Array(W*H);
  for(let y=0;y<H;y++){const v=(y+0.5)/H,bar=(v>0.06&&v<0.11)||(v>0.89&&v<0.94);
   for(let x=0;x<W;x++){const u=(x+0.5)/W,barMask=bar&&u>0.04&&u<0.96&&Math.abs(u-0.5)>0.03?0.85:0;
    const a=Math.max(Math.min(1,cov[(H-1-y)*W+x]!),barMask),o=(y*W+x)*4;
    color[o]=cr!;color[o+1]=cg!;color[o+2]=cb!;color[o+3]=Math.round(a*255);
    rough[o]=rByte;rough[o+1]=rByte;rough[o+2]=0;rough[o+3]=255;
    normal[o]=128;normal[o+1]=128;normal[o+2]=255;normal[o+3]=255;}}
 }else if(dm.kind==='hazard'){
  const [dr,dg,db]=[0.04,0.045,0.05].map(srgbByte);
  for(let y=0;y<H;y++){const v=(y+0.5)/H;
   for(let x=0;x<W;x++){const u=(x+0.5)/W,inside=u>0.03&&u<0.97&&v>0.06&&v<0.94;
    const phase=((u*6+v*2)%1+1)%1,stripe=Math.max(0,Math.min(1,(0.5-Math.abs(phase-0.5)*2)*16+0.5)),o=(y*W+x)*4;
    color[o]=Math.round(dr!+(cr!-dr!)*stripe);color[o+1]=Math.round(dg!+(cg!-dg!)*stripe);color[o+2]=Math.round(db!+(cb!-db!)*stripe);color[o+3]=inside?255:0;
    rough[o]=rByte;rough[o+1]=rByte;rough[o+2]=0;rough[o+3]=255;
    normal[o]=128;normal[o+1]=128;normal[o+2]=255;normal[o+3]=255;}}
 }else{
  for(let y=0;y<H;y++){const ny=((y+0.5)/H)*2-1;
   for(let x=0;x<W;x++){const nx=((x+0.5)/W)*2-1,ang=Math.atan2(ny,nx);
    const wobble=1+0.12*Math.sin(ang*3+0.7)+0.07*Math.cos(ang*5-1.2),r=Math.hypot(nx,ny)*wobble;
    const m=Math.max(0,Math.min(1,(0.88-r)/0.28)),smooth=m*m*(3-2*m),localR=Math.round((dm.roughness*smooth+0.85*(1-smooth))*255),o=(y*W+x)*4;
    color[o]=cr!;color[o+1]=cg!;color[o+2]=cb!;color[o+3]=Math.round(smooth*255);
    rough[o]=localR;rough[o+1]=localR;rough[o+2]=0;rough[o+3]=255;
    normal[o]=128;normal[o+1]=128;normal[o+2]=255;normal[o+3]=Math.round(smooth*255);}}
 }
 return {width:W,height:H,color,rough,normal};
}
export default definePack({
 schemaVersion:'2.0.0',packageId,name:data.name,
 sceneComponents:[Instances,MeshFilter,MeshRenderer,Name,Transform],
 async build(){
  const out:Record<string,unknown>={};
  // 程序化表面贴图:优先读取 cooked/surface-<pattern>-<size>.bin,缺失时回退 surfaceMaps。
  const patterns=[...new Set(data.materials.flatMap((m:any)=>m.surface&&!m.surface.pattern.startsWith('polyhaven:')?[m.surface.pattern as string]:[]))];
  const unzip=async(b64:string)=>new Uint8Array(await new Response(new Blob([Uint8Array.from(atob(b64),c=>c.charCodeAt(0))]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  for(const [name,t] of Object.entries(pbr))for(const [ch,b64,srgb] of [['color',t.color,true],['normal',t.normal,false],['mr',t.arm,false]] as const)
   out['texture/polyhaven-'+name+'-'+ch]={kind:'texture',shape:{viewDimension:'2d',extent:{width:t.size,height:t.size}},format:srgb?'rgba8unorm-srgb':'rgba8unorm',data:await unzip(b64),colorSpace:srgb?'srgb':'linear',mips:{kind:'generate'}};
  for(const p of patterns){
   const sz=p==='deck'||p==='worn'||p==='trim'?1024:256;
   let t=loadCookedSurface(p,sz);
   if(!t){try{t=surfaceMaps(p as SurfacePattern,sz);if(!t?.normal)throw 0;}catch{t=surfaceMaps('panel' as SurfacePattern,sz);}}
   for(const [ch,bytes,srgb] of [['normal',t.normal,false],['mr',t.metallicRoughness,false],['color',t.baseColor,true]] as const)
    out['texture/'+p+'-'+ch]={kind:'texture',shape:{viewDimension:'2d',extent:{width:t.size,height:t.size}},format:srgb?'rgba8unorm-srgb':'rgba8unorm',data:bytes,colorSpace:srgb?'srgb':'linear',mips:{kind:'generate'}};
  }
  if(patterns.length||Object.keys(pbr).length)out['sampler/surface-repeat']={kind:'sampler',magFilter:'linear',minFilter:'linear',mipmapFilter:'linear',addressModeU:'repeat',addressModeV:'repeat',maxAnisotropy:8};
  // 生成器 UV 为盒投影 scale 0.5(每 2 米一个 UV 单位),按 tilesPerMeter 换算贴图缩放。
  const channel=(p:string,ch:string,tiles:number)=>({texture:ref('texture/'+p.replace(':','-')+'-'+ch),sampler:ref('sampler/surface-repeat'),coordinates:{transform:{scale:[tiles*2,tiles*2]}}});
  const nonShadowMatKeys=new Set(data.meshes.flatMap((mesh:any)=>Object.entries(mesh.slots??{}).filter(([slot])=>/^(skylight|sky|tubeGlass|glass|pane|window|constraintField|holoGlow)$/i.test(slot)).map(([,mk])=>String(mk))));
  for(const m of data.materials as any[]){
   const std=Materials.standard({...m.options,...(m.surface?{normalTexture:channel(m.surface.pattern,'normal',m.surface.tilesPerMeter),metallicRoughnessTexture:channel(m.surface.pattern,'mr',m.surface.tilesPerMeter),baseColorTexture:channel(m.surface.pattern,'color',m.surface.tilesPerMeter)}:{})} as any);
   const noShadow=nonShadowMatKeys.has(m.key)||(m.options?.transmission??0)>0||Boolean(m.options?.renderState?.blend);
   out['material/'+m.key]=noShadow?{...std,passes:std.passes.filter((p:any)=>p.name!=='shadow-caster'&&p.renderState?.tags?.LightMode!=='ShadowCaster')}:std;
  }
  const decalMaterials=(data as any).decalMaterials??[];
  if(decalMaterials.length){
   out['sampler/decal-clamp']={kind:'sampler',magFilter:'linear',minFilter:'linear',mipmapFilter:'linear',addressModeU:'clamp-to-edge',addressModeV:'clamp-to-edge',maxAnisotropy:8};
   for(const dm of decalMaterials){
    const maps=buildDecalMaps(dm);
    out['texture/'+dm.key+'-color']={kind:'texture',shape:{viewDimension:'2d',extent:{width:maps.width,height:maps.height}},format:'rgba8unorm-srgb',data:maps.color,colorSpace:'srgb',mips:{kind:'generate'}};
    out['texture/'+dm.key+'-rough']={kind:'texture',shape:{viewDimension:'2d',extent:{width:maps.width,height:maps.height}},format:'rgba8unorm',data:maps.rough,colorSpace:'linear',mips:{kind:'generate'}};
    if(dm.hasNormal)out['texture/'+dm.key+'-normal']={kind:'texture',shape:{viewDimension:'2d',extent:{width:maps.width,height:maps.height}},format:'rgba8unorm',data:maps.normal,colorSpace:'linear',mips:{kind:'generate'}};
    out['material/'+dm.key]=Materials.standard({
     baseColor:[1,1,1,1],metallic:0,roughness:dm.roughness,
     baseColorTexture:{texture:ref('texture/'+dm.key+'-color'),sampler:ref('sampler/decal-clamp')},
     roughnessTexture:{texture:ref('texture/'+dm.key+'-rough'),sampler:ref('sampler/decal-clamp')},
     ...(dm.hasNormal?{normalTexture:{texture:ref('texture/'+dm.key+'-normal'),sampler:ref('sampler/decal-clamp')}}:{}),
    } as any);
   }
  }
  for(const mesh of data.meshes){
   const asset=mesh.generator==='proxy'?proxy(mesh.params.size as number[],mesh.params.floor as boolean,mesh.key):(loadCookedMesh(mesh)??runGenerator(GENERATORS[mesh.generator],mesh.params as any,mesh.key));
   // 漫反射 GI(irradiance-field)要求每个网格带距离场与 Card 布局;只在规格开 GI 时生成(构建期开销)。
   let gi:Record<string,unknown>={};
   if(data.gi){const pos=(asset as any).attributes.position,idx=(asset as any).indices;
    // irradiance-field 只接纳 sampled-visibility 距离场 + 封装工件(integrity + codec),几何距离场(buildMeshDistanceField)
    // 永远过不了运行时门槛(引擎会话 2026-11-08,render/raytracing/scene-field-projection.ts hasAdmittedFieldArtifact)。
    // 体素按包围盒 1/64、不小于 0.4m(1/128 时整包构建超 120s);SPEC_GI_VOXEL_BIG 给大件加细(穹顶除外:细体素耗尽 sign-ray 预算)(每轴上限 514 样本);三角形与分段的单/双面须与材质一致(材质默认单面,否则运行时报 sidedness 与烘焙场不一致)。
    const b=(asset as any).aabb,ext=Math.max(b[3]-b[0],b[4]-b[1],b[5]-b[2]);
    // SPEC_GI_GEOMETRIC_DF=1:仅用于验收引擎报错提示——故意产出 GI 不收的几何距离场。
    if(process.env.SPEC_GI_GEOMETRIC_DF==='1'){let g:any=await buildMeshDistanceField(pos,idx,{twoSided:true});for(const resolution of [32,24,16])if(!g.ok)g=await buildMeshDistanceField(pos,idx,{twoSided:true,resolution});if(!g.ok)throw new Error('geometric df '+mesh.key+': '+g.error.detail.reason);const cards=await buildMeshCardLayout(pos,idx);gi={distanceField:{...g.value,sectionSidedness:asset.submeshes.map(()=>1)},cardLayout:(cards as any).value};}
    else{
    // 穹顶(扁拱面+檐+薄环带)细体素会耗尽 sign-ray 预算;sf.3 起可用 SPEC_GI_DOME_SIGNRAY 只给穹顶调高 signRayBudget(上限 17179869184)。
    const dome=mesh.generator==='GEN-FUTURE-01'&&mesh.params.mode===1;
    const df:any=await buildVisibilityDistanceField(pos,idx,{voxelSize:ext>20&&process.env.SPEC_GI_VOXEL_BIG&&(!dome||process.env.SPEC_GI_DOME_SIGNRAY)?Number(process.env.SPEC_GI_VOXEL_BIG):Math.max(0.4,ext/64),...(dome&&process.env.SPEC_GI_DOME_SIGNRAY?{signRayBudget:Number(process.env.SPEC_GI_DOME_SIGNRAY)}:{}),triangleSidedness:new Uint8Array(idx.length/3)});
    if(!df.ok)throw new Error('distance field '+mesh.key+': '+df.error.detail.reason);
    const bytes:any=await encodeMeshDistanceField(df.value);if(!bytes.ok)throw new Error('distance field encode '+mesh.key+': '+bytes.error.code);
    const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes.value)),hex=[...digest].map(x=>x.toString(16).padStart(2,'0')).join('');
    const cards=await buildMeshCardLayout(pos,idx);if(!cards.ok)throw new Error('card layout '+mesh.key+': '+cards.error.code);
    gi={distanceField:{...df.value,sectionSidedness:asset.submeshes.map(()=>0),artifact:{integrity:{algorithm:'sha256',digest:'sha256:'+hex},assetCodec:{...MESH_VISIBILITY_DISTANCE_FIELD_CODEC}}},cardLayout:cards.value};}}
   out['mesh/'+mesh.key]={...asset,...gi,materialSlots:(asset.materialSlots??[]).map(s=>({...s,sourceKey:mesh.key+':'+s.slotName,defaultMaterial:AssetGuid.derive(packageId,'material/'+(mesh.slots as Record<string,string>)[s.slotName])}))};
  }
  const sceneEntities:Record<string,unknown>={};
  for(const e of data.entities)sceneEntities[e.id]={components:{Name:{value:e.label},Transform:{pos:e.pos,quat:e.quat,scale:e.scale},MeshFilter:{assetHandle:ref('mesh/'+e.mesh)},MeshRenderer:{materials:[]}}};
  for(const b of (data as any).batches??[])sceneEntities[b.key]={components:{Name:{value:b.label},Transform:{pos:[0,0,0],quat:[0,0,0,1],scale:[1,1,1]},MeshFilter:{assetHandle:ref('mesh/'+b.mesh)},MeshRenderer:{materials:[]},Instances:{transforms:new Float32Array(b.transforms)}}};
  // ProjectedDecal 的材质句柄需用未预编译材质引用(runtimeMaterialShaderId 保留 'forgeax::default-standard-pbr');
  // 贴花材质仍静态打包在当前 pack 中,由运行时插件通过 assets.load 解析句柄后挂载 ProjectedDecal。
  out[data.sceneKey]={kind:'scene',entities:sceneEntities};
  return ok(out);
 },
});
`;

/**
 * 运行时投射贴花(ProjectedDecal):在引擎 0.5.0-rc.1 中,pack 烘焙材质的 materialProgramKeys 会把
 * runtimeMaterialShaderId 替换成 specializationKey,而 extractProjectedDecals 要求未预编译的
 * Materials.standard 资产句柄(materialShaderId === 'forgeax::default-standard-pbr' 且带 Deferred pass)。
 * 因此贴花纹理与标准材质通过 assets.create 在运行时确定性生成并挂到世界实体,卸载时完整释放。
 */
export function projectedDecalPlugin(decals:ExportPlan['decals']){
 const mats=new Map<string,{key:string;kind:string;text:string;color:Vec3;roughness:number;hasNormal:boolean}>();
 for(const d of decals)if(!mats.has(d.material))mats.set(d.material,{key:d.material,kind:d.kind,text:d.text,color:d.color,roughness:d.roughness,hasNormal:d.normalOpacity>0});
 return `import type {} from '@forgeax/engine/app';
import {coverage,TEXT_CHARACTERS,textRegion} from '@forgeax/engine/modeling';
import {Materials,ProjectedDecal} from '@forgeax/engine/render';
import type {Plugin} from '@forgeax/engine/plugin';
import {Name,Transform} from '@forgeax/engine/scene';
function srgbByte(linear:number):number{
 const c=Math.max(0,Math.min(1,linear)),s=c<=0.0031308?c*12.92:1.055*Math.pow(c,1/2.4)-0.055;
 return Math.round(Math.max(0,Math.min(255,s*255)));
}
function buildDecalMaps(dm:{kind:string;text:string;color:readonly number[];roughness:number}){
 const W=dm.kind==='stencil'?512:256,H=dm.kind==='stencil'?128:256;
 const color=new Uint8Array(W*H*4),rough=new Uint8Array(W*H*4),normal=new Uint8Array(W*H*4);
 const rByte=Math.round(Math.max(0,Math.min(1,dm.roughness))*255);
 const [cr,cg,cb]=[dm.color[0]??1,dm.color[1]??1,dm.color[2]??1].map(srgbByte);
 if(dm.kind==='stencil'){
  const allowed=new Set(TEXT_CHARACTERS.split(''));
  const clean=dm.text.toUpperCase().split('').map(ch=>allowed.has(ch)?ch:' ').join('').replace(/\\s+/g,' ').trim()||'SECTOR 01';
  const tr=textRegion(clean,{height:1,weight:0.14});
  const reg=tr.ok?((tr.value as any).region??tr.value):[];
  let minX=0,maxX=4,minY=0,maxY=1;
  if(reg.length){minX=Infinity;maxX=-Infinity;minY=Infinity;maxY=-Infinity;for(const sh of reg)for(const pt of sh.outer){if(pt[0]<minX)minX=pt[0];if(pt[0]>maxX)maxX=pt[0];if(pt[1]<minY)minY=pt[1];if(pt[1]>maxY)maxY=pt[1];}}
  const spanX=Math.max(0.5,maxX-minX),spanY=Math.max(0.4,maxY-minY),padX=spanX*0.16,padY=spanY*0.38;
  const cov=reg.length?coverage(reg,W,H,[minX-padX,minY-padY,maxX+padX,maxY+padY],4):new Float32Array(W*H);
  for(let y=0;y<H;y++){const v=(y+0.5)/H,bar=(v>0.06&&v<0.11)||(v>0.89&&v<0.94);
   for(let x=0;x<W;x++){const u=(x+0.5)/W,barMask=bar&&u>0.04&&u<0.96&&Math.abs(u-0.5)>0.03?0.85:0;
    const a=Math.max(Math.min(1,cov[(H-1-y)*W+x]!),barMask),o=(y*W+x)*4;
    color[o]=cr!;color[o+1]=cg!;color[o+2]=cb!;color[o+3]=Math.round(a*255);
    rough[o]=rByte;rough[o+1]=rByte;rough[o+2]=0;rough[o+3]=255;
    normal[o]=128;normal[o+1]=128;normal[o+2]=255;normal[o+3]=255;}}
 }else if(dm.kind==='hazard'){
  const [dr,dg,db]=[0.04,0.045,0.05].map(srgbByte);
  for(let y=0;y<H;y++){const v=(y+0.5)/H;
   for(let x=0;x<W;x++){const u=(x+0.5)/W,inside=u>0.03&&u<0.97&&v>0.06&&v<0.94;
    const phase=((u*6+v*2)%1+1)%1,stripe=Math.max(0,Math.min(1,(0.5-Math.abs(phase-0.5)*2)*16+0.5)),o=(y*W+x)*4;
    color[o]=Math.round(dr!+(cr!-dr!)*stripe);color[o+1]=Math.round(dg!+(cg!-dg!)*stripe);color[o+2]=Math.round(db!+(cb!-db!)*stripe);color[o+3]=inside?255:0;
    rough[o]=rByte;rough[o+1]=rByte;rough[o+2]=0;rough[o+3]=255;
    normal[o]=128;normal[o+1]=128;normal[o+2]=255;normal[o+3]=255;}}
 }else{
  for(let y=0;y<H;y++){const ny=((y+0.5)/H)*2-1;
   for(let x=0;x<W;x++){const nx=((x+0.5)/W)*2-1,ang=Math.atan2(ny,nx);
    const wobble=1+0.12*Math.sin(ang*3+0.7)+0.07*Math.cos(ang*5-1.2),r=Math.hypot(nx,ny)*wobble;
    const m=Math.max(0,Math.min(1,(0.88-r)/0.28)),smooth=m*m*(3-2*m),localR=Math.round((dm.roughness*smooth+0.85*(1-smooth))*255),o=(y*W+x)*4;
    color[o]=cr!;color[o+1]=cg!;color[o+2]=cb!;color[o+3]=Math.round(smooth*255);
    rough[o]=localR;rough[o+1]=localR;rough[o+2]=0;rough[o+3]=255;
    normal[o]=128;normal[o+1]=128;normal[o+2]=255;normal[o+3]=Math.round(smooth*255);}}
 }
 return {width:W,height:H,color,rough,normal};
}
const DECAL_MATS=${JSON.stringify([...mats.values()])};
const DECALS=${JSON.stringify(decals)};
export default {name:'scene/projected-decals',inject:['world','gameHost','assets'],apply(ctx){
 const assets=ctx.assets;
 if(ctx.gameHost?.defaultSceneRoot===undefined||!assets)throw new Error('projected decals: scene root or asset registry unavailable');
 const createdHandles:unknown[]=[],spawned:any[]=[];
 const sampler=assets.create({kind:'sampler',magFilter:'linear',minFilter:'linear',mipmapFilter:'linear',addressModeU:'clamp-to-edge',addressModeV:'clamp-to-edge',maxAnisotropy:8} as never).unwrap();
 createdHandles.push(sampler);
 const matHandles=new Map<string,unknown>();
 for(const dm of DECAL_MATS){
  const maps=buildDecalMaps(dm);
  const cTex=assets.create({kind:'texture',shape:{viewDimension:'2d',extent:{width:maps.width,height:maps.height}},format:'rgba8unorm-srgb',colorSpace:'srgb',mips:{kind:'none'},data:maps.color} as never).unwrap();
  const rTex=assets.create({kind:'texture',shape:{viewDimension:'2d',extent:{width:maps.width,height:maps.height}},format:'rgba8unorm',colorSpace:'linear',mips:{kind:'none'},data:maps.rough} as never).unwrap();
  createdHandles.push(cTex,rTex);
  let nTex:unknown=undefined;
  if(dm.hasNormal){
   nTex=assets.create({kind:'texture',shape:{viewDimension:'2d',extent:{width:maps.width,height:maps.height}},format:'rgba8unorm',colorSpace:'linear',mips:{kind:'none'},data:maps.normal} as never).unwrap();
   createdHandles.push(nTex);
  }
  const mat=assets.create(Materials.standard({
   baseColor:[1,1,1,1],metallic:0,roughness:dm.roughness,
   baseColorTexture:{texture:cTex,sampler},
   roughnessTexture:{texture:rTex,sampler},
   ...(nTex!==undefined?{normalTexture:{texture:nTex,sampler}}:{}),
  } as any) as never).unwrap();
  createdHandles.push(mat);
  matHandles.set(dm.key,mat);
 }
 for(const d of DECALS){
  const e=ctx.world.spawn(
   {component:Name,data:{value:d.label}},
   {component:Transform,data:{pos:d.pos,quat:d.quat,scale:d.scale}},
   {component:ProjectedDecal,data:{material:matHandles.get(d.material),order:d.order,opacity:d.opacity,normalThreshold:d.normalThreshold,colorOpacity:d.colorOpacity,normalOpacity:d.normalOpacity,roughnessOpacity:d.roughnessOpacity} as never},
  ).unwrap();
  spawned.push(e);
 }
 ctx.effect(function*(){yield()=>{for(const e of spawned)ctx.world.despawn(e);for(const h of createdHandles.reverse())assets.release(h as never);};},'scene/projected-decals');
}} satisfies Plugin;
`;
}

/** 写出 spec.pack.ts、spec-data.ts 与生成器源码;返回与 scene-generator 导出一致的收据字段。 */
/** 规格里引用的 Poly Haven 资产名(去重,稳定顺序)。 */
export const pbrAssets=(spec:SceneSpec)=>[...new Set(spec.materials.flatMap(m=>m.surface&&m.surface.pattern.startsWith('polyhaven:')?[m.surface.pattern.slice(10)]:[]))].sort();
export function writeSpecPack(spec:SceneSpec,plan:ExportPlan,destination:string,identity:{packageId:string;sourceKey:string;name:string},pbrDir?:string){
 mkdirSync(join(destination,'spec-kit'),{recursive:true});
 for(const file of GENERATOR_SOURCES)cpSync(join(import.meta.dir,'generators',file),join(destination,'spec-kit',file));
 const gi=spec.lighting.states.find(st=>st.id===spec.lighting.defaultState)?.post.gi?true:false;
 const precookEnabled=process.env.SPEC_PRECOOK_MESHES!=='0';
 const precookMinTris=Number(process.env.SPEC_PRECOOK_MIN_TRIANGLES??1);
 const siblingCacheDir=resolve(destination,'../../../.mesh-cache');
 const extraCacheDirs=existsSync(siblingCacheDir)?[siblingCacheDir]:[];
 const cookedStamps:string[]=[];
 let precookedMeshCount=0;

 const meshesData=plan.meshes.map(m=>{
  const {triangles,family,aabb,...rest}=m;
  if(precookEnabled&&m.generator!=='proxy'&&triangles>=precookMinTris){
   let bin:Buffer,meta:CookedMeshMeta;
   const rec=getCachedMeshRecord(m.key,m.generator,m.params,extraCacheDirs);
   if(rec){
    COOKED_MESH_CACHE.set(m,rec.asset);
    bin=rec.bin;meta=rec.meta;
   }else{
    const byObj=COOKED_MESH_CACHE.get(m);
    if(byObj)bumpParallelStat('meshCacheHits');
    else bumpParallelStat('meshMainThreadRuns');
    const asset=byObj??runGenerator(GENERATORS[m.generator]!,m.params as any,m.key);
    const encoded=encodeCookedMesh(asset);
    bin=encoded.bin;meta=encoded.meta;
    COOKED_MESH_CACHE.set(m,asset);
    setBounded(MESH_BY_KEY_CACHE,m.key,{contentHash:meshContentHash(m.generator,m.params),asset,bin,meta,rawAabb:aabb,triangles},MAX_MEM_MESHES);
   }
   mkdirSync(join(destination,'cooked'),{recursive:true});
   writeFileSync(join(destination,'cooked',m.key+'.bin'),bin);
   cookedStamps.push(`${m.key}:${meta.sha256}`);
   precookedMeshCount++;
   return {...rest,cooked:meta};
  }
  return rest;
 });

 if(precookEnabled&&process.env.SPEC_PRECOOK_SURFACES!=='0'){
  for(const s of collectSurfaceSpecs(plan.materials)){
   const surf=getCachedSurfaceRecord(s.pattern,s.safeKey,s.size,extraCacheDirs)??buildSurfaceSync(s.pattern,s.safeKey,s.size);
   mkdirSync(join(destination,'cooked'),{recursive:true});
   writeFileSync(join(destination,'cooked',surfaceFileName(s.safeKey,surf.size)),surf.bin);
   cookedStamps.push(`surface:${s.safeKey}:${surf.size}:${surf.sha256}`);
  }
 }

 const stamp=cookedStamps.length?createHash('sha256').update(cookedStamps.sort().join('|')).digest('hex').slice(0,16):'none';
 writeFileSync(join(destination,'cooked-stamp.ts'),`export default ${JSON.stringify(stamp)} as const;\n`);
 const decalMaterialMap=new Map<string,{key:string;kind:SpecDecal['kind'];text:string;color:Vec3;roughness:number;hasNormal:boolean}>();
 for(const d of plan.decals)if(!decalMaterialMap.has(d.material))decalMaterialMap.set(d.material,{key:d.material,kind:d.kind,text:d.text,color:d.color,roughness:d.roughness,hasNormal:d.normalOpacity>0});
 const singleEntities=plan.entities.filter(e=>e.bindingKey===e.id).map(({bindingKey:_b,...e})=>e);
 const batches=plan.instancedBatches.map(b=>({key:b.key,label:b.label,mesh:b.mesh,transforms:Array.from(b.transforms)}));
 const decalMaterials=[...decalMaterialMap.values()];
 const data={gi,packageId:identity.packageId,name:identity.name,sceneKey:identity.sourceKey,specId:spec.id,materials:plan.materials,meshes:meshesData,entities:singleEntities,batches,decalMaterials,decals:plan.decals};
 writeFileSync(join(destination,'spec-data.ts'),'export default '+JSON.stringify(data)+' as const;\n');
 // PBR 像素数据(gzip+base64)按资产各成一个模块,pbr-index.ts 静态导入,pack 构建时解压。
 const pbr=pbrAssets(spec);
 for(const a of pbr){if(!pbrDir)throw Error('规格引用了 Poly Haven 贴图,但没有提供已下载的贴图目录');writeFileSync(join(destination,`pbr-${a}.ts`),'export default '+readFileSync(join(pbrDir,a+'.json'),'utf8').trim()+' as const;\n');}
 writeFileSync(join(destination,'pbr-index.ts'),pbr.map((a,i)=>`import p${i} from './pbr-${a}.ts';\n`).join('')+`export default {${pbr.map((a,i)=>`${JSON.stringify(a)}:p${i}`).join(',')}} as Record<string,{size:number;color:string;normal:string;arm:string}>;\n`);
 writeFileSync(join(destination,'spec.pack.ts'),PACK_SOURCE);
 writeFileSync(join(destination,'export-report.json'),JSON.stringify(plan.report,null,2));
 const sceneGuid=AssetGuid.format(AssetGuid.derive(definePackageId(identity.packageId),identity.sourceKey));
 return {sceneGuid,packageId:identity.packageId,sceneKey:identity.sourceKey,triangleCount:plan.triangles,meshCount:plan.meshes.length,materialCount:plan.materials.length+decalMaterials.length,precookedMeshCount,instancing:plan.instancing,
  diagnostics:plan.report.errors.map(message=>({severity:'error',message})),report:plan.report};
}
