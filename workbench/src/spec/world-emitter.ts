/**
 * 规格光照状态 + 机位 → 结构化 world.pack.ts(引擎 0.5)。不做模板字符串替换:场景实体先作为数据构建,
 * 再整体序列化进一个 definePack。规格内容实例挂在实体 'garden' 下,沿用现有相机插件与采集脚本的绑定名。
 * 平面反射的目标纹理只能运行时创建,由 planarReflectionPlugin 挂到录制相机;体积雾需要密度纹理,暂写入 deferred,不静默丢弃。
 */
import {FogModeValue} from '@forgeax/engine/render';
import {areaLightQuaternion} from '../geometry/area-lights';
import {toEnginePosition,toEngineScale} from './export-pack';
import type {SceneSpec,SpecLight,SpecLightingState,Vec3} from './schema';

const TONEMAP={aces:4,agx:5,neutral:6} as const;
const ANTIALIAS_SMAA=4,BLOOM_ENABLED=1,AO_GTAO=1;
/** 与 geometry/capture-plan.mjs 的机位上限一致。 */
export const MAX_CAPTURE_VIEWS=6;
/** 方向向量只换轴,不平移。 */
const dir=(v:Vec3)=>toEnginePosition(v);
const norm=(v:number[])=>{const l=Math.hypot(...v)||1;return v.map(n=>n/l);};

/** 构造引擎合法的 Fog 组件:固定 FogModeValue.exp,强制非负有限色彩/浓度/高度衰减、maxOpacity∈[0,1] 且 0≤near<far。 */
export function buildFogComponent(f:NonNullable<SpecLightingState['post']['fog']>&{heightFalloff?:number;maxOpacity?:number;near?:number;far?:number}){
 const color=([0,1,2] as const).map(i=>{const c=f.color?.[i];return typeof c==='number'&&Number.isFinite(c)?Math.max(0,c):0;}) as Vec3;
 const density=typeof f.density==='number'&&Number.isFinite(f.density)?Math.max(0,f.density):0.01;
 const heightFalloff=typeof f.heightFalloff==='number'&&Number.isFinite(f.heightFalloff)?Math.max(0,f.heightFalloff):0.08;
 const maxOpacity=typeof f.maxOpacity==='number'&&Number.isFinite(f.maxOpacity)?Math.min(1,Math.max(0,f.maxOpacity)):0.35;
 const near=typeof f.near==='number'&&Number.isFinite(f.near)?Math.max(0,f.near):0;
 const far=typeof f.far==='number'&&Number.isFinite(f.far)&&f.far>near?f.far:Math.max(1000,near+1);
 return {color,density,heightFalloff,maxOpacity,mode:FogModeValue.exp,near,far};
}

export type WorldEmit={source:string;planarPlugin:string|null;volumetricPlugin:string|null;planar:{object:string;height:number;distortion:number}|null;entities:Record<string,unknown>;components:string[];views:any[];deferred:{feature:string;reason:string}[]};

function lightEntity(l:SpecLight,shadowDistance=70){
 const pos=l.position?toEnginePosition(l.position):undefined;
 switch(l.kind){
  case 'directional':return {component:'DirectionalLight',value:{Name:{value:l.id},DirectionalLight:{direction:norm(dir(l.direction!)),color:l.color,intensity:l.intensity,castShadow:l.castShadow,...(l.castShadow?{shadowDistance,mapSize:2048,cascadeCount:2,shadowFilter:2,staggerCascades:true}:{})}}};
  case 'point':return {component:'PointLight',value:{Name:{value:l.id},Transform:{pos},PointLight:{color:l.color,intensity:l.intensity,range:l.range??10}}};
  case 'spot':return {component:'SpotLight',value:{Name:{value:l.id},Transform:{pos},SpotLight:{direction:norm(dir(l.direction!)),color:l.color,intensity:l.intensity,range:l.range??20,innerConeDeg:l.innerConeDeg??20,outerConeDeg:l.outerConeDeg??30,castShadow:l.castShadow,
   ...(l.castShadow?{mapSize:1024,nearPlane:.25,farPlane:l.range??20,pcfKernelSize:3}:{})}}};
  case 'area':{
   // 引擎矩形面光沿局部 +Z 发光;up 取世界上方,发光方向接近竖直时改取 +X。
   const d=norm(dir(l.direction!)),up=Math.abs(d[1])>.95?[1,0,0]:[0,1,0];
   return {component:'RectAreaLight',value:{Name:{value:l.id},Transform:{pos,quat:areaLightQuaternion(d,up)},RectAreaLight:{color:l.color,intensity:l.intensity,width:l.width??1,height:l.height??1,range:l.range??10}}};
  }
 }
}

