/**
 * 规格化前端之一:设计文档(HTML)→ scene-spec-v1。
 * 冻结表格(对象表、生成器参数表、资产目录)确定性解析,作为 master 字段;模型(cbc4 / Opus)只补需要理解的部分:
 * 资产族归类与材质、推断补全的对象摆放(4 路并发分片)、贴花、光照状态与机位、验收条目(共 5 路 Wave 2 并发)。
 * 合并时 master 字段以表格为准覆盖,确定性对账与引用自愈后 validateSceneSpec;产物交 owner 审改后再进入规格驱动的后端。
 * 用法:bun src/spec/normalize-doc.ts <doc.html> <outDir> [--effort high|xhigh]
 */
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {callSpecNode,nodeCacheHash,validateNodeModels,type NodeModels,type NodeModel} from './node-models';
import {findTable,parseHtmlDocument,type DocSource} from './doc-source';
import {handbookGenerators,handbookLeaves,handbookLights,handbookMaterials,handbookObjects,handbookPost,handbookShots,handbookSlots,HANDBOOK_TABLES,type HandbookGenerator,type HandbookObject} from './handbook';
import {reconcileSpec} from './reconcile';
import {GENERATORS} from './generators/index';
import {SCENE_SPEC_VERSION,SPEC_ID,SPEC_LIMITS,validateSceneSpec,type SceneSpec,type SpecAcceptance,type SpecDecal,type SpecFamily,type SpecMaterial,type SpecObject,type SpecParams,type Vec3} from './schema';

// ---------- 模型输出 schema(结构化输出不允许任意键,参数与材质槽用条目数组表达,合并时转回映射) ----------
const str={type:'string'},num={type:'number'},bool={type:'boolean'};
const obj=(properties:any)=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const arr=(items:any,maxItems?:number)=>({type:'array',items,...(maxItems?{maxItems}:{})});
const vec3={type:'array',items:num,minItems:3,maxItems:3};
const nullable=(s:any)=>({anyOf:[{type:'null'},s]});
const source=obj({kind:{type:'string',enum:['doc','image','prompt','inferred']},ref:str});
const param=obj({name:str,number:nullable(num),numbers:nullable(arr(num,64)),text:nullable(str),flag:nullable(bool)});
const authority={type:'string',enum:['master','aux','design_fill']};
const surface=nullable(obj({pattern:{type:'string',enum:['panel','plate','grate','concrete','puddle','deck','worn','trim']},tilesPerMeter:num}));

const materialItem=obj({id:str,label:str,baseColor:arr(num,4),metallic:num,roughness:num,emissive:nullable(vec3),emissiveIntensity:num,transmission:num,ior:num,thickness:num,clearcoat:num,clearcoatRoughness:num,attenuationColor:nullable(vec3),attenuationDistance:nullable(num),surface,sources:arr(source)});
const familyItem=obj({id:str,label:str,description:str,priority:{type:'string',enum:['P0','P1','P2']},covers:arr(str),generatorId:nullable(str),generatorParams:arr(param,SPEC_LIMITS.params),materialSlots:arr(obj({slot:str,material:str}),12),authority,sources:arr(source)});
export const MATERIALS_ONLY_SCHEMA=obj({materials:arr(materialItem,SPEC_LIMITS.materials)});
export const FAMILIES_SHARD_SCHEMA=obj({families:arr(familyItem,SPEC_LIMITS.families),excludedLeaves:arr(obj({id:str,reason:str}))});
export const FAMILIES_SCHEMA=obj({
 materials:arr(materialItem,SPEC_LIMITS.materials),
 families:arr(familyItem,SPEC_LIMITS.families),
 excludedLeaves:arr(obj({id:str,reason:str})),
});
const objectItem=obj({id:str,label:str,family:str,parent:nullable(str),position:vec3,rotationDeg:vec3,scale:vec3,params:arr(param,SPEC_LIMITS.params),authority,sources:arr(source),confidence:num,notes:str});
export const OBJECTS_SCHEMA=obj({
 objects:arr(objectItem,SPEC_LIMITS.objects),
 excludedMasters:arr(obj({id:str,reason:str})),
});
export const OBJECTS_SHARD_SCHEMA=OBJECTS_SCHEMA;
const decalItem=obj({id:str,label:str,kind:{type:'string',enum:['stencil','hazard','puddle']},text:nullable(str),color:nullable(vec3),position:vec3,rotationDeg:vec3,size:vec3,opacity:nullable(num),roughness:nullable(num)});
export const INFRA_DECALS_SCHEMA=obj({
 objects:arr(objectItem,SPEC_LIMITS.objects),
 excludedMasters:arr(obj({id:str,reason:str})),
 decals:arr(decalItem,SPEC_LIMITS.decals),
});
const light=obj({id:str,kind:{type:'string',enum:['directional','point','spot','area']},position:nullable(vec3),direction:nullable(vec3),color:vec3,intensity:num,range:nullable(num),innerConeDeg:nullable(num),outerConeDeg:nullable(num),width:nullable(num),height:nullable(num),castShadow:bool});
export const STAGING_SCHEMA=obj({
 states:arr(obj({id:str,label:str,lights:arr(light,SPEC_LIMITS.lights),ambient:obj({color:vec3,groundColor:nullable(vec3),intensity:num}),background:vec3,
  post:obj({tonemap:{type:'string',enum:['aces','agx','neutral']},exposure:nullable(num),bloom:nullable(obj({threshold:num,intensity:num,radius:num})),gtao:bool,ssr:nullable(obj({maxDistance:num,thickness:num,maxRoughness:num})),fog:nullable(obj({color:vec3,density:num,anisotropy:num,boundsMin:vec3,boundsMax:vec3,light:str})),planarReflections:arr(obj({object:str,height:num,distortion:num}),4),volumetric:nullable(obj({lights:nullable(arr(str,2)),extinction:num,albedo:vec3,anisotropy:num,heightFalloff:num,noise:num,maxDistance:num,emission:vec3})),cameraFx:nullable(obj({flareIntensity:num,flareThreshold:num,vignette:num,chromaticAberration:num,grain:num}))})}),SPEC_LIMITS.states),
 defaultState:str,
 shots:arr(obj({id:str,label:str,position:vec3,target:vec3,fovDeg:num}),SPEC_LIMITS.shots),
 constraints:arr(obj({id:str,description:str,number:nullable(num),numbers:nullable(arr(num,16)),text:nullable(str),unit:str,status:{type:'string',enum:['P','frozen']},sources:arr(source)}),SPEC_LIMITS.constraints),
 acceptance:arr(obj({id:str,description:str,critical:bool,kind:{type:'string',enum:['count','position','size','clearance']},family:nullable(str),equals:nullable(num),object:nullable(str),position:nullable(vec3),size:nullable(vec3),tolerance:nullable(num),from:nullable(vec3),to:nullable(vec3),width:nullable(num),height:nullable(num)}),SPEC_LIMITS.acceptance),
});

// ---------- 上下文 ----------
export type HandbookFacts={masters:HandbookObject[];generators:HandbookGenerator[];leaves:ReturnType<typeof handbookLeaves>;assemblies:string[][]};
export function handbookFacts(doc:DocSource):HandbookFacts{
 return {masters:handbookObjects(doc),generators:handbookGenerators(doc),leaves:handbookLeaves(doc),assemblies:findTable(doc,[...HANDBOOK_TABLES.assemblies]).rows};
}
/** 全文按章节铺开,表格以制表符行内联,供模型理解语义;冻结数值另以 facts JSON 给出。 */
export function documentText(doc:DocSource){
 return doc.sections.map(s=>(s.heading?`\n## ${s.heading}\n`:'')+s.text.replace(/\[\[table:(\d+)\]\]/g,(_,i)=>{const t=doc.tables[Number(i)];return '\n'+[t.header,...t.rows].map(r=>r.join('\t')).join('\n')+'\n';}).replace(/\[\[image:(\d+)\]\]/g,(_,i)=>`[图${i}:${doc.images[Number(i)].alt}]`)).join('\n');
}
/** 紧凑章节摘录:facts 已有完整表格数据,大表格内联只保留表头与前几行示例,大幅降低 Wave 2 并发提示词体积并保持语义完整。 */
function compactSectionText(doc:DocSource,headingRe?:RegExp){
 const picked=headingRe?doc.sections.filter(s=>headingRe.test(s.heading||'')||!s.heading):doc.sections;
 const sections=picked.length?picked:doc.sections;
 return sections.map(s=>(s.heading?`\n## ${s.heading}\n`:'')+s.text.replace(/\[\[table:(\d+)\]\]/g,(_,i)=>{const t=doc.tables[Number(i)];const rows=t.rows.length>12?[...t.rows.slice(0,8),['...(完整行见 facts JSON)...']]:t.rows;return '\n'+[t.header,...rows].map(r=>r.join('\t')).join('\n')+'\n';}).replace(/\[\[image:(\d+)\]\]/g,(_,i)=>`[图${i}:${doc.images[Number(i)].alt}]`)).join('\n');
}

const HIGH_TECH_LAWS=`重工业湿冷科幻高反差光学与材质铁律(Moody Wet-Industrial Sci-Fi Optical & Material Laws — 对照主视觉概念图):
1. 材质物理(告别白墙医院感,塑造湿冷厚重金属层次):
   - 建筑主墙板、桁架与步道框架采用**深冷枪铁灰 / 磨损钛钢**(baseColor RGB 0.18..0.32, 中高金属度 metallic 0.58..0.78, roughness 0.26..0.38, 赋 surface:{pattern:'worn',tilesPerMeter:0.6} 或 {pattern:'trim',tilesPerMeter:0.5}),在斜射光与色光下呈现厚重拉丝高光与岁月磨损感,绝不刷成 >0.75 的苍白石膏墙!
   - 核心球装甲瓦采用**黑曜石镜面装甲**(baseColor RGB 0.035..0.06, metallic 0.85, roughness 0.16..0.22, clearcoat 0.75),能量缝隙极细(seamWidth=0.06, 严禁 >0.10 把球冲成白球; field=false 不加外层雾罩),让黑色六角装甲与细锐冰青发光脉络形成极致反差!
   - 主地面采用**深色湿润镜面钢甲板**(baseColor RGB 0.05..0.09, metallic 0.55, roughness 0.06..0.10, clearcoat 0.9, surface:{pattern:'deck',tilesPerMeter:0.5}),清晰映出核心、蓝色能量巨柱与暖橙回廊倒影!
2. 强明暗对比与因果布光(Chiaroscuro Causal Lighting):
   - 压低均匀环境底光(ambient.intensity 0.12..0.18, 冷蓝天光 [0.38,0.52,0.75] + 地面微弱反弹 groundColor [0.09,0.13,0.19]),让暗部深邃有体积,靠主光源建立戏剧性明暗因果!
   - 主光源因果链:顶部天窗斜射冷白主光(DirectionalLight intensity 3.0..3.8, castShadow:true) + 中央核心高纯冰青光源([0.18,0.82,1.0]) + 远端工业大门强逆光白青聚光 + 四座通高双舱能量巨柱(GEN-NODEBEAM-02, height:16.5, radius:1.55)冰青辉光 + 两侧回廊与设备暖琥珀([1.0,0.58,0.18])点缀光!
3. 零重力空气透视与电影焦段(Atmospheric Haze & Cinematic Lenses):
   - 开启真实朦胧空气感:fog={color:[0.06,0.10,0.17], density:0.0035..0.0045}, volumetric={extinction:0.012..0.016, albedo:[0.50,0.72,0.96], anisotropy:0.78}, post.tonemap='agx', post.exposure=0.56..0.64, bloom={threshold:1.9, intensity:0.18}!
   - 所有相机机位严格采用 **28mm–50mm 电影焦段(垂直 fovDeg 36°..54°,严禁 >58° 超广角把核心拍小)**,贴墙铺设多层工业设备立面(GEN-WALLKIT-01, tiers:3, style:0)消除中远景空洞留白!`;

