/** Fixed Engine LTC rectangular direct light, without shadowing or transmission. */
export type SceneAreaLight={position:number[];direction:number[];up:number[];color:number[];intensity:number;range:number;width:number;height:number};
const scalar=(minimum:number,maximum:number)=>({type:'number',minimum,maximum});
const vector=(minimum:number,maximum:number)=>({type:'array',items:scalar(minimum,maximum),minItems:3,maxItems:3});
const properties={position:vector(-100,100),direction:vector(-1,1),up:vector(-1,1),color:vector(0,1),intensity:scalar(0,1000),range:scalar(.1,100),width:scalar(.05,20),height:scalar(.05,20)};
export const areaLightSchema=()=>({anyOf:[{type:'array',maxItems:4,items:{type:'object',properties,required:Object.keys(properties),additionalProperties:false}},{type:'null'}]});
const cross=(a:number[],b:number[])=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const normalize=(v:number[])=>{const length=Math.hypot(...v);return v.map(n=>n/length);};
export function validateAreaLights(value:unknown):asserts value is SceneAreaLight[]|null|undefined{
 if(value==null)return;
 const finite=(v:any,a:number,b:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=a&&v<=b;
 const vec=(v:any,a:number,b:number)=>Array.isArray(v)&&v.length===3&&v.every(n=>finite(n,a,b));
 const dir=(v:any)=>vec(v,-1,1)&&Math.hypot(...v)>.01;
 if(!Array.isArray(value)||value.length>4||value.some(p=>!p||typeof p!=='object'||Object.keys(p).some(k=>!Object.hasOwn(properties,k))||!vec(p.position,-100,100)||!vec(p.color,0,1)||!dir(p.direction)||!dir(p.up)||Math.hypot(...cross(normalize(p.direction),normalize(p.up)))<.01||!finite(p.intensity,0,1000)||!finite(p.range,.1,100)||!finite(p.width,.05,20)||!finite(p.height,.05,20)))throw Error('矩形面光参数无效：最多4个，方向与up不得退化或平行');
}
/** Matrix columns are right/up/front; Engine Rect emits toward local +Z. */
export function areaLightQuaternion(direction:number[],up:number[]){
 const z=normalize(direction),x=normalize(cross(up,z)),y=cross(z,x);
 const m00=x[0],m01=y[0],m02=z[0],m10=x[1],m11=y[1],m12=z[1],m20=x[2],m21=y[2],m22=z[2],trace=m00+m11+m22;
 let q:number[];
 if(trace>0){const s=Math.sqrt(trace+1)*2;q=[(m21-m12)/s,(m02-m20)/s,(m10-m01)/s,s/4];}
 else if(m00>m11&&m00>m22){const s=Math.sqrt(1+m00-m11-m22)*2;q=[s/4,(m01+m10)/s,(m02+m20)/s,(m21-m12)/s];}
 else if(m11>m22){const s=Math.sqrt(1+m11-m00-m22)*2;q=[(m01+m10)/s,s/4,(m12+m21)/s,(m02-m20)/s];}
 else {const s=Math.sqrt(1+m22-m00-m11)*2;q=[(m02+m20)/s,(m12+m21)/s,s/4,(m10-m01)/s];}
 return normalize(q);
}
export function areaLightEntities(lights?:SceneAreaLight[]|null){
 validateAreaLights(lights);const engine=(v:number[])=>[v[0],v[2],-v[1]];
 return Object.fromEntries((lights??[]).map((p,i)=>['areaLight'+i,{components:{Transform:{pos:engine(p.position),quat:areaLightQuaternion(engine(p.direction),engine(p.up))},RectAreaLight:{color:p.color,intensity:p.intensity,width:p.width,height:p.height,range:p.range}}}]));
}
export function bindAreaLights(world:string,lights?:SceneAreaLight[]|null){
 const entries=Object.entries(areaLightEntities(lights));if(!entries.length)return world;
 const replace=(from:string,to:string)=>{if(world.split(from).length!==2)throw Error('矩形面光导出契约变化');world=world.replace(from,to);};
 const imports=[...world.matchAll(/import \{([^;\n]+) \} from '@forgeax\/engine\/render';/g)];
 if(imports.length!==1||!imports[0][1].split(',').some(s=>s.trim()==='perspective'))throw Error('矩形面光导出契约变化');
 replace(imports[0][0],`import {${imports[0][1]}, RectAreaLight } from '@forgeax/engine/render';`);
 replace('Name,Transform]','RectAreaLight,Name,Transform]');
 replace('ambient:{components:',entries.map(([id,value])=>id+':'+JSON.stringify(value)+',').join('')+'ambient:{components:');
 return world;
}
export const AREA_LIGHT_RULES='可选lighting.areaLights为null或最多4个矩形面光，points+spots+areaLights总数最多20；新增面光应替换其对应点源，避免重复能量。每项position、direction、up使用Z向上的场景坐标；direction是发光面的正面指向，up确定矩形高度轴，与direction不得平行；width/height为真实发光面的米制宽高(0.05..20)，不是明暗光斑尺寸。color为线性RGB，intensity为固定Engine的线性辐亮度倍率(0..1000)，不同于点光坎德拉，不得原样复制点光强度；面积增大会增加总发光量，须依据原图真实光源尺寸和预览校准。range为衰减边界米数(0.1..100)。使用Engine公开RectAreaLight的单面LTC漫反射与GGX镜面响应，可以形成有限面积高光；不是把点光模糊。该实现不提供面光阴影、遮挡、漫反射GI、灯罩透射或bloom，可能穿过遮挡物，不能把无阴影面光用于需遮挡才能成立的光路；不要删除实体或调暗环境掩盖问题。未声明/null/[]保持旧图。只替换有实际依据的灯具发光面，不能凭空用发光面制造窗户/天空；独立验收和帧率门槛保持。';
