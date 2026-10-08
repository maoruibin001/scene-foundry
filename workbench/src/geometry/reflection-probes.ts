/** Static local specular capture supported by the fixed Engine. Not diffuse GI. */
export type SceneReflectionProbe={position:number[];halfExtents:number[];intensity:number;resolution:64|128};
const vector=(min:number,max:number)=>({type:'array',items:{type:'number',minimum:min,maximum:max},minItems:3,maxItems:3});
export const reflectionProbeSchema=()=>({anyOf:[{type:'array',maxItems:2,items:{type:'object',additionalProperties:false,required:['position','halfExtents','intensity','resolution'],properties:{position:vector(-100,100),halfExtents:vector(.1,100),intensity:{type:'number',minimum:0,maximum:2},resolution:{type:'integer',enum:[64,128]}}}},{type:'null'}]});
export function validateReflectionProbes(value:unknown):asserts value is SceneReflectionProbe[]|null|undefined{
 if(value==null)return;
 const finite=(v:any,a:number,b:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=a&&v<=b;
 const vec=(v:any,a:number,b:number)=>Array.isArray(v)&&v.length===3&&v.every(n=>finite(n,a,b));
 if(!Array.isArray(value)||value.length>2||value.some(p=>!p||typeof p!=='object'||Object.keys(p).some(k=>!['position','halfExtents','intensity','resolution'].includes(k))||!vec(p.position,-100,100)||!vec(p.halfExtents,.1,100)||!finite(p.intensity,0,2)||![64,128].includes(p.resolution)))throw Error('局部环境反射参数无效');
}
export function reflectionProbeEntities(probes?:SceneReflectionProbe[]|null){
 validateReflectionProbes(probes);
 return Object.fromEntries((probes??[]).map((p,i)=>['localReflection'+i,{components:{Transform:{pos:[p.position[0],p.position[2],-p.position[1]]},ReflectionProbe:{halfExtents:[p.halfExtents[0],p.halfExtents[2],p.halfExtents[1]],priority:0,boxProjection:true,intensity:p.intensity,resolution:p.resolution,updateIntent:0,invalidationVersion:1}}}]));
}
const replaceOne=(source:string,from:string,to:string)=>{if(source.split(from).length!==2)throw Error('局部环境反射导出契约变化');return source.replace(from,to);};
export function bindReflectionProbes(world:string,probes?:SceneReflectionProbe[]|null){
 const entries=Object.entries(reflectionProbeEntities(probes));if(!entries.length)return world;
 const imports=[...world.matchAll(/import \{([^;\n]+) \} from '@forgeax\/engine\/render';/g)];
 if(imports.length!==1||!imports[0][1].split(',').some(s=>s.trim()==='perspective'))throw Error('局部环境反射导出契约变化');
 world=replaceOne(world,imports[0][0],`import {${imports[0][1]}, ReflectionProbe, REFLECTION_PROBE_UPDATE_ONCE } from '@forgeax/engine/render';`);
 world=replaceOne(world,'Name,Transform]','ReflectionProbe,Name,Transform]');
 const entities=entries.map(([id,value])=>id+':'+JSON.stringify(value).replace('"updateIntent":0','"updateIntent":REFLECTION_PROBE_UPDATE_ONCE')+',').join('');
 return replaceOne(world,'ambient:{components:',entities+'ambient:{components:');
}
/** ReflectionProbe is public but absent from this Engine pin's builtin component plugin. */
export const REFLECTION_COMPONENT_BOOTSTRAP=`import {ReflectionProbe} from '@forgeax/engine/render';
import type {Plugin} from '@forgeax/engine/plugin';
export default {name:'scene/reflection-components',inject:['world'],apply(ctx){ctx.effect(()=>{const lease=ctx.world.components.register(ReflectionProbe).unwrap();return()=>{lease.dispose().unwrap();};},'scene/reflection-components');}} satisfies Plugin;`;
export const REFLECTION_PROBE_RULES=`可选lighting.reflectionProbes为null或最多2个静态局部环境反射探针。每项position与halfExtents为Z向上米制坐标/正半尺寸，intensity为0..2，resolution为64或128。探针从实际场景捕获六面环境并按粗糙度过滤，提供有包围盒校正的局部镜面环境反射；只选实际净空位置与覆盖所需表面的房间边界，不放进墙、桌面或柱体，不跨越无关房间。这不会新增光源、漫反射间接光/GI、bloom或透射，不能靠增加intensity代替正确地面颜色和真实受光。未设置保持旧图；根据原图中的反射和真实Engine预览决定是否使用。捕获需GPU时间，使用一次更新，独立采集会等待真实GPU帧完成并保留等待回执；这不是逐探针内部状态证明；数量和分辨率不是质量越高越好。`;