const ENGINE_FACTS=`目标引擎 ForgeaX 0.5(实测 2026-11-06,1600×900 目标 ≥30 FPS):
- 光照预算:1 盏方向光(2 级 2048 级联阴影,自适应大空间阴影距离)+ 最多 2 盏投影聚光(顶部核心光柱 + 远端背光门);点光/聚光射程随大厅跨度自适应(大空间可用 32..55m),总灯数 ≤12;矩形面光单灯开销是点光数倍,最多 1 盏。细碎氛围灯点、灯带、屏幕用自发光材质(进 bloom),关键区域配真实因果光源照亮邻近表面。
- 可用高阶特性:半球天光 Skylight(含 groundColor 下半球漫反射反弹,消除背光死黑)、体积雾 volumetric(绑定方向光出光柱,extinction 0.008..0.014,anisotropy≈0.82;解析高度雾 fog.density 只做极淡底 ≤0.0025)、GTAO、屏幕空间反射、1 个平面反射(大面积湿地面或中央水池)、盒投影反射探针、bloom、AgX、镜头光晕/暗角/色差/颗粒(cameraFx:flareIntensity≈0.35、vignette≈0.28、chromaticAberration≈0.2、grain≈0.04)、PBR metallic-roughness+emissive+clearcoat+transmission+surface 程序化纹样+ProjectedDecal 贴花。
- 规模:场景 ≤60 万三角;大空间靠高精度程序化生成器实例与通透体积光营造。\n${HIGH_TECH_LAWS}`;
const SCOPE=`本次只搭建静态场景环境与光影,不实现交互、玩法、物理、敌人、角色、AI 对话、声音、UI、特效粒子与运行时破坏。玩家、武器、敌人、触发体、出生点、纯玩法数据不进入场景对象;破坏类资产只保留完整(未破坏)外观。`;
const SYSTEM=`你是游戏关卡的技术美术与场景规格化工程师。把设计手册整理成标准化场景规格。手册中的冻结表格已由程序确定性解析为 facts,其中的 ID、坐标、尺寸、倾角、生成器参数是 master 事实,必须原样使用,不得改写、取整或换算。手册没有给出、但搭建完整大厅必需的内容,按手册的约束、预算与高科明亮科幻光学铁律合理补全,标 authority=design_fill,并在 sources 里写依据章节;不能声称补全是测量结果。每条输出写来源(kind=doc 时 ref 写章节名或资产 ID)。重要执行要求:请保持思维链简短果断(控制在 800 字以内),不要逐条复述表格或反复纠结边缘项,直接调用 StructuredOutput 输出紧凑合法的 JSON。全部使用中文。${SCOPE}\n${ENGINE_FACTS}`;

function paramsOf(list:{name:string;number:number|null;numbers:number[]|null;text:string|null;flag:boolean|null}[]):SpecParams{
 const out:SpecParams={};
 for(const p of list??[]){
  const v=p.number??p.numbers??p.flag??p.text;if(v===null||v===undefined)continue;
  // 模型偶尔把多个计数压进一个超长键;不合规格键名的参数降为文字备注,不让整份规格作废。
  if(/^[a-z][a-zA-Z0-9_]{0,40}$/.test(p.name))out[p.name]=v;else out.note_params=[out.note_params,`${p.name}=${JSON.stringify(v)}`].filter(Boolean).join('; ');
 }
 return out;
}

const clamp=(n:number,lo:number,hi:number)=>Number.isFinite(n)?Math.min(hi,Math.max(lo,n)):lo;
const clampVec3=(v:unknown,lo:number,hi:number,fallback:Vec3=[0,0,0]):Vec3=>Array.isArray(v)&&v.length>=3?[clamp(Number(v[0]),lo,hi),clamp(Number(v[1]),lo,hi),clamp(Number(v[2]),lo,hi)]:fallback;

async function mapConcurrent<T,R>(items:readonly T[],limit:number,fn:(item:T,index:number)=>Promise<R>):Promise<R[]>{
 const max=Math.max(1,Number.isFinite(limit)?Math.floor(limit):6);
 const out=new Array<R>(items.length);
 let next=0;
 await Promise.all(Array.from({length:Math.min(max,items.length)},async()=>{
  while(next<items.length){const i=next++;out[i]=await fn(items[i]!,i);}
 }));
 return out;
}

async function ask(dir:string,role:string,task:string,facts:object,doc:string,schema:any,images:{path:string;mime:string}[],effort:string,reuseMode=process.env.SPEC_REUSE_CALLS,selection?:NodeModel,signal?:AbortSignal,system=SYSTEM){
 mkdirSync(dir,{recursive:true});
 // 同一任务文本已有输出时直接复用:规格化每步耗时较长,合并逻辑修改后重跑不应再花模型调用。
 const selected=selection??{...validateNodeModels(null).families,reasoningEffort:effort};const saved=join(dir,role+'-output.json'),taskHash=nodeCacheHash(system+'\n'+task,facts,doc,schema,selected,images);
 // SPEC_REUSE_CALLS=1 只复用任务文本完全相同的输出;=force 复用已有输出(用于早于哈希记录的归档运行)。
 const reuse=reuseMode,hashFile=join(dir,role+'-task.sha256');
 if(existsSync(saved)&&((reuse==='1'&&existsSync(hashFile)&&readFileSync(hashFile,'utf8')===taskHash))){return JSON.parse(readFileSync(saved,'utf8'));}
 const text=`${task}\n\n# facts(确定性解析,master 事实)\n${JSON.stringify(facts)}\n\n# 手册参考章节\n${doc}`;
 const r=await callSpecNode({system,text,images,role,signal},dir,selected,schema);
 writeFileSync(saved,r.text);writeFileSync(join(dir,role+'-receipt.json'),JSON.stringify(r.receipt,null,2));writeFileSync(hashFile,taskHash);
 return JSON.parse(r.text);
}

// ---------- 合并 ----------
const VALID_PATTERNS=new Set(['panel','plate','grate','concrete','puddle','deck','worn','trim']);
function sanitizeMaterial(m:any):SpecMaterial{
 const rgba=Array.isArray(m.baseColor)&&m.baseColor.length===4?m.baseColor.map((n:any)=>clamp(Number(n),0,1)) as [number,number,number,number]:[0.7,0.74,0.78,1] as [number,number,number,number];
 const surf=m.surface&&(VALID_PATTERNS.has(m.surface.pattern)||/^polyhaven:[a-z0-9_]+$/.test(String(m.surface.pattern)))
  ?{pattern:m.surface.pattern,tilesPerMeter:clamp(Number(m.surface.tilesPerMeter)||0.5,0.01,10)}:null;
 const ior=clamp(Number(m.ior)||1.5,1,2.5);
 let transmission=clamp(Number(m.transmission),0,1);
 let opacity:number|undefined=typeof m.opacity==='number'&&Number.isFinite(m.opacity)?clamp(m.opacity,0.05,1):undefined;
 const hasEmissive=Boolean(m.emissive)&&Number(m.emissiveIntensity)>0;
 const emissiveIntensity=hasEmissive?clamp(Number(m.emissiveIntensity),0,100):0;
 return {
  ...m,
  baseColor:rgba,
  metallic:clamp(Number(m.metallic),0,1),
  roughness:clamp(Number(m.roughness),0,1),
  emissive:hasEmissive?clampVec3(m.emissive,0,1):null,
  emissiveIntensity,
  transmission,
  ior,
  thickness:clamp(Number(m.thickness),0,10),
  clearcoat:clamp(Number(m.clearcoat),0,1),
  clearcoatRoughness:clamp(Number(m.clearcoatRoughness),0,1),
  ...(opacity!==undefined?{opacity}:{}),
  ...(m.attenuationColor!=null&&m.attenuationDistance!=null?{attenuationColor:m.attenuationColor,attenuationDistance:m.attenuationDistance}:{}),
  ...(surf?{surface:surf}:m.surface===null?{surface:null}:{}),
 };
}

export function mergeFamilies(raw:any,generators:HandbookGenerator[]):{families:SpecFamily[];materials:SpecMaterial[]}{
 const materials:SpecMaterial[]=(raw.materials??[]).map(sanitizeMaterial);
 const families:SpecFamily[]=(raw.families??[]).map((f:any)=>{
  const handbook=generators.find(g=>g.id===f.generatorId);
  // 手册生成器参数是 master:模型只能补充新键,已有键以表格为准。
  const params={...paramsOf(f.generatorParams),...(handbook?.params??{})};
  const covers=(f.covers??[]).map((id:string)=>({kind:'doc' as const,ref:'卷四 '+id}));
  return {id:f.id,label:f.label,description:f.description,priority:f.priority,generator:f.generatorId?{id:f.generatorId,params}:null,
   materialSlots:Object.fromEntries((f.materialSlots??[]).map((s:any)=>[s.slot,s.material])),authority:handbook?'master':f.authority,sources:[...(f.sources??[]),...covers]};
 });
 return {families,materials};
}

