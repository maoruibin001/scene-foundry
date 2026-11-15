import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {callSpecNode,nodeCacheHash,type NodeModel} from './node-models';
import {DATA} from '../store';
import {validateSceneSpec,type SceneSpec} from './schema';
const allowed={material:['baseColor','metallic','roughness','emissive','emissiveIntensity','transmission','ior','thickness','clearcoat','clearcoatRoughness','opacity','surface'],state:['ambient','background'],light:['color','intensity','range','innerConeDeg','outerConeDeg','castShadow','width','height'],post:['exposure','bloom','fog','volumetric','reflectionProbe','ssr','cameraFx']} as const;
export const APPEARANCE_SCHEMA={type:'object',additionalProperties:false,required:['observations','summary','patches'],properties:{observations:{type:'array',items:{type:'object',additionalProperties:false,required:['imageIndex','description'],properties:{imageIndex:{type:'integer',minimum:0},description:{type:'string'}}}},summary:{type:'string'},patches:{type:'array',maxItems:60,items:{type:'object',additionalProperties:false,required:['target','id','state','valuesJson','reason'],properties:{target:{type:'string',enum:Object.keys(allowed)},id:{type:'string'},state:{type:['string','null']},valuesJson:{type:'string'},reason:{type:'string'}}}}}};
export function applyAppearanceRepair(source:SceneSpec,answer:any,imageCount:number){
 const seen=new Set<number>();for(const o of answer.observations??[]){if(!Number.isInteger(o.imageIndex)||o.imageIndex<0||o.imageIndex>=imageCount||seen.has(o.imageIndex)||typeof o.description!=='string'||o.description.length<8)throw Error('APPEARANCE_PIXELS_UNVERIFIED');seen.add(o.imageIndex);}if(seen.size!==imageCount)throw Error('APPEARANCE_PIXELS_UNVERIFIED');
 const spec=structuredClone(source),decisions=[];
 if(!Array.isArray(answer.patches)||answer.patches.length>60)throw Error('APPEARANCE_PATCH_INVALID');
 for(const p of answer.patches){const keys=allowed[p.target as keyof typeof allowed] as readonly string[]|undefined,values=JSON.parse(p.valuesJson);
  if(!keys||!values||Array.isArray(values)||typeof values!=='object'||!Object.keys(values).length||Object.keys(values).some(k=>!keys.includes(k))||typeof p.reason!=='string'||p.reason.length<12)throw Error('APPEARANCE_PATCH_INVALID：越过材质/光照边界');
  const state=spec.lighting.states.find(s=>s.id===p.state);let destination:any;
  if(p.target==='material')destination=spec.materials.find(m=>m.id===p.id);
  else if(p.target==='state')destination=state;
  else if(p.target==='post')destination=state?.post;
  else destination=state?.lights.find(l=>l.id===p.id);
  if(!destination)throw Error('APPEARANCE_PATCH_INVALID：未知目标');
  // Fog source/density region and reflection plane cannot be relocated by the look model.
  if(values.fog&&JSON.stringify([values.fog.light,values.fog.boundsMin,values.fog.boundsMax])!==JSON.stringify([state?.post.fog?.light,state?.post.fog?.boundsMin,state?.post.fog?.boundsMax]))throw Error('APPEARANCE_PATCH_INVALID：不能移动雾源或包络');
  const before=Object.fromEntries(Object.keys(values).map(k=>[k,destination[k]]));Object.assign(destination,values);decisions.push({...p,values,before,basis:'design_fill'});
 }
 validateSceneSpec(spec);
 // These invariants are intentionally stronger than reviseSpec: no object/family/requirements edits.
 for(const key of ['objects','families','bounds','acceptance','constraints','shots'] as const)if(JSON.stringify(source[key])!==JSON.stringify(spec[key]))throw Error('APPEARANCE_GEOMETRY_CHANGED');
 return {spec,receipt:{version:'image-led-appearance-v1',summary:answer.summary,observations:answer.observations,decisions}};
}
const SYSTEM=`你是通用实时三维管线的材质与灯光修正节点。前面是原始概念参考，后面是上一候选的真实 Engine 截图。逐图确认像素，找出光学/材质差异，再提出一份克制且完整的物理修订方案。不是给分节点，不预测或伪造分数。
只改给出的现有材质、现有光照状态和现有灯的允许字段；不能改变对象/资产族/几何、物体位置/尺寸/数量、机位、需求或原图。明示的几何形状优先于参考图差异，不能靠消除结构提分。以镜面环境高光、粗糙度分区、清透玻璃、湿区反射、冷暖照明因果和景深空气感为目标，保持可读的暗部与明暗对比，避免全场过亮、过雾或发光覆盖表面。光源位置不可动。未指定的值保持原样。每条值必须合法，并以中文说明画面证据、原值问题和设计补全。valuesJson为局部字段JSON；嵌套对象须完整给出，不使用未知字段。state为一个已有状态ID；材质state=null。材质surface可为null保留光滑，或{pattern,tilesPerMeter,normalStrength:0..2}。程序化法线不是额外几何；抛光表面避免高强度细碎法线。灯光使用已有种类与位置，不准创建无因果补光。若概念包含多状态，不把动作/燃烧效果强加静态状态。`;
export async function repairSpecAppearance(source:SceneSpec,context:{references:{path:string;mime:string}[];screenshots:{path:string;mime:string}[];review:any},dir:string,model:NodeModel,signal?:AbortSignal){
 const images=[...context.references,...context.screenshots];if(!context.references.length||!context.screenshots.length)throw Error('APPEARANCE_REFERENCE_MISSING');
 const text=JSON.stringify({referenceCount:context.references.length,previousReview:context.review,materials:source.materials,lighting:source.lighting,materialAssignments:source.families.map(f=>({label:f.label,slots:f.materialSlots})),allowed,rule:'原始几何与需求冻结；每条为显式design_fill；独立评审不会看到你的方案或主张'}),key=nodeCacheHash(SYSTEM,text,'',APPEARANCE_SCHEMA,model,images),cache=join(DATA,'specs','appearance-repairs',key+'.json');mkdirSync(join(DATA,'specs','appearance-repairs'),{recursive:true});mkdirSync(dir,{recursive:true});
 const reused=existsSync(cache),result=reused?JSON.parse(readFileSync(cache,'utf8')):await callSpecNode({system:SYSTEM,text,images,role:'spec-appearance-repair',signal},dir,model,APPEARANCE_SCHEMA);
 const applied=applyAppearanceRepair(source,JSON.parse(result.text),images.length);if(!reused)writeFileSync(cache,JSON.stringify({...result,sourceCallDir:dir}));
 const receipt={...applied.receipt,model,route:result.receipt,reused,sourceCallDir:result.sourceCallDir??dir,cacheKey:key};writeFileSync(join(dir,'appearance-repair.json'),JSON.stringify(receipt,null,2));return {...applied,receipt};
}
