/**
 * scene-spec-v1:管线的标准化场景规格。任何输入(设计文档、文字、照片)先规格化成这份数据,后端只读它。
 * 字段对齐《临界：零重力》手册卷三 §4.1 输入包与 G2 机器字段:稳定 ID、米制变换、来源权威、P/冻结状态、
 * 生成器参数、材质与光照意图、机位、可程序检查的验收条目。坐标与 scene-foundry 场景一致:右手、米、Z 向上。
 */
import {sourceMeshErrors,type SourceMeshRef} from './source-mesh';
import {RANGE} from '../geometry/constraints';

export const SCENE_SPEC_VERSION='scene-spec-v1';
export const SPEC_LIMITS={objects:600,families:64,materials:96,lights:48,states:6,shots:12,constraints:200,acceptance:200,styleRefs:16,sources:32,params:48,decals:64};
export const SPEC_ID=/^[a-zA-Z][a-zA-Z0-9_-]{0,55}$/;

export type Vec3=[number,number,number];
/** master=设计冻结;aux=辅助来源(概念图、参考);design_fill=为补全合理推断,不声称真实测量。 */
export type SpecAuthority='master'|'aux'|'design_fill';
export type SpecSource={kind:'doc'|'image'|'prompt'|'inferred';ref:string};
export type SpecParamValue=number|string|boolean|number[];
export type SpecParams=Record<string,SpecParamValue>;
export type SpecTransform={position:Vec3;rotationDeg:Vec3;rotationOrder:'XYZ';scale:Vec3};
export type SpecGeometryBinding={materialSlots?:Record<string,string>;id:string;params:SpecParams;basis:'source'|'design_fill';reason:string};
export type SpecObject={sourceMesh?:SourceMeshRef;geometryBinding?:SpecGeometryBinding;id:string;label:string;family:string;parent:string|null;transform:SpecTransform;params:SpecParams;authority:SpecAuthority;sources:SpecSource[];confidence:number;notes:string};
export type SpecFamily={id:string;label:string;description:string;priority:'P0'|'P1'|'P2';generator:{id:string;params:SpecParams}|null;materialSlots:Record<string,string>;authority:SpecAuthority;sources:SpecSource[]};
export type SpecMaterial={id:string;label:string;baseColor:[number,number,number,number];metallic:number;roughness:number;emissive:Vec3|null;emissiveIntensity:number;transmission:number;ior:number;thickness:number;clearcoat:number;clearcoatRoughness:number;sources:SpecSource[];
 /** 可选:alpha 混合透明度(0..1)。用于清透玻璃——引擎透射在发光体前会糊成乳白,alpha 混合保持清晰。 */
 opacity?:number|null;
 /** 可选程序化表面:纹样 + 每米贴图周期数(tiles/m)。 */
 surface?:{pattern:'panel'|'plate'|'grate'|'concrete'|'puddle'|'deck'|'worn'|'trim'|`polyhaven:${string}`;tilesPerMeter:number}|null};
export type SpecDecal={id:string;label:string;kind:'stencil'|'hazard'|'puddle';text?:string;color?:Vec3;position:Vec3;rotationDeg:Vec3;size:Vec3;opacity?:number;roughness?:number};
export type SpecLight={id:string;kind:'directional'|'point'|'spot'|'area';position:Vec3|null;direction:Vec3|null;color:Vec3;intensity:number;range:number|null;innerConeDeg:number|null;outerConeDeg:number|null;width:number|null;height:number|null;castShadow:boolean};
export type SpecPost={tonemap:'aces'|'agx'|'neutral';exposure:number|'auto';bloom:{threshold:number;intensity:number;radius:number}|null;gtao:boolean;ssr:{maxDistance:number;thickness:number;maxRoughness:number}|null;fog:{color:Vec3;density:number;anisotropy:number;boundsMin:Vec3;boundsMax:Vec3;light:string}|null;planarReflections:{object:string;height:number;distortion:number}[];
 /** 可选:覆盖整个包络的静态反射探针,给金属与光面材质提供环境反射。 */
 reflectionProbe?:{intensity:number;resolution:64|128|256}|null;
 /** 可选:漫反射全局光照(irradiance-field,延迟渲染)。environment 为天空/环境辐照颜色。 */
 gi?:{environment:Vec3}|null;
 /** 可选:真体积雾(引擎 VolumetricFog + 运行时 3D 密度纹理)。extinction 为每米消光;heightFalloff 为密度随高度指数衰减率(1/m);
  *  noise 为低频噪声幅度 0..1;光柱的遮挡来自 fog.light 的阴影。须同时有 fog(取其 light 与包络)。 */
 /** 可选:相机电影感组件透传(镜头光晕/暗角色差颗粒/景深),键为引擎组件名,值为组件数据。 */
 cameraFx?:{LensFlare?:Record<string,unknown>;LensEffects?:Record<string,unknown>;DepthOfField?:Record<string,unknown>}|null;
 volumetric?:{extinction:number;albedo:Vec3;anisotropy:number;heightFalloff:number;noise:number;maxDistance:number;emission?:Vec3}|null};