export function mergeObjects(raw:any,masters:HandbookObject[]):SpecObject[]{
 return (raw.objects??[]).map((o:any)=>{
  const m=masters.find(x=>x.id===o.id);
  const params=paramsOf(o.params);
  if(m?.size)params.size=m.size;
  const position=m?.position??o.position,rotationDeg=m?.rotationDeg??o.rotationDeg;
  const scale:Vec3=Array.isArray(o.scale)&&o.scale.length===3?o.scale.map((n:any)=>clamp(Number(n)||1,0.01,500)) as Vec3:[1,1,1];
  return {id:o.id,label:o.label,family:o.family,parent:o.parent??null,transform:{position,rotationDeg,rotationOrder:'XYZ',scale},params,
   authority:m?'master':o.authority,sources:m?[{kind:'doc',ref:m.source},...(o.sources??[])]:(o.sources?.length?o.sources:[{kind:'inferred',ref:'大厅空间补全'}]),confidence:m?1:clamp(Number(o.confidence)??0.8,0,1),notes:typeof o.notes==='string'?o.notes:''};
 });
}

/** 合并多路并发对象分片:按 ID 去重(master 优先于 design_fill),对非 master 越界坐标钳制进大厅包络,清理悬空或成环 parent。 */
export function mergeObjectShards(shards:{objects?:any[];excludedMasters?:{id:string;reason:string}[]}[],masters:HandbookObject[],families:SpecFamily[],bounds:{min:Vec3;max:Vec3}):{objects:SpecObject[];excludedMasters:{id:string;reason:string}[]}{
 const famIds=new Set(families.map(f=>f.id));
 const mergedRaw=shards.flatMap(s=>mergeObjects({objects:s.objects??[]},masters));
 const excludedMap=new Map<string,string>();
 for(const s of shards)for(const ex of s.excludedMasters??[])if(ex?.id&&!excludedMap.has(ex.id))excludedMap.set(ex.id,ex.reason||'分片排除');

 const byId=new Map<string,SpecObject>();
 for(const o of mergedRaw){
  if(!SPEC_ID.test(String(o.id)))continue;
  if(!famIds.has(o.family)){excludedMap.set(o.id,`引用不存在的资产族 ${o.family},已剔除`);continue;}
  const prev=byId.get(o.id);
  if(!prev||(prev.authority!=='master'&&o.authority==='master'))byId.set(o.id,o);
 }
 // 已被收录进对象的 master 从 excludedMasters 中移除,避免分片间一边收录一边排除冲突
 for(const id of byId.keys())excludedMap.delete(id);

 const objects=[...byId.values()].slice(0,SPEC_LIMITS.objects);
 const validIds=new Set(objects.map(o=>o.id));
 for(const o of objects){
  if(o.parent!==null&&(!validIds.has(o.parent)||o.parent===o.id))o.parent=null;
  o.transform.rotationDeg=clampVec3(o.transform.rotationDeg,-360,360,[0,0,0]);
  if(o.authority!=='master'&&o.parent===null){
   o.transform.position=[
    clamp(o.transform.position[0],bounds.min[0]+0.05,bounds.max[0]-0.05),
    clamp(o.transform.position[1],bounds.min[1]+0.05,bounds.max[1]-0.05),
    clamp(o.transform.position[2],bounds.min[2]+0.05,bounds.max[2]-0.05),
   ];
  }
 }
 // 断除潜在父子环
 for(const o of objects){
  let cur:SpecObject|undefined=o,steps=0;
  while(cur?.parent&&steps<=objects.length){cur=byId.get(cur.parent);steps++;}
  if(steps>objects.length)o.parent=null;
 }
 return {objects,excludedMasters:[...excludedMap.entries()].map(([id,reason])=>({id,reason}))};
}

/** 贴花清洗:保证合法 ID、唯一性、尺寸下限 ≥0.05m、透明度与粗糙度区间合法、坐标落在大厅包络内。 */
export function sanitizeDecals(rawDecals:any[]|undefined,bounds:{min:Vec3;max:Vec3}):SpecDecal[]{
 if(!Array.isArray(rawDecals)||!rawDecals.length)return [];
 const out:SpecDecal[]=[],seen=new Set<string>();
 for(let i=0;i<rawDecals.length&&out.length<SPEC_LIMITS.decals;i++){
  const d=rawDecals[i];if(!d||typeof d!=='object')continue;
  let id=String(d.id||`DEC_${String(i+1).padStart(2,'0')}`).replace(/[^a-zA-Z0-9_-]/g,'_');
  if(!/^[a-zA-Z]/.test(id))id='DEC_'+id;
  id=id.slice(0,52);
  if(seen.has(id))id=`${id}_${i+1}`;
  seen.add(id);
  const kind:['stencil','hazard','puddle'][number]=['stencil','hazard','puddle'].includes(d.kind)?d.kind:'stencil';
  const label=typeof d.label==='string'&&d.label.trim()?d.label.trim().slice(0,200):`贴花 ${id}`;
  const pos:Vec3=[
   clamp(Number(d.position?.[0])||0,bounds.min[0],bounds.max[0]),
   clamp(Number(d.position?.[1])||0,bounds.min[1],bounds.max[1]),
   clamp(Number(d.position?.[2])||0.02,bounds.min[2],bounds.max[2]),
  ];
  const rot=clampVec3(d.rotationDeg,-360,360,[0,0,0]);
  const sz:Vec3=[clamp(Number(d.size?.[0])||2,0.05,80),clamp(Number(d.size?.[1])||1,0.05,80),clamp(Number(d.size?.[2])||0.25,0.05,10)];
  const item:SpecDecal={id,label,kind,position:pos,rotationDeg:rot,size:sz};
  if(typeof d.text==='string'&&d.text.trim())item.text=d.text.trim().slice(0,64);
  else if(kind==='stencil')item.text='SECTOR 01';
  if(Array.isArray(d.color)&&d.color.length===3)item.color=clampVec3(d.color,0,1,[0.85,0.9,0.95]);
  if(typeof d.opacity==='number'&&Number.isFinite(d.opacity))item.opacity=clamp(d.opacity,0.05,1);
  if(typeof d.roughness==='number'&&Number.isFinite(d.roughness))item.roughness=clamp(d.roughness,0,1);
  out.push(item);
 }
 return out;
}

export function mergeStaging(raw:any,frozenLights?:ReturnType<typeof handbookLights>,frozenPost:Record<string,any>={}){
 // 高科科幻体积雾与后处理物理标定(对照概念图直方图 mean≈70, midtones≈62%, blown<2%):
 // 避免低阈值泛光(threshold<1.8)与过浓高反照率体积雾把浅色墙面洗成全白光斑,同时用半球天光 groundColor 消除死黑阴影。
 const VOL={extinction:0.014,albedo:[0.52,0.72,0.96] as Vec3,anisotropy:0.78,heightFalloff:0.035,noise:0.6,maxDistance:75,emission:[0,0,0] as Vec3};
 const fx=(c:any)=>({LensEffects:{vignetteIntensity:clamp(Number(c?.vignette)??0.32,0,0.48),vignetteRadius:0.56,vignetteSoftness:0.6,chromaticAberration:clamp(Number(c?.chromaticAberration)??0.18,0,0.35),grainIntensity:clamp(Number(c?.grain)??0.04,0,0.08),grainSize:1}});
 const hasFrozenLook=Boolean(frozenLights?.length||Object.keys(frozenPost).length);
 const states=(raw.states??[]).map((s:any)=>{
  const p=s.post,fog=p.fog?{...p.fog,color:clampVec3(p.fog.color,0,0.20,[0.06,0.10,0.17]),density:clamp(Number(p.fog.density)||0.0038,0.0022,0.005)}:null;
  const ambColor=clampVec3(s.ambient?.color,0,1,[0.38,0.52,0.75]);
  const ambGround=s.ambient?.groundColor?clampVec3(s.ambient.groundColor,0,1,[0.09,0.13,0.19]):(ambColor.map((c,i)=>Math.min(1,Number((c*[0.28,0.32,0.40][i]!).toFixed(4)))) as Vec3);
  let ambIntensity=clamp(Number(s.ambient?.intensity)??0.15,0,10);
  let exposure:number|'auto'=p.exposure===null?'auto':clamp(Number(p.exposure)||0.58,0.01,16);
  let bloom=p.bloom?{
   threshold:clamp(Number(p.bloom.threshold)||1.9,1.75,5),
   intensity:clamp(Number(p.bloom.intensity)||0.18,0.08,0.24),
   radius:clamp(Number(p.bloom.radius)||0.48,0.1,0.8),
  }:{threshold:1.9,intensity:0.18,radius:0.48};
  let vol=fog?(p.volumetric?{
   extinction:clamp(Number(p.volumetric.extinction)||0.014,0.009,0.018),
   albedo:clampVec3(p.volumetric.albedo,0.1,0.92,[0.52,0.72,0.96]),
   anisotropy:clamp(Number(p.volumetric.anisotropy)||0.78,-0.9,0.9),
   heightFalloff:clamp(Number(p.volumetric.heightFalloff)||0.035,0.01,0.5),
   noise:clamp(Number(p.volumetric.noise)??0.6,0,1),
   maxDistance:clamp(Number(p.volumetric.maxDistance)||75,20,80),
   emission:[0,0,0] as Vec3,
   ...(p.volumetric.lights!=null?{lights:p.volumetric.lights}:{}),
  }:VOL):null;
  // 动态范围与反差守卫:非冻结表覆盖时,控制环境光在 [0.12, 0.22] 保留戏剧明暗反差,曝光控制在 [0.50, 0.66]!
  if(!hasFrozenLook&&s.id===raw.defaultState){
   ambIntensity=clamp(ambIntensity,0.12,0.22);
   if(typeof exposure==='number')exposure=clamp(exposure,0.50,0.66);
  }
  return {
   ...s,
   ambient:{color:ambColor,groundColor:ambGround,intensity:ambIntensity},
   background:clampVec3(s.background,0,0.15,[0.025,0.04,0.07]),
   post:{...p,tonemap:'agx',exposure,bloom,fog,volumetric:vol,cameraFx:fx(p.cameraFx),gtao:true,reflectionProbe:p.reflectionProbe?{intensity:clamp(Number(p.reflectionProbe.intensity)||0.48,0.2,0.6),resolution:p.reflectionProbe.resolution}:({intensity:0.48,resolution:128} as const)},
  };
 });
 // 文档带灯光冻结表时,默认状态的灯光以表为准(owner 认可的观感,模型不得改写数值);fog 绑定的灯改成表里的方向光。
 if(frozenLights?.length){const st=states.find((x:any)=>x.id===raw.defaultState)??states[0];if(st){st.lights=frozenLights;
  const sun=frozenLights.find(l=>l.kind==='directional');if(st.post.fog&&sun)st.post.fog={...st.post.fog,light:sun.id};}}
 // 后处理冻结表:ambient/background 写到状态,其余覆盖 post(fog 只覆盖给出的字段,保留模型的包络与绑定灯)。
 if(Object.keys(frozenPost).length){const st=states.find((x:any)=>x.id===raw.defaultState)??states[0];
  if(st)for(const [k,v] of Object.entries(frozenPost)){
   if(k==='ambient')st.ambient={...st.ambient,...(v as object),groundColor:(v as any)?.groundColor??st.ambient.groundColor};
   else if(k==='background')st.background=v;
   else if(k==='fog'&&st.post.fog)st.post.fog={...st.post.fog,...v};
   else st.post[k]=v;
  }}
 const constraints=(raw.constraints??[]).map((c:any)=>({id:c.id,description:c.description,value:c.number??c.numbers??c.text??'',unit:c.unit,status:c.status,sources:c.sources?.length?c.sources:[{kind:'doc',ref:'卷二约束'}]}));
 const acceptance=(raw.acceptance??[]).map((a:any)=>{const base={id:a.id,description:a.description,critical:a.critical,kind:a.kind};
  return a.kind==='count'?{...base,family:a.family,equals:a.equals}:a.kind==='position'?{...base,object:a.object,position:a.position,tolerance:a.tolerance}:a.kind==='size'?{...base,object:a.object,size:a.size,tolerance:a.tolerance}:{...base,from:a.from,to:a.to,width:a.width,height:a.height};});
 return {lighting:{defaultState:raw.defaultState,states},shots:raw.shots??[],constraints,acceptance};
}

