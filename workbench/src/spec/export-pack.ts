/**
 * 规格 → 引擎场景 pack。网格不烘焙进 pack:pack 源码记录"生成器 ID + 参数",引擎构建时调用生成器产出网格,
 * 即手册 4.2 的 editable_geometry"逐对象程序化引用"。导出时在本进程先跑一遍全部生成器,
 * 让参数错误、材质槽不匹配与三角预算在引擎构建前暴露;同族同参数的对象共享一个网格。
 * 缺少库生成器的资产族按手册 4.3 回退为同 ID 灰模代理并写入 repair 列表,不静默丢弃。
 * 坐标:规格右手、米、Z 向上 → 引擎 Y 向上,位置 (x,y,z)→(x,z,-y);旋转按 X、Y、Z 依次绕固定轴。
 */
import {cpSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {AssetGuid} from '@forgeax/engine/pack/guid';
import {definePackageId} from '@forgeax/engine/pack/source';
import {GENERATORS,GENERATOR_SOURCES} from './generators/index';
import {resolveParams,runGenerator,type ParamValue} from './generators/kit';
import type {SceneSpec,SpecMaterial,SpecObject,Vec3} from './schema';

export type Quat=[number,number,number,number];
export const toEnginePosition=(p:Vec3):Vec3=>[p[0],p[2],-p[1]];
export const toEngineScale=(s:Vec3):Vec3=>[s[0],s[2],s[1]];
const axisQuat=(axis:Vec3,deg:number):Quat=>{const h=deg*Math.PI/360,s=Math.sin(h);return [axis[0]*s,axis[1]*s,axis[2]*s,Math.cos(h)];};
const mul=(a:Quat,b:Quat):Quat=>[a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];
/** 规格 XYZ 欧拉(度,依次绕固定 X、Y、Z)→ 引擎四元数 [x,y,z,w]:规格 X→引擎 X,规格 Y→引擎 -Z,规格 Z→引擎 Y。 */
export function toEngineQuat(r:Vec3):Quat{
 return mul(axisQuat([0,1,0],r[2]),mul(axisQuat([0,0,-1],r[1]),axisQuat([1,0,0],r[0])));
}
export const sourceSegment=(id:string)=>id.toLowerCase().replace(/[^a-z0-9._-]+/g,'-').replace(/^[^a-z0-9]+/,'');

/** aabb:网格局部包围盒(引擎 Y 向上)[minX,minY,minZ,maxX,maxY,maxZ],供取景检查与地标使用。 */
export type ExportMesh={key:string;family:string;generator:string;params:Record<string,ParamValue>;slots:Record<string,string>;triangles:number;aabb:number[]};
export type ExportEntity={id:string;label:string;mesh:string;pos:Vec3;quat:Quat;scale:Vec3};
export type ExportReport={expanded:{object:string;count:number}[];slotFallbacks:{family:string;slot:string;material:string}[];covered:{object:string;family:string;by:string}[];proxies:{object:string;family:string;reason:string}[];dropped:{family:string;key:string;reason:string}[];derived:{object:string;key:string;value:ParamValue}[];errors:string[]};
export type ExportPlan={meshes:ExportMesh[];entities:ExportEntity[];materials:{key:string;options:Record<string,unknown>;surface?:{pattern:string;tilesPerMeter:number}}[];report:ExportReport;triangles:number};

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

export function planSpecExport(spec:SceneSpec):ExportPlan{
 const report:ExportReport={expanded:[],slotFallbacks:[],covered:[],proxies:[],dropped:[],derived:[],errors:[]};
 const meshes=new Map<string,ExportMesh>(),entities:ExportEntity[]=[];
 // 平面反射只作用于反射对象所属族里的光滑材质(roughness≤0.15,如池水);引擎要求材质在 pack 里烘焙该开关。
 const state=spec.lighting.states.find(s=>s.id===spec.lighting.defaultState),planar=state?.post.planarReflections[0];
 const planarFamily=planar?spec.families.find(f=>f.id===spec.objects.find(o=>o.id===planar.object)?.family):undefined;
 const mirrored=new Set(Object.values(planarFamily?.materialSlots??{}).filter(id=>(spec.materials.find(m=>m.id===id)?.roughness??1)<=0.15));
 const materials=spec.materials.map(m=>({key:sourceSegment(m.id),options:{...materialOptions(m),...(mirrored.has(m.id)?{planarReflection:true}:{})},...(m.surface?{surface:m.surface}:{})}));
 // 灰模代理压成暗色:它只占位,不应在画面里抢眼(仍保留可见,如实标示缺生成器)。
 materials.push({key:PROXY_MATERIAL,options:{baseColor:[0.06,0.065,0.07,1],metallic:0.3,roughness:0.6}});
 const matKey=(id:string)=>sourceSegment(id);
 const expanded=expandInstances(spec.objects,report);
 for(const family of spec.families){
  let objects=expanded.filter(o=>o.family===family.id).sort((a,b)=>a.id.localeCompare(b.id));
  const gen=family.generator?GENERATORS[family.generator.id]:undefined;
  if(gen?.assembly&&objects.length){
   // 整组生成器:主控对象作实例(没有就在族原点合成一个),其余对象是它的组成部分,不再各出一份网格。
   const masters=objects.filter(o=>o.authority==='master');
   const instance=masters[0]??{...objects[0],id:`${family.id}-assembly`,label:`${family.label}(整组)`,transform:{...objects[0].transform,position:[0,0,0],rotationDeg:[0,0,0],scale:[1,1,1]},params:{}};
   for(const o of objects)if(o.id!==instance.id&&!masters.slice(1).includes(o))report.covered.push({object:o.id,family:family.id,by:instance.id});
   objects=[instance,...masters.slice(1)];
  }
  objects.forEach((o:SpecObject,index)=>{
   let mesh:ExportMesh;
   if(!gen){
    const size=Array.isArray(o.params.size)&&o.params.size.length===3?o.params.size as Vec3:null;
    report.proxies.push({object:o.id,family:family.id,reason:family.generator?`生成器 ${family.generator.id} 尚未实现`:'资产族未指定生成器'});
    const params={size:size??[1,1,1],floor:o.transform.position[2]<=0.05};
    const [sx,sy,sz]=params.size,base=params.floor?0:-sz/2;
    mesh={key:`${sourceSegment(family.id)}-proxy-${hash(params)}`,family:family.id,generator:'proxy',params:params as any,slots:{proxy:PROXY_MATERIAL},triangles:12,aabb:[-sx/2,base,-sy/2,sx/2,base+sz,sy/2]};
   }else{
    const merged:Record<string,ParamValue>={};
    // 族参数与对象参数分别过生成器适配(区间/合并向量 → 生成器参数),对象值覆盖族值。
    const ctx={id:o.id,position:o.transform.position},adapt=(v:Record<string,ParamValue>)=>gen.adapt?gen.adapt(v,ctx):v;
    const familyParams=adapt(family.generator!.params),objectParams=adapt(o.params);
    for(const [key,value] of Object.entries({...familyParams,...objectParams})){
     const drop=(reason:string)=>{if(!report.dropped.some(d=>d.family===family.id&&d.key===key))report.dropped.push({family:family.id,key,reason});};
     if(!(key in gen.params)){drop('生成器没有这个参数');continue;}
     const fromObject=key in objectParams;
     if(Array.isArray(value)&&gen.params[key].type!=='vec3'&&gen.params[key].type!=='list'){
      // 手册里一族多尺寸(外径 11/13/15)按 ID 顺序逐个对应族内对象;数量对不上:对象级报错,族级丢弃并用默认值。
      if(!fromObject&&value.length===objects.length){merged[key]=value[index];report.derived.push({object:o.id,key,value:value[index]});continue;}
      if(fromObject){report.errors.push(`${o.id}.${key}=${JSON.stringify(value)} 是列表且无法按族内对象数 ${objects.length} 对应`);continue;}
      drop(`族级列表 ${JSON.stringify(value)} 无法按族内对象数 ${objects.length} 对应,用默认值`);continue;
     }
     if(resolveParams(gen,{[key]:value}).errors.length){
      // 主控对象的参数不合契约是硬错误;补全值不合契约只丢弃该值、用默认值,并留痕。
      if(fromObject&&o.authority==='master'){report.errors.push(`${o.id}.${key}=${JSON.stringify(value)} 不合 ${gen.id} 契约`);continue;}
      drop(`${fromObject?'对象':'族级'}值 ${JSON.stringify(value)} 不合生成器契约,用默认值`);continue;
     }
     merged[key]=value;
    }
    const {params,errors}=resolveParams(gen,merged);
    if(errors.length){report.errors.push(...errors.map(e=>`${o.id}: ${e}`));return;}
    const key=`${sourceSegment(family.id)}-${hash({g:gen.id,params})}`;
    if(!meshes.has(key)){
     let triangles=0,slots:Record<string,string>={},aabb:number[]=[];
     try{
      const asset=runGenerator(gen,params as any,key);triangles=(asset.indices?.length??0)/3;aabb=Array.from(asset.aabb as ArrayLike<number>);
      // 规格没写到的生成器槽用本族最常用的材质补上(留痕);族里一个材质都没有才算错误。
      const used=Object.values(family.materialSlots),common=used.sort((a,b)=>used.filter(x=>x===b).length-used.filter(x=>x===a).length)[0];
      const missing=(asset.materialSlots??[]).map(s=>s.slotName).filter(n=>!family.materialSlots[n]);
      if(missing.length&&!common){report.errors.push(`${family.id}: 生成器槽 ${missing.join(',')} 在规格材质槽里没有对应材质`);return;}
      for(const slot of missing)if(!report.slotFallbacks.some(f=>f.family===family.id&&f.slot===slot))report.slotFallbacks.push({family:family.id,slot,material:common});
      for(const s of asset.materialSlots??[])slots[s.slotName]=matKey(family.materialSlots[s.slotName]??common);
     }catch(error){report.errors.push(`${o.id}: ${String(error).slice(0,300)}`);return;}
     meshes.set(key,{key,family:family.id,generator:gen.id,params:params as any,slots,triangles,aabb});
    }
    mesh=meshes.get(key)!;
   }
   meshes.set(mesh.key,mesh);
   entities.push({id:o.id,label:o.label,mesh:mesh.key,pos:toEnginePosition(o.transform.position),quat:toEngineQuat(o.transform.rotationDeg),scale:toEngineScale(o.transform.scale)});
  });
 }
 const triangles=entities.reduce((n,e)=>n+(meshes.get(e.mesh)?.triangles??0),0);
 return {meshes:[...meshes.values()],entities,materials,report,triangles};
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
    const n=v as number[];q[k.slice(0,-5)]=Array.from({length:n.length/3},(_,i)=>toEnginePosition([n[3*i]-origin[0],n[3*i+1]-origin[1],n[3*i+2]-origin[2]])).flat();
   }else q[k]=v;}return q;};
  if(pts||ys){
   const at:Vec3[]=pts?Array.from({length:pts.length/3},(_,i)=>[pts[3*i],pts[3*i+1],pts[3*i+2]]):ys!.map(y=>[o.transform.position[0],y,o.transform.position[2]]);
   const yaw=Array.isArray(o.params.yawDeg)?o.params.yawDeg as number[]:null,{positions:_p,yPositions:_y,yawDeg:_w,...rest}=o.params;
   at.forEach((position,i)=>out.push({...o,id:`${o.id}__${i+1}`,transform:{...o.transform,position,rotationDeg:yaw?[o.transform.rotationDeg[0],o.transform.rotationDeg[1],yaw[i]??0]:o.transform.rotationDeg},params:local(rest,position)}));
   report.expanded.push({object:o.id,count:at.length});
  }else out.push({...o,params:local(o.params,o.transform.position)});
 }
 return out;
}
function hash(v:unknown){return createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0,10);}