export function emitSpecWorld(spec:SceneSpec,opts:{worldPackageId:string;stateId?:string}):WorldEmit{
 const state:SpecLightingState|undefined=spec.lighting.states.find(s=>s.id===(opts.stateId??spec.lighting.defaultState));
 if(!state)throw Error('SPEC_LIGHTING_STATE_MISSING '+(opts.stateId??spec.lighting.defaultState));
 // 采集契约最多 6 个机位:对齐概念图的构图优先,其余按规格顺序;未导出的机位写进 deferred。
 const concept=(s:{label:string})=>/主视觉|构图/.test(s.label.split(/[：:]/)[0]);
 const ranked=[...spec.shots].sort((a,b)=>Number(concept(b))-Number(concept(a))||spec.shots.indexOf(a)-spec.shots.indexOf(b));
 const shots=ranked.slice(0,MAX_CAPTURE_VIEWS),shot=shots[0],post=state.post,deferred:WorldEmit['deferred']=ranked.slice(MAX_CAPTURE_VIEWS).map(s=>({feature:'Shot:'+s.id,reason:`采集最多 ${MAX_CAPTURE_VIEWS} 个机位`}));
 const components=new Set(['Camera','Skylight','Name','Transform']);
 const camera:Record<string,unknown>={Name:{value:'Recording camera'},Transform:{pos:toEnginePosition(shot.position)},
  Camera:{fov:shot.fovDeg*Math.PI/180,aspect:16/9,near:.1,far:1000,clearColor:[...state.background,1],antialias:ANTIALIAS_SMAA,tonemap:TONEMAP[post.tonemap],
   ...(post.exposure==='auto'?{exposureMode:1,exposure:1}:{exposureMode:0,exposure:post.exposure}),
   ...(post.bloom?{bloom:BLOOM_ENABLED,bloomThreshold:post.bloom.threshold,bloomIntensity:post.bloom.intensity,bloomRadius:post.bloom.radius}:{})}};
 if(post.gtao){camera.AmbientOcclusion={algorithm:AO_GTAO,radius:.6,intensity:1.2,directLightingStrength:.4};components.add('AmbientOcclusion');}
 if(post.ssr){camera.ScreenSpaceReflection=post.ssr;components.add('ScreenSpaceReflection');}
 for(const [k,v] of Object.entries(post.cameraFx??{}))if(v){camera[k]=v;components.add(k);}
 if(post.reflectionProbe)components.add('ReflectionProbe');
 // 引擎每台相机只有一个平面反射平面:取第一项,其余写进 deferred。目标纹理由插件在运行时创建。
 const [planar,...extraPlanar]=post.planarReflections;
 for(const p of extraPlanar)deferred.push({feature:'PlanarReflection:'+p.object,reason:'引擎每台相机只支持一个平面反射平面'});
 // 体积雾要 3D 密度纹理(pack 数据声明不了);先用解析高度雾表达空气透视,体积光柱延后。
 const fog=post.fog&&!post.volumetric?{Name:{value:'Aerial fog'},Fog:buildFogComponent(post.fog)}:null;
 if(fog){components.add('Fog');
  if(!post.volumetric)deferred.push({feature:'VolumetricFog',reason:'规格未开 volumetric;只用解析高度雾 Fog,无体积光柱'});}
 const volumetricPlugin=post.fog&&post.volumetric?volumetricFogPlugin({mode:process.env.SPEC_VOLFOG_MODE,lightKey:'light_'+post.fog.light.replace(/[^A-Za-z0-9_]/g,'_'),boundsMin:post.fog.boundsMin,boundsMax:post.fog.boundsMax,...post.volumetric}):null;
 const span=Math.max(spec.bounds.max[0]-spec.bounds.min[0],spec.bounds.max[1]-spec.bounds.min[1],spec.bounds.max[2]-spec.bounds.min[2]);
 const maxRange=Math.max(24,Math.min(90,Math.round(span*0.9)));
 const shadowDistance=Math.max(70,Math.min(180,Math.ceil(span*1.5)));
 const groundColor:Vec3=state.ambient.groundColor??(state.ambient.color.map((c,i)=>Math.min(1,Number((c*[0.42,0.46,0.54][i]!).toFixed(4)))) as Vec3);
 const entities:Record<string,unknown>={
  garden:{components:{Name:{value:spec.name}},instance:{source:'@scene'}},
  camera:{components:camera},
  ambient:{components:{Name:{value:'Ambient'},Skylight:{color:state.ambient.color,groundColor,intensity:state.ambient.intensity}}},
  ...(fog?{fog:{components:fog}}:{}),
  // 静态反射探针覆盖整个包络,盒投影;金属环、核心球与湿地面映出大厅本身而不是空背景。
  ...(post.reflectionProbe?{hallProbe:{components:{Name:{value:'Hall reflection probe'},Transform:{pos:toEnginePosition(post.reflectionProbe.position??spec.bounds.min.map((v,k)=>(v+spec.bounds.max[k])/2) as Vec3)},ReflectionProbe:{halfExtents:toEngineScale(spec.bounds.max.map((v,k)=>Math.max(Math.abs(v-(post.reflectionProbe!.position?.[k]??(v+spec.bounds.min[k])/2)),Math.abs(spec.bounds.min[k]-(post.reflectionProbe!.position?.[k]??(v+spec.bounds.min[k])/2)))) as Vec3),priority:0,boxProjection:true,intensity:post.reflectionProbe.intensity,resolution:post.reflectionProbe.resolution,updateIntent:0,invalidationVersion:1}}}}:{}),
 };
 // 引擎 0.5 的 irradiance-field GI 不接受矩形面光(ray-reference-invalid: analytic area lights are not admitted);
 // 开 GI 时把面光换成同位置同朝向的宽角聚光灯,强度按面积折算,并记入 deferred。
 // SPEC_GI_KEEP_AREA=1:验收用,保留面光进 GI 场景(sf.1 起引擎把面光排除出 GI 而不是整帧失败)。
 const lights=post.gi&&process.env.SPEC_GI_KEEP_AREA!=='1'?state.lights.map(l=>{if(l.kind!=='area')return l;deferred.push({feature:'RectAreaLight:'+l.id,reason:'GI 不接受面光,已换成宽角聚光灯'});return {...l,kind:'spot' as const,intensity:l.intensity*(l.width??1)*(l.height??1)*4,innerConeDeg:50,outerConeDeg:80,castShadow:false};}):state.lights;
 // 自适应大空间光照预算:随场景跨度 span 扩展射程上限(24m..90m)与方向光阴影距离(70m..180m),
 // 允许方向光与最多 2 盏聚光投影(兼顾顶部核心光柱与远端背光门);若预算尚有空余槽位,为高强度远射聚光灯自动补开投影,
 // 防止无阴影聚光灯穿墙直轰光滑地面/水池造成异常镜面亮斑;超出部分截断并记入 deferred。SPEC_LIGHT_BUDGET=0 关闭。
 const budget=process.env.SPEC_LIGHT_BUDGET!=='0';
 const authoredSpotShadows=lights.filter(l=>l.kind==='spot'&&l.castShadow).length;
 let autoSpotShadows=Math.max(0,2-authoredSpotShadows);
 let spotShadows=0;
 const budgeted=budget?lights.map(l=>{let o=l;if(o.kind!=='directional'&&(o.range??0)>maxRange){deferred.push({feature:'LightRange:'+o.id,reason:`射程 ${o.range}m 截到 ${maxRange}m(光照预算)`});o={...o,range:maxRange};}
  if(!o.castShadow&&o.kind==='spot'&&autoSpotShadows>0&&o.intensity>=800&&(o.range??20)>=20){autoSpotShadows--;spotShadows++;return {...o,castShadow:true};}
  if(o.castShadow&&o.kind!=='directional'){if(o.kind==='spot'&&spotShadows++<2)return o;deferred.push({feature:'LightShadow:'+o.id,reason:'只保留方向光与最多 2 盏聚光投影(光照预算)'});o={...o,castShadow:false};}return o;}):lights;
 budgeted.forEach(l=>{const e=lightEntity(l,shadowDistance);components.add(e.component);entities['light_'+l.id.replace(/[^A-Za-z0-9_]/g,'_')]={components:e.value};});
 const views=shots.map(s=>({id:s.id,name:s.label.split(/[：:]/)[0].slice(0,12),position:toEnginePosition(s.position),target:toEnginePosition(s.target),up:[0,1,0],fov:s.fovDeg*Math.PI/180,frame:{width:1600,height:900}}));
 const list=[...components].sort();
 const source=`// 由 scene-foundry 规格导出器生成(${spec.id} / 光照状态 ${state.id})。
import {AssetGuid,definePack,definePackageId} from '@forgeax/engine/pack/source';
import {${list.filter(c=>!['Name','Transform'].includes(c)).join(',')}} from '@forgeax/engine/render';
import {Name,Transform} from '@forgeax/engine/scene';
import {quat} from '@forgeax/engine/math';
import {ok} from '@forgeax/engine/types';
import identity from './generated-identity.ts';
const packageId=definePackageId(${JSON.stringify(opts.worldPackageId)});
const sceneGuid=AssetGuid.format(AssetGuid.derive(definePackageId(identity.packageId),identity.sourceKey));
const entities=${JSON.stringify(entities)} as any;
entities.garden.instance.source=sceneGuid;
const pos=entities.camera.components.Transform.pos;
entities.camera.components.Transform.quat=Array.from(quat.fromLookAt(quat.create(),pos,${JSON.stringify(toEnginePosition(shot.target))},[0,1,0]));
export default definePack({
 schemaVersion:'2.0.0',packageId,name:${JSON.stringify(spec.name)},
 sceneComponents:[${list.join(',')}],
 build(){return ok({'scene/main':{kind:'scene',entities}});},
});
`;
 return {source,entities,components:list,views,deferred,planar:planar??null,planarPlugin:planar?planarReflectionPlugin(planar):null,volumetricPlugin};
}

