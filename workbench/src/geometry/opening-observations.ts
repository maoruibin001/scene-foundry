import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {callValidated} from '../contracts';
import {save,event,digest} from '../store';
import {openingsSchema,validateOpenings,validateOpeningBounds,OPENINGS_PROMPT,inspectOpenings} from './openings';
import {spatialContext} from './spatial-refinement';
import type {SceneInput} from './scene-contract';
const obj=(properties:any)=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
export function openingObservationSchema(){return obj({version:{type:'string',enum:['opening-observations-v1']},spatialOpenings:openingsSchema(),uncertainty:{type:'array',items:{type:'string'},maxItems:16}});}
export function openingObservationContext(scene:SceneInput){
 const c=spatialContext(scene);
 return {...c,templates:c.templates.map(t=>({id:t.id,localBounds:t.localBounds,parts:t.parts.map(p=>({id:p.id,localBounds:p.localBounds,material:p.material}))})),materials:scene.program.materials.map(m=>({id:m.id,opacity:m.color[3]}))};
}
export function applyOpeningObservation(source:SceneInput,value:any,references:number,context=openingObservationContext(source)){
 if(source.spatialOpenings!==undefined)throw Error('已冻结的开口声明不能被观察步骤覆盖');
 if(value?.version!=='opening-observations-v1'||!Array.isArray(value.spatialOpenings)||!Array.isArray(value.uncertainty)||value.uncertainty.length>16||value.uncertainty.some((s:any)=>typeof s!=='string'))throw Error('开口观察契约无效');
 validateOpenings(value.spatialOpenings,source.program.instances,references);
 validateOpeningBounds(value.spatialOpenings,source.program.instances,context.templates.map(t=>({id:t.id,bounds:t.localBounds})));
 return {...structuredClone(source),spatialOpenings:structuredClone(value.spatialOpenings),assumptions:[...source.assumptions,...value.uncertainty]};
}
export const OPENING_OBSERVATION_PROMPT=`为尚未声明空间净空的历史场景建立开口约束。原始参考图在前，当前ForgeaX Engine实际运行截图在后。仅返回opening-observations-v1，包含spatialOpenings和uncertainty；所有说明使用中文，不调用工具，不修改几何、相机、评分或原始要求。
结合原图中确实存在的通透关系，在当前实例和模板局部坐标中定位关键开口。当前截图只用来定位已有物体与识别错误，不能把其中封堵或缺失后景当成原图要求。输入localBounds为真实编译后的部件/模板局部范围，instances是局部到世界变换，二者不要混用；材料opacity有助于识别玻璃，不把玻璃面当实心墙。
优先覆盖影响整体纵深和构图的通透区域，避免把每个窗格都拆成大量重复条目。正向法线从相机所在一侧穿过开口向后；不要穿过本来关闭的门、框、柱或不可见区域。后景说明要明确可见内容与估计深度；不臆造整间隐藏房间。无法可靠定位的区域在uncertainty中说明，不捏造坐标。不要只挑容易通过的开口，当前已经被错误几何堵住的开口同样应标记。
${OPENINGS_PROMPT}`;
export async function observeOpenings(job:any,source:SceneInput,review:any,images:{path:string;mime:string}[],frames:{path:string;mime:string;name:string}[],folder:string,signal:AbortSignal){
 if(source.spatialOpenings!==undefined)return source;
 const context=openingObservationContext(source),dir=join(folder,'openings');mkdirSync(dir,{recursive:true});
 const input={originalPrompt:job.prompt,referenceImages:images.length,actualFrameNames:frames.map(f=>f.name),review,scene:context};
 save(join(dir,'input.json'),input);event(job,'opening-observation','从原图和实际几何建立通用开口约束，保留全部既有资产');
 const result=await callValidated({role:'scene-openings',modelSettings:job.modelSettings,signal,maxTokens:7000,images:[...images,...frames],system:OPENING_OBSERVATION_PROMPT,text:JSON.stringify(input)},dir,v=>{applyOpeningObservation(source,v,images.length,context);return v;});
 const scene=applyOpeningObservation(source,result.value,images.length,context),report=inspectOpenings(scene);
 save(join(dir,'observations.json'),result.value);save(join(dir,'diagnostics.json'),report);save(join(dir,'receipt.json'),{sourceDigest:digest(JSON.stringify(source)),observationsDigest:digest(JSON.stringify(result.value)),source:'模型根据原始图片、实际运行截图与编译范围推断；未经图像相似度验证',modelReceipt:result.receipt});return scene;
}