export type SpecLightingState={id:string;label:string;lights:SpecLight[];ambient:{color:Vec3;groundColor?:Vec3|null;intensity:number};background:Vec3;post:SpecPost};
export type SpecShot={id:string;label:string;position:Vec3;target:Vec3;fovDeg:number};
export type SpecConstraint={id:string;description:string;value:SpecParamValue;unit:string;status:'P'|'frozen';sources:SpecSource[]};
export type SpecAcceptance={id:string;description:string;critical:boolean}&(
 |{kind:'count';family:string;equals:number}
 |{kind:'position';object:string;position:Vec3;tolerance:number}
 |{kind:'size';object:string;size:Vec3;tolerance:number}
 |{kind:'clearance';from:Vec3;to:Vec3;width:number;height:number});
export type SceneSpec={sourceEnvironment?:{lightingMode?:'preserve'|'spec';entities:Record<string,{components:Record<string,unknown>}>;camera:Record<string,unknown>};version:typeof SCENE_SPEC_VERSION;id:string;name:string;units:'m';up:'+Z';bounds:{min:Vec3;max:Vec3};
 sources:{id:string;title:string;kind:'doc'|'image'|'prompt';path:string}[];
 families:SpecFamily[];objects:SpecObject[];materials:SpecMaterial[];
 decals?:SpecDecal[];
 lighting:{defaultState:string;states:SpecLightingState[]};shots:SpecShot[];constraints:SpecConstraint[];acceptance:SpecAcceptance[];
 styleRefs:{id:string;path:string;caption:string}[];
 provenance:{createdAt:string;method:string;model:string|null}};

const finite=(n:unknown,min=-Infinity,max=Infinity)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
const vec=(v:unknown,min=-RANGE.max,max=RANGE.max)=>Array.isArray(v)&&v.length===3&&v.every(n=>finite(n,min,max));
const text=(v:unknown,max=2000)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
const AUTHORITIES=['master','aux','design_fill'],SOURCE_KINDS=['doc','image','prompt','inferred'];