/** 运行时给录制相机挂平面反射:规格平面 z=height(Z 向上)→ 引擎平面 y=height,法线 +Y,距离 -height。 */
export function planarReflectionPlugin(p:{object:string;height:number;distortion:number}){
 return `import type {} from '@forgeax/engine/app';
import {PlanarReflection} from '@forgeax/engine/render';
import type {Plugin} from '@forgeax/engine/plugin';
import {sceneEntity,worldResolveSceneEntity} from '@forgeax/engine/scene';
export default {name:'scene/planar-reflection',inject:['world','gameHost','executionBootstrapHost'],apply(ctx){
 const host=ctx.gameHost,targets=ctx.executionBootstrapHost?.renderTargets??(host as any)?.renderer;
 if(host?.defaultSceneRoot===undefined||!targets)throw new Error('planar reflection: scene root or render target authoring unavailable');
 const camera=worldResolveSceneEntity(ctx.world,host.defaultSceneRoot,sceneEntity('scene/main','camera')).unwrap();
 const created=targets.createRenderTarget({shape:'2d',width:640,height:360,format:'rgba16float',sampleCount:1,mipLevels:1,sampled:true,readback:false});
 if(!created.ok)throw created.error;
 ctx.world.addComponent(camera,{component:PlanarReflection,data:{target:ctx.world.allocSharedRef('RenderTarget',created.value),normal:[0,1,0],distance:${-p.height},distortion:${p.distortion}} as never}).unwrap();
 ctx.effect(function*(){yield()=>{ctx.world.removeComponent(camera,PlanarReflection);targets.destroyRenderTarget(created.value);};},'scene/planar-reflection');
}} satisfies Plugin;
`;
}