const PACK_SOURCE=`// 由 scene-foundry 规格导出器生成;网格在引擎构建时由生成器按参数产出。
import {AssetGuid} from '@forgeax/engine/pack/guid';
import {definePack,definePackageId} from '@forgeax/engine/pack/source';
import {model} from '@forgeax/engine/modeling';
import {Materials,MeshFilter,MeshRenderer} from '@forgeax/engine/render';
import {Name,Transform} from '@forgeax/engine/scene';
import type {MeshAsset} from '@forgeax/engine/types';
import {ok} from '@forgeax/engine/types';
import {GENERATORS} from './spec-kit/index.ts';
import {runGenerator} from './spec-kit/kit.ts';
import {surfaceMaps,type SurfacePattern} from './spec-kit/textures.ts';
import {buildMeshCardLayout,buildMeshDistanceField,buildVisibilityDistanceField} from '@forgeax/engine/geometry';
import data from './spec-data.ts';
import pbr from './pbr-index.ts';
const packageId=definePackageId(data.packageId);
const ref=(key:string)=>AssetGuid.format(AssetGuid.derive(packageId,key));
function proxy(size:readonly number[],floor:boolean,key:string):MeshAsset{
 const m=model();m.box({size:[size[0],size[2],size[1]],center:[0,floor?size[2]/2:0,0],material:'proxy'});m.uv.project({mode:'box',scale:0.5});
 const out=m.finish({key,normals:{mode:'weighted'}});if(!out.ok)throw out.error;return out.value['mesh/'+key] as MeshAsset;
}
export default definePack({
 schemaVersion:'2.0.0',packageId,name:data.name,
 sceneComponents:[MeshFilter,MeshRenderer,Name,Transform],
 async build(){
  const out:Record<string,unknown>={};
  // 程序化表面贴图:每种纹样生成一次(法线/金属粗糙度为线性,底色调制为 sRGB),共用一个重复采样器。
  const patterns=[...new Set(data.materials.flatMap((m:any)=>m.surface&&!m.surface.pattern.startsWith('polyhaven:')?[m.surface.pattern as SurfacePattern]:[]))];
  const unzip=async(b64:string)=>new Uint8Array(await new Response(new Blob([Uint8Array.from(atob(b64),c=>c.charCodeAt(0))]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  for(const [name,t] of Object.entries(pbr))for(const [ch,b64,srgb] of [['color',t.color,true],['normal',t.normal,false],['mr',t.arm,false]] as const)
   out['texture/polyhaven-'+name+'-'+ch]={kind:'texture',shape:{viewDimension:'2d',extent:{width:t.size,height:t.size}},format:srgb?'rgba8unorm-srgb':'rgba8unorm',data:await unzip(b64),colorSpace:srgb?'srgb':'linear',mips:{kind:'generate'}};
  for(const p of patterns){const t=surfaceMaps(p);for(const [ch,bytes,srgb] of [['normal',t.normal,false],['mr',t.metallicRoughness,false],['color',t.baseColor,true]] as const)
   out['texture/'+p+'-'+ch]={kind:'texture',shape:{viewDimension:'2d',extent:{width:t.size,height:t.size}},format:srgb?'rgba8unorm-srgb':'rgba8unorm',data:bytes,colorSpace:srgb?'srgb':'linear',mips:{kind:'generate'}};}
  if(patterns.length||Object.keys(pbr).length)out['sampler/surface-repeat']={kind:'sampler',magFilter:'linear',minFilter:'linear',mipmapFilter:'linear',addressModeU:'repeat',addressModeV:'repeat',maxAnisotropy:8};
  // 生成器 UV 为盒投影 scale 0.5(每 2 米一个 UV 单位),按 tilesPerMeter 换算贴图缩放。
  const channel=(p:string,ch:string,tiles:number)=>({texture:ref('texture/'+p.replace(':','-')+'-'+ch),sampler:ref('sampler/surface-repeat'),coordinates:{transform:{scale:[tiles*2,tiles*2]}}});
  for(const m of data.materials as any[])out['material/'+m.key]=Materials.standard({...m.options,...(m.surface?{normalTexture:channel(m.surface.pattern,'normal',m.surface.tilesPerMeter),metallicRoughnessTexture:channel(m.surface.pattern,'mr',m.surface.tilesPerMeter),baseColorTexture:channel(m.surface.pattern,'color',m.surface.tilesPerMeter)}:{})} as any);
  for(const mesh of data.meshes){
   const asset=mesh.generator==='proxy'?proxy(mesh.params.size as number[],mesh.params.floor as boolean,mesh.key):runGenerator(GENERATORS[mesh.generator],mesh.params as any,mesh.key);
   // 漫反射 GI(irradiance-field)要求每个网格带距离场与 Card 布局;只在规格开 GI 时生成(构建期开销)。
   let gi:Record<string,unknown>={};
   if(data.gi){const pos=(asset as any).attributes.position,idx=(asset as any).indices;
    // 几何距离场对高面数网格会超出构建预算;退回体素可见性距离场(按包围盒 1/48 取体素)。
    let df:any=await buildMeshDistanceField(pos,idx,{twoSided:true});
    if(!df.ok){const b=(asset as any).aabb,ext=Math.max(b[3]-b[0],b[4]-b[1],b[5]-b[2]);df=await buildVisibilityDistanceField(pos,idx,{voxelSize:Math.max(0.02,ext/48),triangleSidedness:new Uint8Array(idx.length/3).fill(1)});}
    if(!df.ok)throw new Error('distance field '+mesh.key+': '+df.error.detail.reason);
    const cards=await buildMeshCardLayout(pos,idx);if(!cards.ok)throw new Error('card layout '+mesh.key+': '+cards.error.code);
    gi={distanceField:{...df.value,sectionSidedness:asset.submeshes.map(()=>1)},cardLayout:cards.value};}
   out['mesh/'+mesh.key]={...asset,...gi,materialSlots:(asset.materialSlots??[]).map(s=>({...s,sourceKey:mesh.key+':'+s.slotName,defaultMaterial:AssetGuid.derive(packageId,'material/'+(mesh.slots as Record<string,string>)[s.slotName])}))};
  }
  out[data.sceneKey]={kind:'scene',entities:Object.fromEntries(data.entities.map(e=>[e.id,{components:{Name:{value:e.label},Transform:{pos:e.pos,quat:e.quat,scale:e.scale},MeshFilter:{assetHandle:ref('mesh/'+e.mesh)},MeshRenderer:{materials:[]}}}]))};
  return ok(out);
 },
});
`;