/**
 * Wave 2 并发后确定性对账自愈:
 * spec-staging 与 4 个对象分片在 Wave 2 同时运行,因此 planarReflections 与 acceptance 中引用的对象/资产族 ID
 * 在汇总后自动重绑定到真实生成的池水/主地面对象与有效族/对象,灯光及机位数值同步做合法性兜底,确保 validateSceneSpec 一次 0 错通过。
 */
export function reconcileStagingRefs(staging:{lighting:SceneSpec['lighting'];shots:SceneSpec['shots'];constraints:SceneSpec['constraints'];acceptance:SpecAcceptance[]},objects:SpecObject[],families:SpecFamily[],bounds:{min:Vec3;max:Vec3}){
 const objById=new Map(objects.map(o=>[o.id,o]));
 const famById=new Map(families.map(f=>[f.id,f]));
 const poolFamIds=new Set(families.filter(f=>f.generator?.id==='GEN-POOL-01').map(f=>f.id));
 const floorFamIds=new Set(families.filter(f=>f.generator?.id==='GEN-FLOOR-01'||f.generator?.id==='GEN-HALL-01').map(f=>f.id));
 const fallbackReflectObj=objects.find(o=>poolFamIds.has(o.family))
  ??objects.find(o=>/POOL|WATER/i.test(o.id))
  ??objects.find(o=>floorFamIds.has(o.family))
  ??objects.find(o=>/FLOOR|DECK|HALL/i.test(o.id))
  ??objects[0];

 for(const st of staging.lighting.states){
  // 清洗灯光合法约束与分级分簇光照预算:
  // 1) 方向光 intensity 控制在 [2.0, 3.6],避免高反照率浅灰白墙面过曝;
  // 2) 最多保留 2 盏远射程主聚光(range ≤ 38m, 最多 1 盏聚光阴影),其余局部点光/聚光射程收敛至 ≤18m,消除全屏 11 灯重叠导致的掉帧与泛白!
  let dirCount=0,spotShadows=0,heroRangeCount=0;
  const seenLights=new Set<string>();
  st.lights=(st.lights??[]).filter((l:any)=>l&&['directional','point','spot','area'].includes(l.kind)).slice(0,SPEC_LIMITS.lights).map((l:any,idx:number)=>{
   let id=SPEC_ID.test(String(l.id))?l.id:`LIGHT_${idx+1}`;
   if(seenLights.has(id))id=`${id}_${idx+1}`;
   seenLights.add(id);
   const kind=l.kind==='directional'&&dirCount++>=1?'spot':l.kind;
   const position:Vec3|null=kind==='directional'?null:clampVec3(l.position,-400,400,[0,0,12]);
   let direction:Vec3|null=(kind==='directional'||kind==='spot'||kind==='area')?clampVec3(l.direction,-1,1,[0,0,-1]):null;
   if(direction&&Math.hypot(...direction)<1e-3)direction=[0,0,-1];
   const outer=kind==='spot'?clamp(Number(l.outerConeDeg)||35,5,88):null;
   const inner=kind==='spot'?clamp(Number(l.innerConeDeg)??(outer!*0.65),0,outer!):null;
   const width=kind==='area'?clamp(Number(l.width)||2,0.05,20):null;
   const height=kind==='area'?clamp(Number(l.height)||2,0.05,20):null;
   let castShadow=Boolean(l.castShadow)&&kind!=='area';
   if(kind==='spot'&&castShadow&&++spotShadows>1)castShadow=false;
   const isHero=kind==='spot'&&heroRangeCount<2;
   if(isHero)heroRangeCount++;
   const maxLocalRange=isHero?38:18;
   const range=kind==='directional'?null:clamp(Number(l.range)||maxLocalRange,2,maxLocalRange);
   let rawIntensity=clamp(Number(l.intensity)||10,0,10000);
   if(kind==='directional'){
    rawIntensity=clamp(rawIntensity,2.0,3.6);
   }else if((kind==='point'||kind==='spot')&&range!==null&&range>=6&&rawIntensity>0&&rawIntensity<30){
    // 物理坎德拉(Candela, 1/d^2 衰减)校准:按实际收敛后的局部射程换算合理坎德拉,既有清晰局部高光又不过曝冲白
    const scale=isHero?0.36:0.38;
    rawIntensity=clamp(Math.round(rawIntensity*Math.pow(range*scale,2)),80,isHero?1800:520);
   }
   return {id,kind,position,direction,color:clampVec3(l.color,0,1,[1,1,1]),intensity:rawIntensity,range,innerConeDeg:inner,outerConeDeg:outer,width,height,castShadow};
  });
  // fog.light 必须指向当前状态内存在的灯(优先方向光)
  const lightIds=new Set(st.lights.map(l=>l.id));
  if(st.post.fog){
   if(!lightIds.has(st.post.fog.light)){
    const fallbackLight=st.lights.find(l=>l.kind==='directional')??st.lights[0];
    if(fallbackLight)st.post.fog={...st.post.fog,light:fallbackLight.id,boundsMin:st.post.fog.boundsMin??bounds.min,boundsMax:st.post.fog.boundsMax??bounds.max};
    else{st.post.fog=null;st.post.volumetric=null;}
   }
  }else st.post.volumetric=null;

  // planarReflections:若引用的对象 ID 在并行分片中改名或缺失,自动绑定到实际水池或主地面对象并对齐高度
  const prs=Array.isArray(st.post.planarReflections)?st.post.planarReflections:[];
  const reconciledPr:SceneSpec['lighting']['states'][number]['post']['planarReflections']=[];
  for(const r of prs){
   const target=objById.get(r?.object)??fallbackReflectObj;
   if(!target)continue;
   const height=objById.has(r?.object)&&Number.isFinite(r?.height)?clamp(r.height,-400,400):clamp(target.transform.position[2],-400,400);
   reconciledPr.push({object:target.id,height,distortion:clamp(Number(r?.distortion)??0.015,0,1)});
  }
  if(!reconciledPr.length&&fallbackReflectObj&&(poolFamIds.has(fallbackReflectObj.family)||floorFamIds.has(fallbackReflectObj.family))){
   reconciledPr.push({object:fallbackReflectObj.id,height:clamp(fallbackReflectObj.transform.position[2],-400,400),distortion:0.015});
  }
  st.post.planarReflections=reconciledPr.slice(0,4);
 }

 // acceptance:重绑定或过滤无效的 family / object 引用,同步 count 为实际生成数量以保证验收自洽且通过 schema 校验
 const seenAcc=new Set<string>();
 const validAcceptance:SpecAcceptance[]=[];
 for(let i=0;i<staging.acceptance.length&&validAcceptance.length<SPEC_LIMITS.acceptance;i++){
  const a:any=staging.acceptance[i];if(!a)continue;
  let id=SPEC_ID.test(String(a.id))?a.id:`ACC_${i+1}`;
  if(seenAcc.has(id))id=`${id}_${i+1}`;
  const desc=typeof a.description==='string'&&a.description.trim()?a.description.trim():`验收项 ${id}`;
  const critical=Boolean(a.critical);
  if(a.kind==='count'){
   let famId=famById.has(a.family)?a.family:families.find(f=>f.id.toLowerCase()===String(a.family||'').toLowerCase()||f.generator?.id===a.family)?.id;
   if(!famId)continue;
   const actualCount=objects.filter(o=>o.family===famId).length;
   const equals=Number.isInteger(a.equals)&&a.equals>=0?a.equals:actualCount;
   seenAcc.add(id);validAcceptance.push({id,description:desc,critical,kind:'count',family:famId,equals});
  }else if(a.kind==='position'){
   const objTarget=objById.get(a.object)??objects.find(o=>o.id.toLowerCase()===String(a.object||'').toLowerCase());
   if(!objTarget)continue;
   const pos=Array.isArray(a.position)&&a.position.length===3?clampVec3(a.position,-400,400,objTarget.transform.position):objTarget.transform.position;
   seenAcc.add(id);validAcceptance.push({id,description:desc,critical,kind:'position',object:objTarget.id,position:pos,tolerance:clamp(Number(a.tolerance)||0.5,0.05,10)});
  }else if(a.kind==='size'){
   const objTarget=objById.get(a.object)??objects.find(o=>o.id.toLowerCase()===String(a.object||'').toLowerCase());
   if(!objTarget)continue;
   const sz=Array.isArray(a.size)&&a.size.length===3?clampVec3(a.size,0.05,400,[2,2,2]):(Array.isArray(objTarget.params.size)&&objTarget.params.size.length===3?objTarget.params.size as Vec3:[2,2,2]);
   seenAcc.add(id);validAcceptance.push({id,description:desc,critical,kind:'size',object:objTarget.id,size:sz,tolerance:clamp(Number(a.tolerance)||0.5,0.05,10)});
  }else if(a.kind==='clearance'){
   const from=clampVec3(a.from,-400,400,[0,-20,0]),to=clampVec3(a.to,-400,400,[0,20,0]);
   seenAcc.add(id);validAcceptance.push({id,description:desc,critical,kind:'clearance',from,to,width:clamp(Number(a.width)||3,0.1,50),height:clamp(Number(a.height)||3,0.1,50)});
  }
 }
 staging.acceptance=validAcceptance;

 // 机位兜底:保证至少有 1 个有效机位且 target ≠ position
 const seenShots=new Set<string>();
 staging.shots=(staging.shots??[]).filter((c:any)=>c&&typeof c.label==='string'&&c.label.trim()).slice(0,SPEC_LIMITS.shots).map((c:any,idx:number)=>{
  let id=SPEC_ID.test(String(c.id))?c.id:`SHOT_${idx+1}`;
  if(seenShots.has(id))id=`${id}_${idx+1}`;
  seenShots.add(id);
  const position=clampVec3(c.position,-400,400,[0,-22,4]);
  let target=clampVec3(c.target,-400,400,[0,0,6]);
  if(Math.hypot(target[0]-position[0],target[1]-position[1],target[2]-position[2])<0.05)target=[position[0],position[1]+5,position[2]];
  return {id,label:c.label.trim().slice(0,200),position,target,fovDeg:clamp(Number(c.fovDeg)||48,20,58)};
 });
 if(!staging.shots.length)staging.shots=[{id:'SHOT_MAIN',label:'主视觉基准:入口中轴看核心',position:[0,bounds.min[1]+4,3.2],target:[0,0,7],fovDeg:58}];
}

