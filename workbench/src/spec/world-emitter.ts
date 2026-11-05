/**
 * 规格光照状态 + 机位 → 结构化 world.pack.ts(引擎 0.5)。不做模板字符串替换:场景实体先作为数据构建,
 * 再整体序列化进一个 definePack。规格内容实例挂在实体 'garden' 下,沿用现有相机插件与采集脚本的绑定名。
 * 平面反射的目标纹理只能运行时创建,由 planarReflectionPlugin 挂到录制相机;体积雾需要密度纹理,暂写入 deferred,不静默丢弃。
 */
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

export type WorldEmit={source:string;planarPlugin:string|null;planar:{object:string;height:number;distortion:number}|null;entities:Record<string,unknown>;components:string[];views:any[];deferred:{feature:string;reason:string}[]};

function lightEntity(l:SpecLight){
 const pos=l.position?toEnginePosition(l.position):undefined;
 switch(l.kind){
  case 'directional':return {component:'DirectionalLight',value:{Name:{value:l.id},DirectionalLight:{direction:norm(dir(l.direction!)),color:l.color,intensity:l.intensity,castShadow:l.castShadow,...(l.castShadow?{shadowDistance:90,mapSize:2048,cascadeCount:3,shadowFilter:4}:{})}}};
  case 'point':return {component:'PointLight',value:{Name:{value:l.id},Transform:{pos},PointLight:{color:l.color,intensity:l.intensity,range:l.range??10}}};
  case 'spot':return {component:'SpotLight',value:{Name:{value:l.id},Transform:{pos},SpotLight:{direction:norm(dir(l.direction!)),color:l.color,intensity:l.intensity,range:l.range??20,innerConeDeg:l.innerConeDeg??20,outerConeDeg:l.outerConeDeg??30,castShadow:l.castShadow,
   ...(l.castShadow?{mapSize:1024,nearPlane:.1,farPlane:l.range??20,pcfKernelSize:3}:{})}}};
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
 if(post.reflectionProbe)components.add('ReflectionProbe');
 // 引擎每台相机只有一个平面反射平面:取第一项,其余写进 deferred。目标纹理由插件在运行时创建。
 const [planar,...extraPlanar]=post.planarReflections;
 for(const p of extraPlanar)deferred.push({feature:'PlanarReflection:'+p.object,reason:'引擎每台相机只支持一个平面反射平面'});
 // 体积雾要 3D 密度纹理(pack 数据声明不了);先用解析高度雾表达空气透视,体积光柱延后。
 const fog=post.fog?{Name:{value:'Aerial fog'},Fog:{color:post.fog.color,density:post.fog.density,heightFalloff:0.08,maxOpacity:0.35,mode:0,near:0,far:1000}}:null;
 if(post.fog){components.add('Fog');
  deferred.push({feature:'VolumetricFog',reason:'体积雾需要 3D 密度纹理资产;已用解析高度雾 Fog 代替,无体积光柱'});}
 const entities:Record<string,unknown>={
  garden:{components:{Name:{value:spec.name}},instance:{source:'@scene'}},
  camera:{components:camera},
  ambient:{components:{Name:{value:'Ambient'},Skylight:{color:state.ambient.color,intensity:state.ambient.intensity}}},
  ...(fog?{fog:{components:fog}}:{}),
  // 静态反射探针覆盖整个包络,盒投影;金属环、核心球与湿地面映出大厅本身而不是空背景。
  ...(post.reflectionProbe?{hallProbe:{components:{Name:{value:'Hall reflection probe'},Transform:{pos:toEnginePosition(spec.bounds.min.map((v,k)=>(v+spec.bounds.max[k])/2) as Vec3)},ReflectionProbe:{halfExtents:toEngineScale(spec.bounds.max.map((v,k)=>(v-spec.bounds.min[k])/2) as Vec3),priority:0,boxProjection:true,intensity:post.reflectionProbe.intensity,resolution:post.reflectionProbe.resolution,updateIntent:0,invalidationVersion:1}}}}:{}),
 };
 // 引擎 0.5 的 irradiance-field GI 不接受矩形面光(ray-reference-invalid: analytic area lights are not admitted);
 // 开 GI 时把面光换成同位置同朝向的宽角聚光灯,强度按面积折算,并记入 deferred。
 const lights=post.gi?state.lights.map(l=>{if(l.kind!=='area')return l;deferred.push({feature:'RectAreaLight:'+l.id,reason:'GI 不接受面光,已换成宽角聚光灯'});return {...l,kind:'spot' as const,intensity:l.intensity*(l.width??1)*(l.height??1)*4,innerConeDeg:50,outerConeDeg:80,castShadow:false};}):state.lights;
 lights.forEach(l=>{const e=lightEntity(l);components.add(e.component);entities['light_'+l.id.replace(/[^A-Za-z0-9_]/g,'_')]={components:e.value};});
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
 return {source,entities,components:list,views,deferred,planar:planar??null,planarPlugin:planar?planarReflectionPlugin(planar):null};
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
 const created=targets.createRenderTarget({shape:'2d',width:1280,height:720,format:'rgba16float',sampleCount:1,mipLevels:1,sampled:true,readback:false});
 if(!created.ok)throw created.error;
 ctx.world.addComponent(camera,{component:PlanarReflection,data:{target:ctx.world.allocSharedRef('RenderTarget',created.value),normal:[0,1,0],distance:${-p.height},distortion:${p.distortion}} as never}).unwrap();
 ctx.effect(function*(){yield()=>{ctx.world.removeComponent(camera,PlanarReflection);targets.destroyRenderTarget(created.value);};},'scene/planar-reflection');
}} satisfies Plugin;
`;
}