/** 写出 spec.pack.ts、spec-data.ts 与生成器源码;返回与 scene-generator 导出一致的收据字段。 */
/** 规格里引用的 Poly Haven 资产名(去重,稳定顺序)。 */
export const pbrAssets=(spec:SceneSpec)=>[...new Set(spec.materials.flatMap(m=>m.surface&&m.surface.pattern.startsWith('polyhaven:')?[m.surface.pattern.slice(10)]:[]))].sort();
export function writeSpecPack(spec:SceneSpec,plan:ExportPlan,destination:string,identity:{packageId:string;sourceKey:string;name:string},pbrDir?:string){
 mkdirSync(join(destination,'spec-kit'),{recursive:true});
 for(const file of GENERATOR_SOURCES)cpSync(join(import.meta.dir,'generators',file),join(destination,'spec-kit',file));
 const gi=spec.lighting.states.find(st=>st.id===spec.lighting.defaultState)?.post.gi?true:false;
 const data={gi,packageId:identity.packageId,name:identity.name,sceneKey:identity.sourceKey,specId:spec.id,materials:plan.materials,meshes:plan.meshes.map(({triangles,family,aabb,...m})=>m),entities:plan.entities};
 writeFileSync(join(destination,'spec-data.ts'),'export default '+JSON.stringify(data)+' as const;\n');
 // PBR 像素数据(gzip+base64)按资产各成一个模块,pbr-index.ts 静态导入,pack 构建时解压。
 const pbr=pbrAssets(spec);
 for(const a of pbr){if(!pbrDir)throw Error('规格引用了 Poly Haven 贴图,但没有提供已下载的贴图目录');writeFileSync(join(destination,`pbr-${a}.ts`),'export default '+readFileSync(join(pbrDir,a+'.json'),'utf8').trim()+' as const;\n');}
 writeFileSync(join(destination,'pbr-index.ts'),pbr.map((a,i)=>`import p${i} from './pbr-${a}.ts';\n`).join('')+`export default {${pbr.map((a,i)=>`${JSON.stringify(a)}:p${i}`).join(',')}} as Record<string,{size:number;color:string;normal:string;arm:string}>;\n`);
 writeFileSync(join(destination,'spec.pack.ts'),PACK_SOURCE);
 writeFileSync(join(destination,'export-report.json'),JSON.stringify(plan.report,null,2));
 const sceneGuid=AssetGuid.format(AssetGuid.derive(definePackageId(identity.packageId),identity.sourceKey));
 return {sceneGuid,packageId:identity.packageId,sceneKey:identity.sourceKey,triangleCount:plan.triangles,meshCount:plan.meshes.length,materialCount:plan.materials.length,
  diagnostics:plan.report.errors.map(message=>({severity:'error',message})),report:plan.report};
}
