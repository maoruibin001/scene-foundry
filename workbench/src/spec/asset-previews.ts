/**
 * 规格任务的程序化资产预览:对导出计划里的每个网格(每种生成器 × 参数组合一份),
 * 优先直接复用 planSpecExport / planSpecExportParallel 已构建的 MeshAsset(0ms 缓存命中,不重复跑生成器),
 * 按材质底色与自发光着色、简单朝向光照,跨 Bun Worker 线程并行光栅化为等轴 PNG 缩略图,
 * 并写 assets/index.json(族、生成器、参数、三角数、材质槽、使用实例数)。只用于工作台展示,不代表 Engine 渲染。
 */
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {SceneSpec} from './schema';
import {getCachedMeshAsset,sourceSegment,type ExportMesh,type ExportPlan} from './export-pack';
import {GENERATORS} from './generators/index';
import {runGenerator} from './generators/kit';
import {
 buildPreviewDrawList,
 bumpParallelStat,
 rasterizePreviewPng,
 runWorkerTasks,
 type PreviewSlotColor,
 type WorkerTaskPayload,
} from './parallel-assets';

function buildMaterialMap(spec:SceneSpec){
 return new Map(spec.materials.flatMap(m=>[
  [m.id,m] as const,
  [m.id.toLowerCase(),m] as const,
  [sourceSegment(m.id),m] as const,
 ]));
}

function makeColorResolver(mats:ReturnType<typeof buildMaterialMap>,mesh:ExportMesh):(slot:string)=>PreviewSlotColor{
 return (slot:string)=>{
  const m:any=mats.get((mesh.slots as any)[slot]);
  return {
   skip:slot==='constraintField'||(m?.opacity??1)<0.3,
   c:(m?.emissive&&m.emissiveIntensity>0?m.emissive:m?.baseColor??[0.5,0.5,0.5]).slice(0,3),
   e:m?.emissiveIntensity??0,
  };
 };
}

function countMeshUses(plan:ExportPlan):Map<string,number>{
 const uses=new Map<string,number>();
 const countedEntityIds=new Set<string>();
 for(const e of plan.entities){
  uses.set(e.mesh,(uses.get(e.mesh)??0)+1);
  countedEntityIds.add(e.id);
 }
 // 兼容仅通过 instancedBatches 给出实例矩阵的合成计划,同时避免对已在 plan.entities 中的实体重复计数。
 for(const b of plan.instancedBatches??[]){
  const extra=b.entityIds.length
   ?b.entityIds.filter(id=>!countedEntityIds.has(id)).length
   :Math.floor(b.transforms.length/16);
  if(extra>0)uses.set(b.mesh,(uses.get(b.mesh)??0)+extra);
 }
 return uses;
}

function writePreviewIndex(outDir:string,items:any[]){
 writeFileSync(
  join(outDir,'index.json'),
  JSON.stringify({
   version:'spec-asset-previews-v1',
   note:'生成器真实网格的等轴投影缩略图,按材质底色/自发光着色;不是 Engine 渲染',
   assets:items,
  },null,2),
 );
}

export function writeAssetPreviews(spec:SceneSpec,plan:ExportPlan,outDir:string){
 mkdirSync(outDir,{recursive:true});
 const mats=buildMaterialMap(spec),fam=new Map(spec.families.map(f=>[f.id,f]));
 const uses=countMeshUses(plan);
 const items:any[]=[];
 for(const mesh of plan.meshes){
  const f=fam.get(mesh.family);
  const item:any={
   key:mesh.key,family:mesh.family,familyLabel:f?.label??mesh.family,
   generator:mesh.generator,triangles:mesh.triangles,params:mesh.params,
   slots:mesh.slots,instances:uses.get(mesh.key)??0,image:null,error:null,
  };
  try{
   if(mesh.generator==='proxy')throw Error('代理盒(生成器未实现)');
   const cached=getCachedMeshAsset(mesh);
   if(!cached)bumpParallelStat('previewGeneratorFallbacks');
   const asset:any=cached??runGenerator(GENERATORS[mesh.generator]!,mesh.params as any,mesh.key);
   const drawList=buildPreviewDrawList(asset,makeColorResolver(mats,mesh));
   const pngBytes=rasterizePreviewPng(asset.attributes.position,asset.indices,drawList);
   writeFileSync(join(outDir,mesh.key+'.png'),pngBytes);
   item.image=mesh.key+'.png';
  }catch(e){
   item.error=String((e as Error).message??e).slice(0,300);
  }
  items.push(item);
 }
 writePreviewIndex(outDir,items);
 return items;
}

export async function writeAssetPreviewsParallel(
 spec:SceneSpec,
 plan:ExportPlan,
 outDir:string,
 opts?:{concurrency?:number},
){
 mkdirSync(outDir,{recursive:true});
 const mats=buildMaterialMap(spec),fam=new Map(spec.families.map(f=>[f.id,f]));
 const uses=countMeshUses(plan);
 const items:any[]=plan.meshes.map(mesh=>{
  const f=fam.get(mesh.family);
  return {
   key:mesh.key,family:mesh.family,familyLabel:f?.label??mesh.family,
   generator:mesh.generator,triangles:mesh.triangles,params:mesh.params,
   slots:mesh.slots,instances:uses.get(mesh.key)??0,image:null,error:null,
  };
 });

 const tasks:WorkerTaskPayload[]=[];
 const itemIndices:number[]=[];
 const defaultColor:PreviewSlotColor={c:[0.5,0.5,0.5],e:0,skip:false};

 for(let i=0;i<plan.meshes.length;i++){
  const mesh=plan.meshes[i]!;
  if(mesh.generator==='proxy'){
   items[i].error='代理盒(生成器未实现)';
   continue;
  }
  const colorOf=makeColorResolver(mats,mesh);
  const cached:any=getCachedMeshAsset(mesh);
  if(cached){
   const drawList=buildPreviewDrawList(cached,colorOf);
   tasks.push({kind:'preview',position:cached.attributes.position,indices:cached.indices,drawList});
   itemIndices.push(i);
  }else{
   bumpParallelStat('previewGeneratorFallbacks');
   const slotColors:Record<string,PreviewSlotColor>={};
   for(const slot of Object.keys(mesh.slots))slotColors[slot]=colorOf(slot);
   tasks.push({
    kind:'preview-generate',
    meshKey:mesh.key,
    generatorId:mesh.generator,
    params:mesh.params,
    slotColors,
    defaultColor,
   });
   itemIndices.push(i);
  }
 }

 const {results}=await runWorkerTasks(tasks,{concurrency:opts?.concurrency});
 for(let t=0;t<results.length;t++){
  const res=results[t]!,idx=itemIndices[t]!,mesh=plan.meshes[idx]!;
  if(res.ok&&res.kind==='preview'){
   bumpParallelStat('previewWorkerRuns');
   writeFileSync(join(outDir,mesh.key+'.png'),new Uint8Array(res.ab));
   items[idx].image=mesh.key+'.png';
  }else{
   items[idx].error=String(res.ok?'Unexpected preview response':res.error).slice(0,300);
  }
 }

 writePreviewIndex(outDir,items);
 return items;
}