/** 包络取大厅骨架生成器的宽/长/高(Z 向上,原点在地面中心);没有骨架时沿用旧大厅尺寸。 */
function hallBounds(families:SpecFamily[]){
 const p=families.find(f=>f.generator?.id==='GEN-HALL-01')?.generator?.params??{};
 const n=(k:string,d:number)=>typeof p[k]==='number'?p[k] as number:d,W=n('width',48),L=n('length',55),H=n('height',20);
 return {min:[-W/2,-L/2,-3] as [number,number,number],max:[W/2,L/2,H+0.5] as [number,number,number]};
}

/** 按语义把 facts.masters 预分配给 4 个并行对象分片,避免重复或遗漏。 */
function classifyMasterShard(m:HandbookObject):'core'|'arch'|'tech'|'infra'{
 const s=`${m.id} ${m.placement} ${m.interaction}`.toUpperCase();
 if(/CORE|RING|POOL|MAST|ACTUATOR|LOCK|CLAMP|WATER|核心|万向环|水池|吊架/.test(s))return 'core';
 if(/NODE|CTRL|CONTROL|GLASS|SCREEN|WORKSTATION|CONSOLE|HUD|节点|控制室|观察窗|屏幕|工作台/.test(s))return 'tech';
 if(/HALL|WALL|WALK|STAIR|DOOR|ENTRY|VESTIBULE|CRANE|TRUSS|PILLAR|COL|FLOOR|桥梁|步道|楼梯|门|入口|柱|行车/.test(s))return 'arch';
 return 'infra';
}

