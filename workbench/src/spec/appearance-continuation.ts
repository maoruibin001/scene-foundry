import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {callSpecNode,type NodeModel} from './node-models';
import {continueSpec,specDigest} from './continuation';
import type {SceneSpec} from './schema';
import type {SpecRevision} from './revise';
export const APPEARANCE_VERSION='source-appearance-continuation-v1';
export const APPEARANCE_SCHEMA={"type":"object","additionalProperties":false,"required":["id","summary","patches"],"properties":{"id":{"type":"string"},"summary":{"type":"string"},"patches":{"type":"array","minItems":1,"maxItems":40,"items":{"type":"object","additionalProperties":false,"required":["target","id","set","reason"],"properties":{"target":{"type":"string","enum":["material","sourceLightingMode","state","post","light","addLight"]},"id":{"type":"string"},"set":{"type":"object","additionalProperties":true},"reason":{"type":"string"}}}}}};
export function applyAppearanceRevision(spec:SceneSpec,revision:SpecRevision){
 const fields:Record<string,string[]>={material:['baseColor','metallic','roughness','emissive','emissiveIntensity','transmission','ior','thickness','clearcoat','clearcoatRoughness','opacity','surface'],sourceLightingMode:['lightingMode'],state:['ambient','background'],post:['tonemap','exposure','bloom','gtao','ssr','fog','planarReflections','reflectionProbe','cameraFx','volumetric'],light:['position','direction','color','intensity','range','innerConeDeg','outerConeDeg','width','height','castShadow'],addLight:['kind','position','direction','color','intensity','range','innerConeDeg','outerConeDeg','width','height','castShadow']};
 for(const p of revision.patches){if(!fields[p.target]||Object.keys(p.set).some(k=>!fields[p.target].includes(k)))throw Error('APPEARANCE_PATCH_OUT_OF_SCOPE');if(p.target==='material'&&p.set.surface&&String((p.set.surface as any).pattern).startsWith('polyhaven:'))throw Error('APPEARANCE_EXTERNAL_ASSET_NOT_ADMITTED');}
 const r=continueSpec(spec,{baseSpecSha256:specDigest(spec),revision});
 if(JSON.stringify(r.spec.objects)!==JSON.stringify(spec.objects)||JSON.stringify(r.spec.families)!==JSON.stringify(spec.families)||JSON.stringify(r.spec.shots)!==JSON.stringify(spec.shots)||JSON.stringify(r.spec.bounds)!==JSON.stringify(spec.bounds))throw Error('APPEARANCE_GEOMETRY_CHANGED');
 for(const st of r.spec.lighting.states){if(st.post.volumetric&&st.post.volumetric.extinction>.012)throw Error('APPEARANCE_FOG_TOO_DENSE');if(st.lights.filter(l=>l.kind==='spot'&&l.castShadow).length>2)throw Error('APPEARANCE_SHADOW_BUDGET');}
 return r;
}
export async function repairAppearance(spec:SceneSpec,review:any,images:{path:string;mime:string}[],dir:string,selection:NodeModel,signal?:AbortSignal){
 if(review?.evidence?.status!=='visible'||!Number.isFinite(review.overall)||images.length<2)throw Error('APPEARANCE_REAL_REVIEW_REQUIRED');
 mkdirSync(dir,{recursive:true});
 const system=`你是通用场景生成管线的材质与灯光修订节点。分析实际概念图与真实渲染图及独立视觉失败报告，输出一轮受控规格修订，目标超过70分。不得移动、增删或重建任何几何，不改镜头/尺度/交互，不用重新措辞规避问题。只改给定ID的材料、灯光状态及后期。sourceEnvironment存在且lightingMode为preserve时，原生光照会覆盖规格灯光；需要优化光照必须显式用sourceLightingMode补丁设置lightingMode=spec，不能宣称未生效的参数产生改进。坐标规格Z向上；保持全部几何。使用已有生成器的surface panel/plate/grate/concrete/deck/worn/trim贴图细节，UV周期单位为每米；不把所有物体铺同种贴图，不给灯带或陶瓷乱加金属噪声。真实天光束须有post.fog绑定本状态内存在的定向/聚光灯与post.volumetric；雾extinction<=0.012，不靠乳白浓雾盖住场景。灯光位置/范围需覆盖实际场景尺度，顶光与暖色灯带形成因果层次，保留青色核心与主体。必要时用ssr/gtao增强反射与接触，避免引入GI重构或新增多盏投影灯；投影聚光最多2盏。避免近场发光过曝，保留主体细节。主材质颜色有依据地校准但不要把所有表面简单涂黑。每条补丁说明针对哪个真实图像问题以及为何有望改善。不得评价自己的输出为通过，后续由真实Engine与独立评委判断。state补丁只含ambient/background；post补丁id=*作用全部光照状态；light只修改已有灯，addLight须唯一ID；增加的灯需完整kind/position/direction/color/intensity/range/innerConeDeg/outerConeDeg/width/height/castShadow字段（不适用项null）。材料保留未修改字段。`; 
 const result=await callSpecNode({system,text:JSON.stringify({mechanism:APPEARANCE_VERSION,review,scene:{name:spec.name,bounds:spec.bounds,materials:spec.materials,lighting:spec.lighting,sourceEnvironment:spec.sourceEnvironment,shots:spec.shots},geometrySummary:spec.objects.map(o=>({id:o.id,label:o.label,transform:o.transform})),target:{overall:70,dimensionFloor:2,geometry:'frozen'}}),images,role:'spec-appearance-repair',signal},dir,selection,APPEARANCE_SCHEMA);
 const revision=JSON.parse(result.text),out=applyAppearanceRevision(spec,revision);
 for(const [name,value] of [['revision.json',revision],['continuation.json',out.receipt],['revised-spec.json',out.spec]])writeFileSync(join(dir,name as string),JSON.stringify(value,null,2));
 return out;
}