/** 列出全部错误而不是遇错即停:规格化输出要一次看清所有问题,便于对账与修复。 */
export function sceneSpecErrors(value:unknown):string[]{
 const e:string[]=[],s=value as SceneSpec;
 if(!s||typeof s!=='object')return ['规格必须是对象'];
 const coordinateLimit=s.sourceEnvironment?1000:RANGE.max;
 const vec=(v:unknown,min=-coordinateLimit,max=coordinateLimit)=>Array.isArray(v)&&v.length===3&&v.every(n=>finite(n,min,max));
 if(s.version!==SCENE_SPEC_VERSION)e.push(`version 必须为 ${SCENE_SPEC_VERSION}`);
 if(!SPEC_ID.test(String(s.id)))e.push('id 不符合 '+SPEC_ID);
 if(!text(s.name,200))e.push('name 不能为空');
 if(s.sourceEnvironment){
  if(s.sourceEnvironment.lightingMode!==undefined&&!['preserve','spec'].includes(s.sourceEnvironment.lightingMode))e.push('sourceEnvironment.lightingMode 无效');
  const env=s.sourceEnvironment,allowed=['Name','Transform','Skylight','DirectionalLight','PointLight','SpotLight','RectAreaLight','Fog'];
  if(!env.entities||Object.keys(env.entities).length>48||!env.camera||JSON.stringify(env).length>200000)e.push('sourceEnvironment 无效');
  else for(const [id,value] of Object.entries(env.entities))if(!/^[a-zA-Z][a-zA-Z0-9_-]{0,80}$/.test(id)||!value?.components||Object.keys(value.components).some(k=>!allowed.includes(k)))e.push('sourceEnvironment 含不支持组件 '+id);
 }
 if(s.units!=='m' ||s.up!=='+Z')e.push('units 必须为 m,up 必须为 +Z');
 if(!vec(s.bounds?.min)||!vec(s.bounds?.max)||[0,1,2].some(k=>s.bounds.max[k]<=s.bounds.min[k]))e.push('bounds 必须是 ±'+coordinateLimit+' 内的有效包围盒');
 const list=<T,>(key:keyof SceneSpec,max:number):T[]=>{const v=(s as any)[key];if(!Array.isArray(v)){e.push(`${String(key)} 必须是数组`);return [];}if(v.length>max)e.push(`${String(key)} 超过上限 ${max}`);return v;};
 const unique=(items:{id:string}[],what:string)=>{const seen=new Set<string>();for(const x of items){if(!SPEC_ID.test(String(x?.id)))e.push(`${what} ID ${JSON.stringify(x?.id)} 不符合 ${SPEC_ID}`);else if(seen.has(x.id))e.push(`${what} ID 重复:${x.id}`);seen.add(x?.id);}return seen;};
 const sources=(v:unknown,path:string,required=true)=>{if(!Array.isArray(v)||(required&&!v.length)){e.push(`${path}.sources 至少需要一个来源`);return;}for(const x of v as SpecSource[])if(!SOURCE_KINDS.includes(x?.kind)||!text(x?.ref,300))e.push(`${path}.sources 含无效来源 ${JSON.stringify(x)}`);};
 const params=(p:unknown,path:string)=>{if(!p||typeof p!=='object'||Array.isArray(p)){e.push(`${path} 必须是对象`);return;}const keys=Object.keys(p);if(keys.length>SPEC_LIMITS.params)e.push(`${path} 参数超过 ${SPEC_LIMITS.params} 个`);for(const k of keys){const v=(p as SpecParams)[k];if(!/^[a-z][a-zA-Z0-9_]{0,40}$/.test(k))e.push(`${path}.${k} 参数名无效`);else if(!(finite(v)||typeof v==='boolean'||(typeof v==='string'&&v.length<=200)||(Array.isArray(v)&&v.length<=64&&v.every(n=>finite(n)))))e.push(`${path}.${k} 参数值无效`);}};

 list<{id:string;title:string;kind:string;path:string}>('sources',SPEC_LIMITS.sources).forEach((x,i)=>{if(!text(x?.id,80)||!text(x?.title,300)||!['doc','image','prompt'].includes(x?.kind)||typeof x?.path!=='string')e.push(`sources[${i}] 无效`);});
 const materials=list<SpecMaterial>('materials',SPEC_LIMITS.materials),materialIds=unique(materials,'材质');
 for(const m of materials){const p=`材质 ${m.id}`;
  if(!text(m.label,200))e.push(`${p} 缺 label`);
  if(!Array.isArray(m.baseColor)||m.baseColor.length!==4||!m.baseColor.every(n=>finite(n,0,1)))e.push(`${p} baseColor 须为 RGBA 0..1`);
  for(const [k,lo,hi] of [['metallic',0,1],['roughness',0,1],['emissiveIntensity',0,100],['transmission',0,1],['ior',1,2.5],['thickness',0,10],['clearcoat',0,1],['clearcoatRoughness',0,1]] as const)if(!finite((m as any)[k],lo,hi))e.push(`${p} ${k} 须在 ${lo}..${hi}`);
  if(m.opacity!=null&&!finite(m.opacity,0.02,1))e.push(`${p} opacity 无效`);
  if(m.surface!=null&&(!(['panel','plate','grate','concrete','puddle','deck','worn','trim'].includes((m.surface as any).pattern)||/^polyhaven:[a-z0-9_]+$/.test((m.surface as any).pattern))||!finite((m.surface as any).tilesPerMeter,0.01,10)))e.push(`${p} surface 无效`);
  if(m.emissive!==null&&!vec(m.emissive,0,1))e.push(`${p} emissive 须为 null 或线性 RGB 0..1`);
  sources(m.sources,p);}
 const families=list<SpecFamily>('families',SPEC_LIMITS.families),familyIds=unique(families,'资产族');
 for(const f of families){const p=`资产族 ${f.id}`;
  if(!text(f.label,200)||!text(f.description))e.push(`${p} 缺 label 或 description`);
  if(!['P0','P1','P2'].includes(f.priority))e.push(`${p} priority 须为 P0/P1/P2`);
  if(!AUTHORITIES.includes(f.authority))e.push(`${p} authority 无效`);
  if(f.generator!==null){if(!/^GEN-[A-Z0-9-]+$/.test(String(f.generator?.id)))e.push(`${p} generator.id 须形如 GEN-RING-01`);params(f.generator?.params,`${p}.generator.params`);}
  const slots=f.materialSlots&&typeof f.materialSlots==='object'?Object.entries(f.materialSlots):[];
  if(!slots.length)e.push(`${p} 至少需要一个材质槽`);
  for(const [slot,mat] of slots){if(!/^[a-z][A-Za-z0-9-]{0,40}$/.test(slot))e.push(`${p} 材质槽名 ${slot} 无效`);if(!materialIds.has(mat))e.push(`${p} 材质槽 ${slot} 引用不存在的材质 ${mat}`);}
  sources(f.sources,p);}
 const objects=list<SpecObject>('objects',SPEC_LIMITS.objects),objectIds=unique(objects,'对象');
 for(const o of objects){const p=`对象 ${o.id}`,t=o.transform;
  if(!text(o.label,200))e.push(`${p} 缺 label`);
  if(!familyIds.has(o.family))e.push(`${p} 引用不存在的资产族 ${o.family}`);
  if(o.parent!==null&&(!objectIds.has(o.parent)||o.parent===o.id))e.push(`${p} parent ${o.parent} 不存在或指向自身`);
  if(!t||!vec(t.position)||!vec(t.rotationDeg,-360,360)||t.rotationOrder!=='XYZ'||!vec(t.scale,RANGE.positiveMin,RANGE.max))e.push(`${p} transform 无效(position ±${RANGE.max}m、rotationDeg ±360、rotationOrder XYZ、scale 为正)`);
  else if(o.parent===null&&s.bounds&&[0,1,2].some(k=>t.position[k]<s.bounds.min[k]||t.position[k]>s.bounds.max[k]))e.push(`${p} 位置超出场景 bounds`);
  params(o.params,`${p}.params`);
  if(o.sourceMesh){e.push(...sourceMeshErrors(o.sourceMesh).map(x=>p+': '+x));for(const id of Object.values(o.sourceMesh.slots??{}))if(!materialIds.has(id))e.push(p+': source material missing '+id);if(o.geometryBinding)e.push(p+': sourceMesh and geometryBinding are mutually exclusive');}
  if(o.geometryBinding){const b=o.geometryBinding;if(!/^GEN-[A-Z0-9-]+$/.test(b.id)||!['source','design_fill'].includes(b.basis)||!text(b.reason))e.push(`${p} geometryBinding 依据无效`);params(b.params,`${p}.geometryBinding.params`);if(b.materialSlots)for(const id of Object.values(b.materialSlots))if(!materialIds.has(id))e.push(`${p} geometryBinding 材质不存在 ${id}`);}
  if(!AUTHORITIES.includes(o.authority))e.push(`${p} authority 无效`);
  if(!finite(o.confidence,0,1))e.push(`${p} confidence 须在 0..1`);
  if(typeof o.notes!=='string')e.push(`${p} notes 须为字符串`);
  sources(o.sources,p);}
 for(const o of objects){let cur=o,steps=0;while(cur?.parent&&steps<=objects.length){cur=objects.find(x=>x.id===cur.parent) as SpecObject;steps++;}if(steps>objects.length)e.push(`对象 ${o.id} 父子关系成环`);}
 const states=Array.isArray(s.lighting?.states)?s.lighting.states:(e.push('lighting.states 必须是数组'),[]);
 if(states.length>SPEC_LIMITS.states)e.push(`lighting.states 超过 ${SPEC_LIMITS.states}`);
 const stateIds=unique(states,'光照状态');
 if(!stateIds.has(s.lighting?.defaultState))e.push('lighting.defaultState 必须引用存在的状态');
 for(const st of states){const p=`光照状态 ${st.id}`;
  if(!text(st.label,200))e.push(`${p} 缺 label`);
  if(!Array.isArray(st.lights)||st.lights.length>SPEC_LIMITS.lights)e.push(`${p} lights 须为不超过 ${SPEC_LIMITS.lights} 的数组`);
  const lights=Array.isArray(st.lights)?st.lights:[],lightIds=unique(lights,`${p} 灯`);
  if(lights.filter(l=>l.kind==='directional').length>1)e.push(`${p} 最多一盏方向光`);
  if(lights.filter(l=>l.kind==='spot'&&l.castShadow).length>4)e.push(`${p} 投影聚光灯最多 4 盏(引擎阴影图集上限)`);
  for(const l of lights){const q=`${p} 灯 ${l.id}`;
   if(!['directional','point','spot','area'].includes(l.kind))e.push(`${q} kind 无效`);
   if(l.kind!=='directional'&&!vec(l.position))e.push(`${q} 需要 position`);
   if((l.kind==='directional'||l.kind==='spot'||l.kind==='area')&&(!vec(l.direction,-1,1)||Math.hypot(...(l.direction as Vec3))<1e-3))e.push(`${q} 需要非零 direction`);
   if(!vec(l.color,0,1)||!finite(l.intensity,0,10000))e.push(`${q} color 须为 0..1、intensity 0..10000`);
   if(l.kind==='spot'&&(!finite(l.outerConeDeg,1,89)||!finite(l.innerConeDeg,0,l.outerConeDeg as number)))e.push(`${q} 聚光需要 innerConeDeg ≤ outerConeDeg(1..89)`);
   if(l.kind==='area'&&(!finite(l.width,0.05,20)||!finite(l.height,0.05,20)))e.push(`${q} 面光需要 width/height 0.05..20`);
   if(l.kind==='area'&&l.castShadow)e.push(`${q} 面光不投影(引擎 RectAreaLight 无阴影)`);
   if(l.range!==null&&!finite(l.range,0.1,500))e.push(`${q} range 须为 null 或 0.1..500`);}
  if(!vec(st.ambient?.color,0,1)||(st.ambient?.groundColor!=null&&!vec(st.ambient.groundColor,0,1))||!finite(st.ambient?.intensity,0,10))e.push(`${p} ambient 无效`);
  if(!vec(st.background,0,1))e.push(`${p} background 无效`);
  const po=st.post;
  if(!po||!['aces','agx','neutral'].includes(po.tonemap)||!(po.exposure==='auto'||finite(po.exposure,0.01,16)))e.push(`${p} post.tonemap/exposure 无效`);
  else{
   if(po.bloom!==null&&(!finite(po.bloom?.threshold,0,16)||!finite(po.bloom?.intensity,0,4)||!finite(po.bloom?.radius,0,1)))e.push(`${p} bloom 无效`);
   if(po.ssr!==null&&(!finite(po.ssr?.maxDistance,0.1,200)||!finite(po.ssr?.thickness,0.001,5)||!finite(po.ssr?.maxRoughness,0,1)))e.push(`${p} ssr 无效`);
   if(po.fog!==null&&(!vec(po.fog?.color,0,1)||!finite(po.fog?.density,0,1)||!finite(po.fog?.anisotropy,-1,1)||!vec(po.fog?.boundsMin)||!vec(po.fog?.boundsMax)||!lightIds.has(po.fog?.light)))e.push(`${p} fog 无效(需绑定本状态内存在的灯)`);
   if(po.volumetric!=null&&(po.fog===null||!finite(po.volumetric.extinction,0,2)||!vec(po.volumetric.albedo,0,1)||!finite(po.volumetric.anisotropy,-0.99,0.99)||!finite(po.volumetric.heightFalloff,0,2)||!finite(po.volumetric.noise,0,1)||!finite(po.volumetric.maxDistance,1,1000)||(po.volumetric.emission!=null&&!vec(po.volumetric.emission,0,1))))e.push(`${p} volumetric 无效(须同时有 fog)`);
   if(po.cameraFx!=null&&(typeof po.cameraFx!=='object'||Object.keys(po.cameraFx).some(k=>!['LensFlare','LensEffects','DepthOfField'].includes(k))))e.push(`${p} cameraFx 只接受 LensFlare/LensEffects/DepthOfField`);
   if(typeof po.gtao!=='boolean')e.push(`${p} gtao 须为布尔`);
   if(!Array.isArray(po.planarReflections))e.push(`${p} planarReflections 须为数组`);
   else for(const r of po.planarReflections)if(!objectIds.has(r?.object)||!finite(r?.height,-RANGE.max,RANGE.max)||!finite(r?.distortion,0,1))e.push(`${p} 平面反射 ${JSON.stringify(r?.object)} 无效`);}}
 const shots=list<SpecShot>('shots',SPEC_LIMITS.shots);unique(shots,'机位');
 if(!shots.length)e.push('至少需要一个机位');
 for(const c of shots)if(!text(c.label,200)||!vec(c.position)||!vec(c.target)||!finite(c.fovDeg,10,120)||Math.hypot(...c.target.map((v,k)=>v-c.position[k]))<0.01)e.push(`机位 ${c.id} 无效`);
 const constraints=list<SpecConstraint>('constraints',SPEC_LIMITS.constraints);unique(constraints,'约束');
 for(const c of constraints){if(!text(c.description)||!['P','frozen'].includes(c.status)||typeof c.unit!=='string')e.push(`约束 ${c.id} 无效`);sources(c.sources,`约束 ${c.id}`);}
 const acceptance=list<SpecAcceptance>('acceptance',SPEC_LIMITS.acceptance);unique(acceptance,'验收');
 for(const a of acceptance){const p=`验收 ${a.id}`;
  if(!text(a.description)||typeof a.critical!=='boolean')e.push(`${p} 缺 description/critical`);
  if(a.kind==='count'){if(!familyIds.has(a.family)||!Number.isInteger(a.equals)||a.equals<0)e.push(`${p} count 无效`);}
  else if(a.kind==='position'){if(!objectIds.has(a.object)||!vec(a.position)||!finite(a.tolerance,0,10))e.push(`${p} position 无效`);}
  else if(a.kind==='size'){if(!objectIds.has(a.object)||!vec(a.size,0,RANGE.max)||!finite(a.tolerance,0,10))e.push(`${p} size 无效`);}
  else if(a.kind==='clearance'){if(!vec(a.from)||!vec(a.to)||!finite(a.width,0.1,50)||!finite(a.height,0.1,50))e.push(`${p} clearance 无效`);}
  else e.push(`${p} kind 无效`);}
 list<{id:string;path:string;caption:string}>('styleRefs',SPEC_LIMITS.styleRefs).forEach(r=>{if(!SPEC_ID.test(String(r?.id))||!text(r?.path,500)||typeof r?.caption!=='string')e.push(`风格参考 ${JSON.stringify(r?.id)} 无效`);});
 if(s.decals!==undefined){
  const decals=list<SpecDecal>('decals',SPEC_LIMITS.decals);unique(decals,'贴花');
  for(const d of decals){const p=`贴花 ${d?.id}`;
   if(!text(d?.label,200))e.push(`${p} 缺 label`);
   if(!['stencil','hazard','puddle'].includes(d?.kind as string))e.push(`${p} kind 须为 stencil/hazard/puddle`);
   if(d?.text!==undefined&&!text(d.text,64))e.push(`${p} text 无效`);
   if(d?.color!==undefined&&!vec(d.color,0,1))e.push(`${p} color 须为线性 RGB 0..1`);
   if(!vec(d?.position))e.push(`${p} position 无效`);
   if(!vec(d?.rotationDeg,-360,360))e.push(`${p} rotationDeg 须在 -360..360`);
   if(!vec(d?.size,0.05,RANGE.max))e.push(`${p} size 各分量须在 0.05..${RANGE.max}`);
   if(d?.opacity!==undefined&&!finite(d.opacity,0.01,1))e.push(`${p} opacity 须在 0.01..1`);
   if(d?.roughness!==undefined&&!finite(d.roughness,0,1))e.push(`${p} roughness 须在 0..1`);}
 }
 if(!text(s.provenance?.createdAt,40)||!text(s.provenance?.method,200)||!(s.provenance?.model===null||text(s.provenance?.model,100)))e.push('provenance 无效');
 return e;
}

export function validateSceneSpec(value:unknown):asserts value is SceneSpec{
 const errors=sceneSpecErrors(value);
 if(errors.length)throw Error('SCENE_SPEC_INVALID:'+errors.length+' 处问题\n'+errors.slice(0,40).join('\n'));
}