// ---------- 主流程 ----------
async function normalizeCaseDocument(htmlPath:string,outDir:string,effort='high',reuse?:string,nodeModels?:NodeModels,signal?:AbortSignal){
 const selections=validateNodeModels(nodeModels);
 const ignoreFrozenLook=process.env.SPEC_IGNORE_FROZEN_LOOK==='1';
 const concurrency=Math.max(1,Number(process.env.SPEC_CBC4_CONCURRENCY||6)||6);
 const html=readFileSync(htmlPath,'utf8'),doc=parseHtmlDocument(html),facts=handbookFacts(doc),fullText=documentText(doc);
 const compactArchText=compactSectionText(doc,/包络|母布局|建筑|结构|核心|控制室|约束|B1|B2|§2|§3|F1/);
 const compactStagingText=compactSectionText(doc,/光照|视觉|材质|氛围|机位|验收|约束|F1|B1|B2|§2|§4/);
 mkdirSync(join(outDir,'style'),{recursive:true});
 writeFileSync(join(outDir,'facts.json'),JSON.stringify({docSha256:doc.sha256,...facts},null,2));
 const styleRefs=doc.images.map(img=>{const path=join(outDir,'style',`style-${String(img.index+1).padStart(2,'0')}.${img.mime==='image/png'?'png':'jpg'}`);writeFileSync(path,img.bytes);return {id:`style${img.index+1}`,path,caption:img.alt};});
 // 已获方向认可的主视觉基准与高位观察(最多 2 张核心参考图,控制 base64 载荷并保持并发吞吐)随材质与布光节点附上。
 const keyImages=styleRefs.filter(r=>/主视觉基准|高位观察/.test(r.caption)).slice(0,2).map(r=>({path:r.path,mime:r.path.endsWith('.png')?'image/png':'image/jpeg'}));
 const calls=join(outDir,'calls');
 // cbc4 在 medium 下依然启用 thinking_delta 思维链,同时避免单分片长篇英文独白拖慢并发吞吐(SPEC_CBC4_RAW_EFFORT=1 保持原值)。
 const shardNode=(n:NodeModel):NodeModel=>n;

 // ==================== Wave 1: 3 路 cbc4 并发(全量材质 + 主结构核心族 + 管线道具排除族) ====================
 const slotCatalog=Object.fromEntries(Object.values(GENERATORS).map((g:any)=>[g.id,{label:g.label,slots:g.slots,params:Object.keys(g.params)}]));
 const CANONICAL_MAT_ROLES=`标准材质角色 ID 清单(spec-materials 必须完整定义以下全部 ID,各资产族分片可直接引用):
- MAT_AERO_WHITE: 深冷枪铁磨损结构板(厚重湿冷工业基调,严禁苍白! baseColor [0.22,0.25,0.30,1], metallic 0.62, roughness 0.34, clearcoat 0.25, surface:{pattern:'worn',tilesPerMeter:0.6})
- MAT_SILVER_TRIM: 拉丝机械修边亮钢(baseColor [0.46,0.50,0.56,1], metallic 0.82, roughness 0.24, surface:{pattern:'trim',tilesPerMeter:0.5})
- MAT_TITANIUM_BRUSH: 锻造钛合金重型骨架(baseColor [0.30,0.34,0.40,1], metallic 0.76, roughness 0.28, surface:{pattern:'trim',tilesPerMeter:0.5})
- MAT_DARK_ARMOR: 核心六边形黑曜石镜面装甲瓦(深邃黑金属与发光缝强反差! baseColor [0.04,0.048,0.065,1], metallic 0.88, roughness 0.16, clearcoat 0.8, clearcoatRoughness 0.08)
- MAT_WET_DECK: 湿润镜面深色钢甲板地面(强倒影层次! baseColor [0.055,0.07,0.09,1], metallic 0.58, roughness 0.07, clearcoat 0.92, clearcoatRoughness 0.04, surface:{pattern:'deck',tilesPerMeter:0.5})
- MAT_CORE_CYAN: 核心细缝与导光轨冰青电弧光(baseColor [0.25,0.85,1,1], emissive:[0.16,0.80,1.0], emissiveIntensity:3.8)
- MAT_NODE_CYAN: 通高双舱能量巨柱高纯冰青光芯(baseColor [0.35,0.90,1,1], emissive:[0.20,0.85,1.0], emissiveIntensity:4.2)
- MAT_AMBER_GLOW: 回廊/墙面机组暖琥珀状态灯(冷暖对比核心点缀! baseColor [1,0.62,0.20,1], emissive:[1.0,0.55,0.14], emissiveIntensity:3.6)
- MAT_PORTAL_BACKLIGHT: 远端工业大门强逆光冷白青灯幕(baseColor [0.80,0.95,1,1], emissive:[0.68,0.90,1.0], emissiveIntensity:4.2)
- MAT_SKYLIGHT_GLOW: 顶部天窗冷蓝白漫射天光面(baseColor [0.65,0.84,1,1], emissive:[0.48,0.72,1.0], emissiveIntensity:2.6)
- MAT_POOL_WATER: 中央水池深邃镜面水体(baseColor [0.03,0.08,0.13,1], metallic:0.05, roughness:0.02, transmission:0.85, ior:1.333)
- MAT_CLEAR_GLASS: 控制室与能量柱清透观察玻璃(baseColor [0.68,0.86,0.98,1], metallic:0.0, roughness:0.05, transmission:0.92, ior:1.5)
- MAT_HOLO_UI: 工作站悬浮全息青蓝光环(baseColor [0.22,0.86,1,1], emissive:[0.18,0.82,1.0], emissiveIntensity:2.8)
- MAT_SCREEN_HUD: 控制室内多联监控屏与遥测大屏亮蓝界面(baseColor [0.12,0.46,0.78,1], emissive:[0.16,0.62,0.98], emissiveIntensity:2.6)
- MAT_COPPER_CONDUIT: 高压导能黄铜/紫铜弯管(baseColor [0.68,0.46,0.28,1], metallic:0.88, roughness:0.24, surface:{pattern:'worn',tilesPerMeter:0.8})
- MAT_DARK_CABLE: 重型橡胶护套线缆与密封垫(baseColor [0.06,0.07,0.085,1], metallic:0.15, roughness:0.58)`;

 const structLeaves=facts.leaves.filter(l=>/^(COR|ENV|NDE|CTL|STR|ARC|HAL|DOR|WLK)-/i.test(l.id));
 const propLeaves=facts.leaves.filter(l=>!structLeaves.includes(l));
 const halfIdx=Math.ceil(facts.leaves.length/2);
 const leavesA=structLeaves.length>=4&&propLeaves.length>=4?structLeaves:facts.leaves.slice(0,halfIdx);
 const leavesB=structLeaves.length>=4&&propLeaves.length>=4?propLeaves:facts.leaves.slice(halfIdx);

 const wave1Tasks=[
  ()=>ask(calls,'spec-materials',`任务 Wave 1.1(全量湿冷重工业 PBR + Worn/Trim/Deck 材质表 spec-materials,17..24 种材质):
依据主视觉概念图与手册 F1 材质表,完整定义上面列出的 16 个标准材质角色 ID(可额外补充 2–5 个专用材质),严格遵守【重工业湿冷科幻高反差铁律】:墙体结构用深冷枪铁磨损钢(baseColor 0.20..0.30, 高金属度 + worn/trim 纹样,严禁苍白医院感!),核心瓦用黑曜石镜面装甲(0.04..0.06),主地面用深色湿润镜面甲板(0.05..0.09, roughness≤0.08 配 deck 纹样),冰青核心/能量柱与暖琥珀回廊灯冷暖对比强烈! 思维链≤300字。\n${CANONICAL_MAT_ROLES}`,
   {generators:facts.generators},compactStagingText,MATERIALS_ONLY_SCHEMA,keyImages,effort,reuse,shardNode(selections.families),signal),

  ()=>ask(calls,'spec-families-struct',`任务 Wave 1.2(核心、建筑骨架、多层设备墙与控制能量资产族分片 spec-families-struct,族上限 20):
可用生成器目录(generatorId 只能从这里选,materialSlots 的 slot 必须原样使用这里列出的英文槽名,material 引用下列标准材质 ID):${JSON.stringify(slotCatalog)}
${CANONICAL_MAT_ROLES}
请将本分片负责的叶资产列表归并为高细节程序化资产族(纯玩法/破坏态放入 excludedLeaves),思维链≤400字:
- 必须包含:
  1) GEN-CORE-01(黑曜石六角装甲核心球,params 设 panelFrequency:4,seamWidth:0.06,panelRaise:0.14,coreScale:0.94,innerLattice:true,field:false);
  2) GEN-RING-01(三道同心螺栓倾斜万向环,rivetSpacing:0.9,armor:true);
  3) GEN-RINGMOUNT-01、GEN-POOL-01(中央反射水池)、GEN-MECH-ACTUATOR-01(周圈液压锁紧作动器);
  4) GEN-HALL-01(大厅主体骨架)、GEN-FLOOR-01(深色湿润镜面主地面)、GEN-WALLKIT-01(三层贴墙重型管束设备立面,params 设 width:14,height:17,tiers:3,style:0,pipeBundles:4,boxes:6,lamps:4 — 关键机械包裹密度来源!);
  5) GEN-WALK-01(length:36)、GEN-STAIR-01、GEN-CRANERAIL-01、GEN-ENTRY-01、GEN-INDUSTRIALDOOR-01(远端强逆光工业门);
  6) GEN-NODEBEAM-02(四座通高双胶囊玻璃能量巨柱,params 设 height:16.5,radius:1.55,tubes:6!)、GEN-CONTROLROOM-01、GEN-GLASS-01、GEN-WORKSTATION-01(弧形全息多屏工作站)、GEN-SCREENWALL-01(遥测大屏墙)。`,
   {leaves:leavesA,generators:facts.generators,assemblies:facts.assemblies},compactArchText,FAMILIES_SHARD_SCHEMA,[],effort,reuse,shardNode(selections.families),signal),

  ()=>ask(calls,'spec-families-props',`任务 Wave 1.3(管网机电、道具比例尺与排除叶资产分片 spec-families-props,族上限 16):
可用生成器目录(generatorId 只能从这里选,materialSlots 的 slot 必须原样使用这里列出的英文槽名,material 引用下列标准材质 ID):${JSON.stringify(slotCatalog)}
${CANONICAL_MAT_ROLES}
请将本分片负责的叶资产列表归并为机电管网/道具资产族,并将纯玩法、武器、角色、敌人、特效、破坏态叶资产全部列入 excludedLeaves 说明原因(确保本分片 leaves 100% 有去向),思维链≤350字:
- 必须包含:GEN-PIPE-01(供能管网)、GEN-CABLETRAY-01 / GEN-CABLE-01(桥架线束)、GEN-EQUIPGROUP-01(柱脚与入口成组设备箱柜)、GEN-LUMINAIRE-01(步道暖琥珀导引灯具)、GEN-FIGURE-01(1.75m 比例尺工程师人物)、GEN-CABINET-01 / GEN-PROP-01。`,
   {leaves:leavesB,generators:facts.generators,assemblies:facts.assemblies},compactArchText,FAMILIES_SHARD_SCHEMA,[],effort,reuse,shardNode(selections.families),signal),
 ];

 const [matShard,famStructShard,famPropsShard]=await mapConcurrent(wave1Tasks,concurrency,fn=>fn());
 const seenFamIds=new Set<string>();
 const mergedFamItems=[...(famStructShard?.families??[]),...(famPropsShard?.families??[])].filter((f:any)=>{
  if(!f?.id||!SPEC_ID.test(String(f.id))||seenFamIds.has(f.id))return false;
  seenFamIds.add(f.id);return true;
 }).slice(0,SPEC_LIMITS.families);
 const seenMatIds=new Set<string>();
 const mergedMatItems=(matShard?.materials??[]).filter((m:any)=>{
  if(!m?.id||!SPEC_ID.test(String(m.id))||seenMatIds.has(m.id))return false;
  seenMatIds.add(m.id);return true;
 }).slice(0,SPEC_LIMITS.materials);
 const famRaw={
  materials:mergedMatItems,
  families:mergedFamItems,
  excludedLeaves:[...(famStructShard?.excludedLeaves??[]),...(famPropsShard?.excludedLeaves??[])],
 };

 const {families,materials}=mergeFamilies(famRaw,facts.generators);
 const frozenSlots=handbookSlots(doc);
 // 仅在未设置 SPEC_IGNORE_FROZEN_LOOK=1 时应用手册冻结材质与材质槽覆盖
 if(!ignoreFrozenLook){
  for(const fm of handbookMaterials(doc)){const i=materials.findIndex(m=>m.id===fm.id);if(i>=0)materials[i]=fm as any;else materials.push(fm as any);}
  for(const f of families){const fs=f.generator&&frozenSlots[f.generator.id];if(fs)f.materialSlots={...f.materialSlots,...fs};}
 }
 // 冻结生成器兜底:在 Wave 2 开始前先补齐手册冻结表里尚未被归入资产族的生成器,让所有对象分片与 staging 都能直接引用!
 const defaultMatId=materials[0]?.id??'MAT_DEFAULT';
 if(!materials.length)materials.push({id:defaultMatId,label:'航天银灰默认涂装',baseColor:[0.68,0.72,0.78,1],metallic:0.25,roughness:0.32,emissive:null,emissiveIntensity:0,transmission:0,ior:1.5,thickness:0,clearcoat:0.35,clearcoatRoughness:0.2,surface:{pattern:'trim',tilesPerMeter:0.5},sources:[{kind:'inferred',ref:'默认高科材质'}]});
 for(const g of facts.generators){
  if(!GENERATORS[g.id]||families.some(f=>f.generator?.id===g.id))continue;
  const fs=!ignoreFrozenLook?frozenSlots[g.id]:undefined;
  const genDef:any=GENERATORS[g.id];
  const fallbackSlots=fs??Object.fromEntries((genDef.slots as string[]).map(s=>[s,defaultMatId]));
  if(!Object.keys(fallbackSlots).length)continue;
  families.push({id:'FAM-'+g.id.replace(/^GEN-/,'').replace(/-\d+$/,''),label:g.output||g.id,description:'由冻结表补入:'+g.output,priority:'P1',generator:{id:g.id,params:{...g.params}},materialSlots:{...fallbackSlots},authority:'master',sources:[{kind:'doc',ref:g.source||'§3 生成器参数表'}]});
 }
 // 生成器对账与槽名合法化(保证所有材质引用均存在于 materials)
 const matIdSet=new Set(materials.map(m=>m.id));
 for(const f of families)if(f.generator&&!GENERATORS[f.generator.id]){f.description+=`(模型提出的 ${f.generator.id} 不存在,待实现)`;f.generator=null;}
 for(const f of families){
  const g:any=f.generator&&GENERATORS[f.generator.id];
  const sanitizeMat=(m:string)=>matIdSet.has(m)?m:defaultMatId;
  if(!g){const first=Object.values(f.materialSlots)[0];f.materialSlots={proxy:sanitizeMat(first||defaultMatId)};continue;}
  const known=Object.fromEntries(Object.entries(f.materialSlots).filter(([k])=>g.slots.includes(k)).map(([k,v])=>[k,sanitizeMat(v)]));
  const extra=Object.entries(f.materialSlots).filter(([k])=>!g.slots.includes(k)).map(([,v])=>sanitizeMat(v)),free=g.slots.filter((k:string)=>!(k in known));
  free.forEach((k:string,i:number)=>{known[k]=extra[i]??defaultMatId;});
  if(!Object.keys(known).length)known[g.slots[0]??'shell']=defaultMatId;
  f.materialSlots=known;
 }

 // ==================== Wave 2: 5 路 cbc4 最大并发执行 ====================
 const bounds=hallBounds(families);
 const familyBrief=families.map(f=>({id:f.id,label:f.label,generator:f.generator?.id,params:f.generator?.params,covers:f.sources.filter(s=>s.ref.startsWith('卷四')).map(s=>s.ref)}));
 const mastersByShard={core:[] as HandbookObject[],arch:[] as HandbookObject[],tech:[] as HandbookObject[],infra:[] as HandbookObject[]};
 for(const m of facts.masters)mastersByShard[classifyMasterShard(m)].push(m);
 const shardCommonRule=`公共硬性约束:
- family 只能从以下已定资产族 id 中选取,严禁自造族名:${JSON.stringify(familyBrief)}
- 大厅包络 bounds=${JSON.stringify(bounds)}(右手系、米、Z 向上,地面 Z=0)。所有根对象(parent=null)坐标必须严格在 bounds 内,rotationDeg 在 [-360,360],scale 为正(默认 [1,1,1])。
- 本分片负责的 master 对象必须原样保留 id、position、rotationDeg(纯玩法触发器/出生点除外,写入 excludedMasters 并写明原因);额外补全的对象标 authority="design_fill",ID 使用清晰不冲突的前缀!`;

 const wave2Tasks=[
  ()=>ask(calls,'spec-objects-core',`任务 Wave 2.1(核心机械分片 spec-objects-core,对象上限 90):
负责【中央反应堆核心、同心倾斜万向环、顶部悬挂立柱/环架、中央冷却水池、以及水池/核心周圈液压锁紧作动器(GEN-MECH-ACTUATOR-01)】!
本分片负责的 master 列表:${JSON.stringify(mastersByShard.core)}。
补全要求:除精确落位所有归属本分片的 master 对象(如 CORE_001、倾斜万向环、中央水池、悬挂塔架等)外,围绕中央水池边缘对称布置 6–8 台朝向核心中心的液压锁紧作动器(若存在 GEN-MECH-ACTUATOR-01 对应族)与环架支撑件(ID 前缀用 CORE_ / RING_ / POOL_ / ACTUATOR_),严禁遮挡外围主环路。\n${shardCommonRule}`,
   {masters:mastersByShard.core,generators:facts.generators},compactArchText,OBJECTS_SHARD_SCHEMA,[],effort,reuse,shardNode(selections.objects),signal),

  ()=>ask(calls,'spec-objects-arch',`任务 Wave 2.2(建筑壳体、贴墙多层设备机组与立体交通分片 spec-objects-arch,总对象数严格控制在 16..24 个以内!):
负责【大厅主体建筑外壳、湿润镜面主地面、贴墙多层工业设备立面(GEN-WALLKIT-01)、二层环形步道、连接楼梯、顶部行车轨道、入口门斗、以及远端强逆光工业大门】。
本分片负责的 master 列表:${JSON.stringify(mastersByShard.arch)}。
极其重要的精简与密度规则:
1) GEN-HALL-01 已是整组生成器(内部自带全部外墙板、工字柱阵、檐梁、屋顶桁架与中脊天窗),只输出 **1 个** HALL_001([0,0,0]);主地面只输出 **1 个** FLOOR_001([0,0,0])。
2) 机械包裹密度关键:沿东西两侧长墙(x=-23.4 与 x=23.4, y 取 -16、0、16)及北端墙两侧(x=±14, y=26.8)布置 **6–8 段** GEN-WALLKIT-01 多层设备立面(ID 用 WALLKIT_01..08, z=0),把空白墙面变成层层叠叠的管束与设备廊!
3) 其余输出:4 段二层外围步道(东西 x=±17.5, 南北 y=±21, z=5, GEN-WALK-01)、2 座连接楼梯(GEN-STAIR-01)、2 条顶部行车轨(z=16.5, GEN-CRANERAIL-01)、1 个近端入口门斗(GEN-ENTRY-01)与 1 扇远端背光工业大门([0,27,0], GEN-INDUSTRIALDOOR-01)。思维链不超过 300 字!\n${shardCommonRule}`,
   {masters:mastersByShard.arch,generators:facts.generators},compactArchText,OBJECTS_SHARD_SCHEMA,[],effort,reuse,shardNode(selections.objects),signal),

  ()=>ask(calls,'spec-objects-tech',`任务 Wave 2.3(能量柱与控制室高科分片 spec-objects-tech,对象上限 140):
负责【四座英雄双胶囊能量柱(优先绑定 GEN-NODEBEAM-02 族)、左右两侧通透玻璃控制室(GEN-CONTROLROOM-01 + GEN-GLASS-01)、控制室内外与平台弧形全息多联屏工作站(GEN-WORKSTATION-01)、以及大型遥测 HUD 屏幕墙(GEN-SCREENWALL-01)】!
本分片负责的 master 列表:${JSON.stringify(mastersByShard.tech)}。
补全要求:四座主节点(NODE_01..04 等)优先使用 GEN-NODEBEAM-02 对应族展现冰青发光胶囊;左右控制室配通透观察窗并在室内及观景平台布置 6–12 台全息多屏工作站与遥测大屏墙(ID 前缀用 NODE_ / CTRL_ / GLASS_ / WS_ / SCREEN_)。\n${shardCommonRule}`,
   {masters:mastersByShard.tech,generators:facts.generators},compactArchText,OBJECTS_SHARD_SCHEMA,[],effort,reuse,shardNode(selections.objects),signal),

  ()=>ask(calls,'spec-objects-infra',`任务 Wave 2.4(管线机电、比例尺与地面/墙面贴花分片 spec-objects-infra,对象上限 160 + decals 6..12):
负责【节点至核心供能主管线(GEN-PIPE-01)、电缆桥架(GEN-CABLETRAY-01)、成组机电设备柜(GEN-EQUIPGROUP-01 / GEN-CABINET-01)、步道导引灯具(GEN-LUMINAIRE-01)、比例尺人物(GEN-FIGURE-01)】以及【6–12 个 ProjectedDecal 贴花(decals)】!
本分片负责的 master 列表(含纯玩法触发器/出生点请列入 excludedMasters 并说明原因):${JSON.stringify(mastersByShard.infra)}。
补全要求:
1) 对象(ID 前缀用 PIPE_ / TRAY_ / EQUIP_ / LUM_ / FIG_ / PROP_):连接四角能量节点与中央水池/核心的能量管网、沿步道铺设的电缆桥架与琥珀导引灯具、角落设备组、以及 2–4 个关键视点比例尺人物(不挡主通道)。
2) decals(6–12 项):包含 stencil 分区喷字(text 写清晰英文工业编号如 'CORE BAY 01'、'SECTOR A14'、'CTRL WEST'、'PORTAL N02',color 用高对比冷白或琥珀)、水池边缘与工业大门前的 hazard 警戒斜纹条、以及主甲板上的 puddle 镜面薄积水斑块(size 各分量 ≥0.1m,地面贴花 position.z 设在 0.02..0.05,size.z 设在 0.2..0.4)。\n${shardCommonRule}`,
   {masters:mastersByShard.infra,generators:facts.generators},compactArchText,INFRA_DECALS_SCHEMA,[],effort,reuse,shardNode(selections.objects),signal),

  ()=>ask(calls,'spec-staging',`任务 Wave 2.5(高反差湿冷科幻布光、电影焦段机位、约束与验收 spec-staging — 与对象分片并行运行):
已知大厅包络 bounds=${JSON.stringify(bounds)},确定性 master 对象清单(含精确 ID 与坐标):${JSON.stringify(facts.masters)},已定资产族:${JSON.stringify(familyBrief)}。思维链≤350字!
(a) 按卷二 F1 与【重工业湿冷科幻高反差铁律】编写四种光照状态 L0 稳定故障、L1 节点关闭、L2 失重、L3 泄能,defaultState="L0":
    - L0 必须呈现主视觉概念图的强烈明暗因果、朦胧体积雾空气感与湿润金属倒影:ambient={color:[0.38,0.52,0.75],groundColor:[0.09,0.13,0.19],intensity:0.15},background=[0.025,0.04,0.07],post.tonemap="agx",post.exposure=0.58,bloom={threshold:1.9,intensity:0.18,radius:0.48},fog={color:[0.06,0.10,0.17],density:0.0038,anisotropy:0.65,boundsMin:bounds.min,boundsMax:bounds.max,light:"DIR_OCULUS_01"},volumetric={extinction:0.014,albedo:[0.52,0.72,0.96],anisotropy:0.78,heightFalloff:0.035,noise:0.6,maxDistance:75,emission:[0,0,0]}。
    - 因果真光源(总灯数 8..10 盏,物理坎德拉单位):1 盏顶部天窗斜射 DirectionalLight(id:"DIR_OCULUS_01", intensity:3.2, castShadow:true) + 1 盏顶部照向核心与水池的主投影聚光 SpotLight(intensity:1600, range:34, castShadow:true) + 1 盏远端工业门强逆光聚光 SpotLight(position:[0,26,4], direction:[0,-1,-0.1], color:[0.75,0.92,1.0], intensity:1400, range:34, castShadow:false) + 4 盏四角通高能量巨柱冰青色 PointLight(color:[0.18,0.82,1.0], intensity:420, range:16) + 2 盏东西二层控制室/步道暖琥珀 PointLight(color:[1.0,0.58,0.18], intensity:360, range:16)!
    - planarReflections:引用中央水池对象 ID(如 POOL_001),height=-0.35,distortion=0.02。
(b) 机位(shots,5–6 个,全部使用 **38°..52° 电影焦段**,严禁 >56° 广角!):
    1) 主视觉构图(position:[0,-22.5,2.4], target:[0,2,7.2], fovDeg:48 — 前景带池沿与两侧能量巨柱框景,中轴仰视黑曜石核心球、万向环、天窗光柱与远端逆光门);
    2) 左侧观察构图(position:[-15,-19,4.2], target:[2,2,6.8], fovDeg:46 — 从西侧回廊/控制室前斜看核心、东侧玻璃控制室与双排能量柱);
    3) 右侧观察构图(position:[15,-19,4.2], target:[-2,2,6.8], fovDeg:46 — 从东侧斜看核心、西侧玻璃控制室与水面倒影);
    4) 核心与万向环长焦近景(position:[0,-14.5,3.2], target:[0,0,7.0], fovDeg:38 — 50mm 长焦压缩感,贴近水面仰拍黑曜石六角装甲核心、冰青细缝与三道铆接万向环);
    5) 二层控制室走廊俯瞰(position:[-16.5,6,6.2], target:[0,-2,5.8], fovDeg:50 — 二层高处俯瞰水池镜面倒影、池周液压锁紧阵列与全场管网);
    6) 高位观察总览(position:[16,18,14.5], target:[0,-2,5.5], fovDeg:50 — 高位对角线回看整个核心竖井、多层设备墙与立体回廊)。
(c) 约束(constraints):卷二 B1、卷三 §2/§4 数值约束,标 P 或 frozen。
(d) 验收(acceptance):可程序检查的条目(仅引用 facts.masters 中确定存在的对象 ID 如 CORE_001、NODE_01..04 及上述资产族 ID)——核心位置与直径、四节点计数与位置、主通路净宽与撤离净空 clearance 等;critical 只用于通关因果必需项。`,
   facts,compactStagingText,STAGING_SCHEMA,keyImages,effort,reuse,shardNode(selections.staging),signal),
 ];

 const [coreRaw,archRaw,techRaw,infraRaw,stageRaw]=await mapConcurrent(wave2Tasks,concurrency,fn=>fn());

 // ==================== 确定性汇总、Master 兜底与跨分片引用自愈 ====================
 const {objects,excludedMasters}=mergeObjectShards([coreRaw,archRaw,techRaw,infraRaw],facts.masters,families,bounds);
 // master 对象兜底:分片漏掉的带坐标 master,若"交互与限制"或 §3 输出栏能匹配生成器,按 facts 自动补入对应资产族
 const excludedMasterIds=new Set(excludedMasters.map(x=>x.id));
 for(const m of facts.masters){
  if(objects.some(o=>o.id===m.id)||excludedMasterIds.has(m.id)||!m.position)continue;
  const gen=(m.interaction.match(/GEN-[A-Z0-9-]+/)??[])[0]??facts.generators.find(g=>(g.output+g.limits).includes(m.id))?.id;
  const fam=families.find(f=>f.generator?.id===gen)??(gen==='GEN-NODE-01'?families.find(f=>f.generator?.id==='GEN-NODEBEAM-02'):undefined);
  if(!fam)continue;
  objects.push({id:m.id,label:m.placement||m.id,family:fam.id,parent:null,transform:{position:m.position,rotationDeg:m.rotationDeg??[0,0,0],rotationOrder:'XYZ',scale:[1,1,1]},params:m.size?{size:m.size}:{},authority:'master',sources:[{kind:'doc',ref:m.source}],confidence:1,notes:'冻结表兜底补入'});
 }

 const decals=sanitizeDecals(infraRaw?.decals,bounds);
 // 核心球与湿润地面材质后置光学修正(置于 Wave 2 之后,不影响任何 cbc4 缓存哈希):
 // 1) GEN-CORE-01 六角装甲模式下关闭不透明发光外罩(field=false),让黑色六角装甲瓦、内嵌冰青发光缝与万向环完整露出;
 // 2) GEN-FLOOR-01 主地面统一使用深色湿润镜面甲板材质(roughness≤0.12),与浅银白航天墙面形成鲜明科幻层次与倒影!
 if(!ignoreFrozenLook){
  const wetDeckMat=materials.find(m=>m.surface?.pattern==='deck'&&m.roughness<=0.15)??materials.find(m=>/WET_DECK/i.test(m.id));
  if(wetDeckMat&&wetDeckMat.baseColor[0]>0.22){
   wetDeckMat.baseColor=[0.12,0.14,0.17,1];
   wetDeckMat.metallic=Math.max(0.45,wetDeckMat.metallic);
   wetDeckMat.roughness=Math.min(0.09,wetDeckMat.roughness);
  }
  const trimMetalMat=materials.find(m=>/SILVER_TRIM|TITANIUM/i.test(m.id))??materials.find(m=>m.surface?.pattern==='trim');
  const cyanGlowMat=materials.find(m=>/CORE_CYAN/i.test(m.id)&&m.emissiveIntensity>0);
  const coreFamIds=new Set<string>();
  const nodeBeamFamIds=new Set<string>();
  for(const f of families){
   if(f.generator?.id==='GEN-CORE-01'&&Number(f.generator.params.panelFrequency??5)>0){
    coreFamIds.add(f.id);
    const cfMat=materials.find(m=>m.id===f.materialSlots.constraintField);
    if(!cfMat||(cfMat.opacity??1)>0.2||cfMat.emissiveIntensity>0.5)f.generator.params.field=false;
    if(typeof f.generator.params.seamWidth==='number'&&f.generator.params.seamWidth>0.09)f.generator.params.seamWidth=0.065;
    if(trimMetalMat){f.materialSlots.serviceBand=trimMetalMat.id;f.materialSlots.vertexStud=trimMetalMat.id;}
    if(cyanGlowMat)f.materialSlots.serviceBandGlow=cyanGlowMat.id;
   }
   if(f.generator?.id==='GEN-NODEBEAM-02'){
    nodeBeamFamIds.add(f.id);
    // 尺寸由规格提供，模板不得改写。
   }
   if(f.generator?.id==='GEN-FLOOR-01'&&wetDeckMat){
    f.materialSlots.metalPanel=wetDeckMat.id;
    f.materialSlots.wetOverlay=wetDeckMat.id;
   }
  }
  for(const o of objects){
   if(coreFamIds.has(o.family)){
    o.params.field=false;
    if(typeof o.params.seamWidth==='number'&&o.params.seamWidth>0.09)o.params.seamWidth=0.065;
    if(typeof o.params.panelFrequency==='number'&&o.params.panelFrequency<4)o.params.panelFrequency=4;
   }

  }
 }
 const frozenLights=ignoreFrozenLook?undefined:handbookLights(doc);
 const frozenPost=ignoreFrozenLook?{}:handbookPost(doc);
 const staging=mergeStaging(stageRaw,frozenLights,frozenPost);
 // 机位冻结表(有表且未忽略冻结观感时):机位以表为准
 if(!ignoreFrozenLook){const frozenShots=handbookShots(doc);if(frozenShots.length)staging.shots=frozenShots;}
 reconcileStagingRefs(staging,objects,families,bounds);

 const spec:SceneSpec={version:SCENE_SPEC_VERSION,id:'critical-zerog-hall',name:doc.title,units:'m',up:'+Z',bounds,
  sources:[{id:'handbook',title:doc.title,kind:'doc',path:resolve(htmlPath)}],families,objects,materials,
  ...(decals.length?{decals}:{}),
  ...staging,
  styleRefs:styleRefs.map(r=>({...r,path:r.path})),
  provenance:{createdAt:new Date().toISOString(),method:'normalize-doc-v2(确定性表格 + Wave1 族材质 + Wave2 五路并发分片)',model:new Set([selections.families.model,selections.objects.model,selections.staging.model]).size===1?selections.families.model:'per-node'}};
 const report=reconcileSpec(spec,facts,{excludedMasters,excludedLeaves:famRaw.excludedLeaves});
 writeFileSync(join(outDir,'spec.json'),JSON.stringify(spec,null,2));
 writeFileSync(join(outDir,'reconcile.json'),JSON.stringify(report,null,2));
 validateSceneSpec(spec);
 return {spec,report};
}

