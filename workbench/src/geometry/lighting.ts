import {pointShadowSchema,validatePointShadows,POINT_SHADOW_RULES,type PointShadow} from './point-shadows';
import {reflectionProbeSchema,validateReflectionProbes,REFLECTION_PROBE_RULES,type SceneReflectionProbe} from './reflection-probes';
import {cameraOutputSchema,validateCameraOutput,CAMERA_OUTPUT_RULES,type CameraOutput} from './camera-output';
/** Engine PointLight/SpotLight use candela, meters, and outgoing directions. */
export type LocalLight={position:number[];color:number[];intensity:number;range:number};
export type SceneSpot=LocalLight&{direction:number[];innerConeDeg:number;outerConeDeg:number;castShadow:boolean};
export type DirectionalShadow={filter:'pcf3'|'pcssMedium'|'pcssHigh';angularRadius:number;maxPenumbraTexels:number;mapSize:1024|2048;shadowDistance?:number|null;normalBias?:number|null;depthBias?:number|null};
export type SceneLighting={reflectionProbes?:SceneReflectionProbe[]|null;cameraOutput?:CameraOutput|null;directionalShadow?:DirectionalShadow|null;backgroundColor?:number[]|null;direction:number[];color:number[];intensity:number;ambientColor:number[];ambientIntensity:number;points:(LocalLight&{shadow?:PointShadow|null})[];spots?:SceneSpot[]};
const num={type:'number'},vector={type:'array',items:num,minItems:3,maxItems:3};
const obj=(properties:any)=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const local={position:vector,color:vector,intensity:{type:'number',minimum:0,maximum:10000},range:{type:'number',minimum:.1,maximum:100}};
const optionalNumber=(min:number,max:number)=>({anyOf:[{type:'number',minimum:min,maximum:max},{type:'null'}]});
export const lightingSchema=()=>obj({reflectionProbes:reflectionProbeSchema(),cameraOutput:cameraOutputSchema(),directionalShadow:{anyOf:[obj({filter:{type:'string',enum:['pcf3','pcssMedium','pcssHigh']},angularRadius:{type:'number',minimum:.0001,maximum:.05},maxPenumbraTexels:{type:'integer',minimum:1,maximum:64},mapSize:{type:'integer',enum:[1024,2048]},shadowDistance:optionalNumber(1,128),normalBias:optionalNumber(0,.1),depthBias:optionalNumber(0,.001)}),{type:'null'}]},backgroundColor:{anyOf:[vector,{type:'null'}]},direction:vector,color:vector,intensity:{type:'number',minimum:0,maximum:8},ambientColor:vector,ambientIntensity:{type:'number',minimum:.02,maximum:2},points:{type:'array',maxItems:16,items:obj({...local,shadow:pointShadowSchema()})},spots:{type:'array',maxItems:4,items:obj({...local,direction:vector,innerConeDeg:{type:'number',minimum:0,maximum:89},outerConeDeg:{type:'number',exclusiveMinimum:0,maximum:90},castShadow:{type:'boolean'}})}});
const finite=(n:any,min:number,max:number)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
const vec=(v:any,min=-100,max=100)=>Array.isArray(v)&&v.length===3&&v.every(n=>finite(n,min,max));
const direction=(v:any)=>vec(v,-1,1)&&Math.hypot(...v)>.01;
const check=(ok:any,message:string)=>{if(!ok)throw Error(message)};
export function validateLighting(light:SceneLighting){
 validateCameraOutput(light?.cameraOutput);validateReflectionProbes(light?.reflectionProbes);
 if(light?.directionalShadow!=null){const s=light.directionalShadow;check(['pcf3','pcssMedium','pcssHigh'].includes(s.filter)&&finite(s.angularRadius,.0001,.05)&&Number.isInteger(s.maxPenumbraTexels)&&finite(s.maxPenumbraTexels,1,64)&&[1024,2048].includes(s.mapSize)&&(s.shadowDistance==null||finite(s.shadowDistance,1,128))&&(s.normalBias==null||finite(s.normalBias,0,.1))&&(s.depthBias==null||finite(s.depthBias,0,.001)),'方向光阴影参数无效');}
 check(light?.backgroundColor==null||vec(light.backgroundColor,0,1),'背景颜色无效');
 check(light&&direction(light.direction)&&vec(light.color,0,1)&&vec(light.ambientColor,0,1)&&finite(light.intensity,0,8)&&finite(light.ambientIntensity,.02,2)&&Array.isArray(light.points)&&light.points.length<=16,'光照参数无效');
 const local=(p:LocalLight)=>vec(p.position)&&vec(p.color,0,1)&&finite(p.intensity,0,10000)&&finite(p.range,.1,100);
 for(const p of light.points)check(local(p),'局部光照参数无效');
 validatePointShadows(light.points);
 check(light.spots===undefined||Array.isArray(light.spots)&&light.spots.length<=4,'聚光灯数量超限');
 for(const p of light.spots??[])check(local(p)&&direction(p.direction)&&finite(p.innerConeDeg,0,89)&&finite(p.outerConeDeg,.001,90)&&p.outerConeDeg>p.innerConeDeg&&typeof p.castShadow==='boolean','聚光灯参数无效');
 return light;
}
export const LIGHTING_RULES=`${CAMERA_OUTPUT_RULES}
${REFLECTION_PROBE_RULES}
${POINT_SHADOW_RULES}
光照直接使用 ForgeaX Engine 的真实单位：场景距离为米，points 与 spots 的 intensity 是坎德拉，不是0..1比例。局部光按距离平方反比衰减并在range边缘柔和归零；例如距离3米、目标照度约5勒克斯时，忽略表面角度与range衰减的初估为45坎德拉，不能照抄数值，须结合实际距离和截图校正。points 为全向点光，最多16个；spots 为有方向的锥形光，最多4个，每项包含 position、direction、color、intensity、range、innerConeDeg、outerConeDeg、castShadow，无需时填[]。direction 从光源指向被照表面，Z向上；innerConeDeg/outerConeDeg是半角的度数，0<=inner<outer<=90。聚光灯castShadow=true时由实际几何遮挡；用于有参考依据的门窗局部入光或真实灯具，不能凭空补造光源。局部光强范围0..10000坎德拉、range为0.1..100米，是数值边界而非建议值，优先最少必要光源并避免过曝。方向光仍为 direction/color/intensity，环境光为 ambientColor/ambientIntensity，color是线性RGB；两者无距离衰减。照片贴图自带光照，必须避免二次压暗或整体冲白。背景、灯位和明暗均依原图，不用光照掩盖缺失几何。directionalShadow可使用当前固定Engine已实现的方向光阴影能力：filter为pcf3、pcssMedium或pcssHigh；angularRadius是光源角半径弧度，范围0.0001..0.05，太阳量级约0.00465；maxPenumbraTexels是搜索与滤波上限1..64；mapSize为1024或2048。null保留旧版PCF3和1024贴图。PCSS根据遮挡者距离产生半影；仅影响方向光，不自动柔化聚光灯，也不提供全局光照、面光源或玻璃散射。根据真实参考和实际预览选择，不将最大角半径当默认值，不用模糊掩盖错位阴影。更大贴图和高质量PCSS增加GPU开销，仍须通过真实帧率检查。 可选shadowDistance为相机附近方向光阴影覆盖距离，单位米，范围1..128；null保留65米。按完整可见场景及相机巡视范围选择，过大会降低小部件阴影分辨率，过小会裁掉远处阴影。normalBias是世界空间沿法线偏移，单位米，范围0..0.1；null保留固定Engine默认0.05米。5厘米可能掩盖小部件接触阴影，依据最小可见结构和真实预览选择更小值，并检查阴影痤疮。depthBias是归一化阴影深度偏移，范围0..0.001；null保留Engine默认0.00001，不把它当米。降低偏移不能代替正确的几何接触，也不提供环境遮蔽或全局光照；只据实际预览判断收益。`;
export function spotEntities(light:SceneLighting){
 validateLighting(light);const toEngine=(v:number[])=>[v[0],v[2],-v[1]];
 return Object.fromEntries((light.spots??[]).map((p,i)=>['spotLight'+i,{components:{Transform:{pos:toEngine(p.position)},SpotLight:{direction:toEngine(p.direction),color:p.color,intensity:p.intensity,range:p.range,innerConeDeg:p.innerConeDeg,outerConeDeg:p.outerConeDeg,castShadow:p.castShadow,mapSize:1024,nearPlane:.1,farPlane:p.range,pcfKernelSize:3}}}]));
}

/** 显式映射固定 Engine 的闭合阴影契约；历史未声明时保持原设置。 */
export function directionalShadowFields(light:SceneLighting){validateLighting(light);const s=light.directionalShadow;return s?{shadowFilter:({pcf3:2,pcssMedium:4,pcssHigh:5})[s.filter],shadowAngularRadius:s.angularRadius,maxPenumbraTexels:s.maxPenumbraTexels,mapSize:s.mapSize,...Object.fromEntries(['shadowDistance','normalBias','depthBias'].filter(k=>s[k]!=null).map(k=>[k,s[k]]))}:{shadowFilter:2,mapSize:1024};}
export function bindDirectionalShadow(world:string,light:SceneLighting){if(!light.directionalShadow)return world;const original='shadowDistance:65,mapSize:1024,cascadeCount:3,shadowFilter:2';if(world.split(original).length!==2)throw Error('方向光导出模板阴影契约变化');const f={shadowDistance:65,...directionalShadowFields(light)};return world.replace(original,'cascadeCount:3,'+Object.entries(f).map(([k,v])=>k+':'+JSON.stringify(v)).join(','));}