/**
 * 运行时体积雾:在插件里生成 32×32×16 的 r8unorm 3D 密度纹理(x 最快,其次 y,最后 z;引擎轴 Y 向上),
 * 密度 = exp(-heightFalloff·高度) × (1 - noise + noise·低频值噪声),再用 allocSharedRef 绑到 VolumetricFog。
 * 规格包络(Z 向上)换到引擎轴后取逐分量 min/max。光柱遮挡来自所绑灯的阴影。
 */
export function volumetricFogPlugin(v:{mode?:string;lightKey:string;boundsMin:Vec3;boundsMax:Vec3;extinction:number;albedo:Vec3;anisotropy:number;heightFalloff:number;noise:number;maxDistance:number;emission?:Vec3}){
 const a=toEnginePosition(v.boundsMin),b=toEnginePosition(v.boundsMax),min=a.map((x,i)=>Math.min(x,b[i]!)),max=a.map((x,i)=>Math.max(x,b[i]!));
 return `import type {} from '@forgeax/engine/app';
import {VolumetricFog,VolumetricFogSamplingValue} from '@forgeax/engine/render';
import type {Plugin} from '@forgeax/engine/plugin';
import {sceneEntity,worldResolveSceneEntity} from '@forgeax/engine/scene';
const W=32,H=32,D=16,MIN=${JSON.stringify(min)},MAX=${JSON.stringify(max)};
function density(){
 const hash=(x:number,y:number,z:number)=>{let h=(x*374761393+y*668265263+z*2147483647)|0;h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967295;};
 const smooth=(t:number)=>t*t*(3-2*t),lerp=(a:number,b:number,t:number)=>a+(b-a)*t;
 const noise=(x:number,y:number,z:number)=>{const x0=Math.floor(x),y0=Math.floor(y),z0=Math.floor(z),fx=smooth(x-x0),fy=smooth(y-y0),fz=smooth(z-z0);
  const c=(i:number,j:number,k:number)=>hash(x0+i,y0+j,z0+k);
  return lerp(lerp(lerp(c(0,0,0),c(1,0,0),fx),lerp(c(0,1,0),c(1,1,0),fx),fy),lerp(lerp(c(0,0,1),c(1,0,1),fx),lerp(c(0,1,1),c(1,1,1),fx),fy),fz);};
 const out=new Uint8Array(W*H*D),height=MAX[1]-MIN[1];
 for(let z=0;z<D;z++)for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const h=(y+0.5)/H*height,n=noise(x/6,y/6,z/4)*0.65+noise(x/2.5,y/2.5,z/2)*0.35;
  const d=Math.exp(-${v.heightFalloff}*h)*(1-${v.noise}+${v.noise}*n);
  out[(z*H+y)*W+x]=Math.max(0,Math.min(255,Math.round(d*255)));}
 return out;
}
export default {name:'scene/volumetric-fog',inject:['world','gameHost','assets'],apply(ctx){
 const host=ctx.gameHost,assets=ctx.assets;
 if(host?.defaultSceneRoot===undefined||!assets)throw new Error('volumetric fog: scene root or asset registry unavailable');
 const light=worldResolveSceneEntity(ctx.world,host.defaultSceneRoot,sceneEntity('scene/main',${JSON.stringify(v.lightKey)})).unwrap();
 // 纹理须由资产注册表创建(引用归属校验);world.allocSharedRef 的裸对象会被判 asset-reference-invalid。
 // 验收开关(SPEC_VOLFOG_MODE,导出期决定):uniform=不带密度纹理的均匀体积雾(sf.1 起);sharedref=故意用 world.allocSharedRef 造纹理引用(验报错提示)。
 const desc={kind:'texture',shape:{viewDimension:'3d',extent:{width:W,height:H,depth:D}},format:'r8unorm',colorSpace:'linear',mips:{kind:'none'},data:density()};
 const tex=${v.mode==='uniform'?'undefined':v.mode==='sharedref'?"(ctx.world as any).allocSharedRef('Texture',desc)":"assets.create(desc as never).unwrap()"};
 const fog=ctx.world.spawn({component:VolumetricFog,data:{light,${v.mode==='uniform'?'':'density:tex,'}boundsMin:MIN,boundsMax:MAX,extinction:[${v.extinction},${v.extinction},${v.extinction}],albedo:${JSON.stringify(v.albedo)},emission:${JSON.stringify(v.emission??[0,0,0])},anisotropy:${v.anisotropy},maxDistance:${Math.min(v.maxDistance,80)},sampling:${v.mode==='uniform'?'3 /* VolumetricFogSamplingValue.uniform */':'VolumetricFogSamplingValue.density'}} as never}).unwrap();
 ctx.effect(function*(){yield()=>{ctx.world.despawn(fog);${v.mode==='uniform'||v.mode==='sharedref'?'':'assets.release(tex as never);'}};},'scene/volumetric-fog');
}} satisfies Plugin;
`;
}