export const NORMALIZATION_TEMPLATES=['general','critical-zerog-hall'] as const;
export function normalizationTemplate(value:unknown){if(value==null||value==='')return 'general' as const;if(!NORMALIZATION_TEMPLATES.includes(value as any))throw Error('未知规格模板');return value as typeof NORMALIZATION_TEMPLATES[number];}
const GENERAL_SYSTEM=`你是场景规格整理器。只根据用户文档与确定性 facts 建立可运行的场景规格。冻结表格的 ID、尺寸、位置与旋转原样保留。缺乏依据的项标 design_fill 并记录来源，不加入特定题材、材料、建筑、灯光或道具。每个生成器的参数须符合给出的完整参数契约。模型没有实现用户明确要求时，明确列出排除原因，不伪造已覆盖。图像只作视觉参考；不能看到图时明确说明。输出结构化 JSON。`;
export async function normalizeDocument(htmlPath:string,outDir:string,effort='high',reuse?:string,nodeModels?:NodeModels,signal?:AbortSignal,template:unknown='general'){
 const selected=normalizationTemplate(template);
 if(selected==='critical-zerog-hall'){
  const result=await normalizeCaseDocument(htmlPath,outDir,effort,reuse,nodeModels,signal);
  result.spec.provenance.method+=';template=critical-zerog-hall';return result;
 }
 const selections=validateNodeModels(nodeModels),doc=parseHtmlDocument(readFileSync(htmlPath,'utf8')),text=documentText(doc),calls=join(outDir,'calls');
 const has=(header:readonly string[])=>doc.tables.some(t=>t.header.length===header.length&&t.header.every((h,i)=>h===header[i]));
 const facts:HandbookFacts={masters:has(HANDBOOK_TABLES.objects)?handbookObjects(doc):[],generators:has(HANDBOOK_TABLES.generators)?handbookGenerators(doc):[],leaves:handbookLeaves(doc),assemblies:has(HANDBOOK_TABLES.assemblies)?findTable(doc,[...HANDBOOK_TABLES.assemblies]).rows:[]};
 mkdirSync(join(outDir,'style'),{recursive:true});
 const styleRefs=doc.images.map(im=>{const path=join(outDir,'style',`style-${im.index+1}.${im.mime==='image/png'?'png':'jpg'}`);writeFileSync(path,im.bytes);return {id:`style${im.index+1}`,path,caption:im.alt};});
 writeFileSync(join(outDir,'facts.json'),JSON.stringify({docSha256:doc.sha256,...facts},null,2));
 const catalog=Object.fromEntries(Object.values(GENERATORS).map(g=>[g.id,{label:g.label,params:g.params,slots:g.slots}]));
 const famRaw=await ask(calls,'spec-general-families','按文档归类资产族和材质。不改变题材或风格。只能从给定生成器选 ID，未知资产用 generatorId=null 留灰模。每项叶资产说明覆盖或排除原因。',{...facts,catalog},text,FAMILIES_SCHEMA,[],effort,reuse,selections.families,signal,GENERAL_SYSTEM);
 const {families,materials}=mergeFamilies(famRaw,facts.generators);
 const boundsSchema=obj({min:vec3,max:vec3});
 const oschema=obj({...OBJECTS_SCHEMA.properties,bounds:boundsSchema});
 const objectRaw=await ask(calls,'spec-general-objects','依据文档和 master 对象建立对象表与完整 bounds。尺寸用米，Z向上；保留全部明确的坐标、尺寸、倾角。参数名称与类型严格匹配生成器契约。没有尺寸和路径时标明推断来源，不擅自换为其他场景。',{masters:facts.masters,families,catalog},text,oschema,[],effort,reuse,selections.objects,signal,GENERAL_SYSTEM);
 const objects=mergeObjects(objectRaw,facts.masters),bounds=objectRaw.bounds;
 const stageRaw=await ask(calls,'spec-general-staging','依据文档生成灯光状态、机位、约束和验收项；不要固定科幻光色、曝光或特定位置。没有光照要求时使用普通中性照明并标来源。所有引用必须来自当前对象表。',{families,objects,bounds},text,STAGING_SCHEMA,[],effort,reuse,selections.staging,signal,GENERAL_SYSTEM);
 const constraints=(stageRaw.constraints??[]).map((c:any)=>({id:c.id,description:c.description,value:c.number??c.numbers??c.text??'',unit:c.unit,status:c.status,sources:c.sources}));
 const acceptance=(stageRaw.acceptance??[]).map((a:any)=>{const base={id:a.id,description:a.description,critical:a.critical,kind:a.kind};return a.kind==='count'?{...base,family:a.family,equals:a.equals}:a.kind==='position'?{...base,object:a.object,position:a.position,tolerance:a.tolerance}:a.kind==='size'?{...base,object:a.object,size:a.size,tolerance:a.tolerance}:{...base,from:a.from,to:a.to,width:a.width,height:a.height};});
 const lights=handbookLights(doc),post=handbookPost(doc),shots=handbookShots(doc);
 const states=stageRaw.states.map((st:any)=>{const {cameraFx,...rawPost}=st.post;return {...st,post:{...rawPost,exposure:rawPost.exposure??'auto'}};});
 const main=states.find((st:any)=>st.id===stageRaw.defaultState);if(main){if(lights.length)main.lights=lights;for(const [k,v] of Object.entries(post)){if(['ambient','background'].includes(k))main[k]=v;else main.post[k]=v;}}
 const spec:SceneSpec={version:SCENE_SPEC_VERSION,id:'scene-'+doc.sha256.slice(0,12),name:doc.title,units:'m',up:'+Z',bounds,sources:[{id:'document',title:doc.title,kind:'doc',path:resolve(htmlPath)}],families,objects,materials,lighting:{defaultState:stageRaw.defaultState,states},shots:shots.length?shots:stageRaw.shots,constraints,acceptance,styleRefs,provenance:{createdAt:new Date().toISOString(),method:'normalize-general-v1;template=general',model:new Set([selections.families.model,selections.objects.model,selections.staging.model]).size===1?selections.families.model:'per-node'}};
 const report=reconcileSpec(spec,facts,{excludedMasters:objectRaw.excludedMasters,excludedLeaves:famRaw.excludedLeaves});validateSceneSpec(spec);
 writeFileSync(join(outDir,'spec.json'),JSON.stringify(spec,null,2));writeFileSync(join(outDir,'reconcile.json'),JSON.stringify(report,null,2));return {spec,report};
}

if(import.meta.main){
 const [html,out]=process.argv.slice(2),effort=process.argv.includes('--effort')?process.argv[process.argv.indexOf('--effort')+1]:'high';
 if(!html||!out){console.error('用法:bun src/spec/normalize-doc.ts <doc.html> <outDir> [--effort high|xhigh]');process.exit(2);}
 const {spec,report}=await normalizeDocument(html,out,effort);
 console.log(JSON.stringify({families:spec.families.length,objects:spec.objects.length,materials:spec.materials.length,decals:spec.decals?.length??0,states:spec.lighting.states.length,shots:spec.shots.length,acceptance:spec.acceptance.length,reconcile:report.summary},null,2));
}
