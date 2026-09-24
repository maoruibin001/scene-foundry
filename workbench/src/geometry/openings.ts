import {compileGeometryProgram,transformPoint,type GeometryProgram} from './program';
import {rayScene} from './camera-fit';
type Vec=[number,number,number];
/** 坐标绑定到实例的局部空间，复用模板、平移旋转和缩放后仍保留净空约束。 */
export type SpatialOpening={id:string;label:string;instanceId:string;center:Vec;normal:Vec;up:Vec;width:number;height:number;clearDepth:number;expectedBeyond:'geometry'|'open-background'|'unknown';beyondDescription:string;referenceIndices:number[];evidence:string};
const number={type:'number'},str={type:'string'},vec={type:'array',items:number,minItems:3,maxItems:3};
const obj=(properties:any)=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
export function openingsSchema(){return {type:'array',maxItems:32,items:obj({id:str,label:str,instanceId:str,center:vec,normal:vec,up:vec,width:number,height:number,clearDepth:number,expectedBeyond:{type:'string',enum:['geometry','open-background','unknown']},beyondDescription:str,referenceIndices:{type:'array',items:{type:'integer'}},evidence:str})};}
const assert=(ok:any,message:string)=>{if(!ok)throw Error('空间开口：'+message)};
const dot=(a:number[],b:number[])=>a.reduce((s,v,k)=>s+v*b[k],0);
const cross=(a:Vec,b:Vec):Vec=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const add=(a:Vec,b:Vec,s:number):Vec=>a.map((v,k)=>v+b[k]*s) as Vec;
const finite=(n:any,min:number,max:number)=>Number.isFinite(n)&&n>=min&&n<=max;
const vector=(v:any)=>Array.isArray(v)&&v.length===3&&v.every(n=>finite(n,-100,100));
export function validateOpenings(openings:SpatialOpening[]|undefined,instances:{id:string}[],referenceCount:number){
 // 已冻结的旧记录可以没有此字段；缺失只代表没有几何检查依据，绝不视为通过。
 if(openings===undefined)return;
 assert(Array.isArray(openings)&&openings.length<=32,'最多声明32个关键开口');
 assert(new Set(openings.map(o=>o.id)).size===openings.length,'ID重复');
 for(const o of openings){
  assert(/^[a-zA-Z][a-zA-Z0-9_-]{0,55}$/.test(o.id)&&instances.some(i=>i.id===o.instanceId),'ID或所属实例无效');
  assert([o.label,o.evidence,o.beyondDescription].every(s=>typeof s==='string'&&s.trim()),'缺少名称、参考依据或后景说明');
  assert(vector(o.center)&&vector(o.normal)&&vector(o.up),'局部坐标无效');
  assert(Math.abs(Math.hypot(...o.normal)-1)<.001&&Math.abs(Math.hypot(...o.up)-1)<.001&&Math.abs(dot(o.normal,o.up))<.001,'朝向与上方向必须为正交单位向量');
  assert(finite(o.width,.05,100)&&finite(o.height,.05,100)&&finite(o.clearDepth,.02,50),'尺寸或净空深度无效');
  assert(['geometry','open-background','unknown'].includes(o.expectedBeyond),'后景类型无效');
  assert(Array.isArray(o.referenceIndices)&&new Set(o.referenceIndices).size===o.referenceIndices.length&&o.referenceIndices.every(i=>Number.isInteger(i)&&i>=1&&i<=referenceCount)&&(referenceCount===0||o.referenceIndices.length>0),'参考图片依据无效');
 }
}
export function validateOpeningBounds(openings:SpatialOpening[]|undefined,instances:{id:string;template:string}[],templates:{id:string;bounds:{min:number[];max:number[]}}[]){
 for(const o of openings??[]){
  const instance=instances.find(i=>i.id===o.instanceId)!,bounds=templates.find(t=>t.id===instance.template)!.bounds,right=cross(o.up,o.normal);
  for(const u of [-.5,.5])for(const v of [-.5,.5]){
   const corner=add(add(o.center,right,u*o.width),o.up,v*o.height);
   assert(corner.every((n,k)=>{const tolerance=Math.max(.03,(bounds.max[k]-bounds.min[k])*.05);return n>=bounds.min[k]-tolerance&&n<=bounds.max[k]+tolerance;}),'开口内区脱离所属模板局部边界：'+o.id);
  }
 }
}
export function openingSummary(report:ReturnType<typeof inspectOpenings>){return {...report,checks:report.checks.map(({samples,...check})=>check)};}
export const OPENINGS_PROMPT=`spatialOpenings 必须列出输入中影响空间纵深的关键门洞、窗洞或通透结构；确实没有时填空数组，不为凑数创造开口。每项包含 id、中文label、instanceId、center、normal、up、width、height、clearDepth、expectedBeyond、beyondDescription、referenceIndices、evidence。
center、normal、up、width、height、clearDepth 全部使用所属instance的模板局部坐标，实例变换由程序统一施加。center在洞口近侧平面中心，normal为从近侧穿过洞口指向后方的单位方向，up为洞口平面内正交的单位上方向。width/height描述需保持通透的矩形内区，避开边框；拱形按拱内可通行矩形记录，不包含实体拱肩。clearDepth以米声明从近侧向后必须留空的最小深度，不包括本来可见的远处后墙。只检查输入明确要求通透的区域；关闭的门板、百叶和刻意遮挡不声明为净空。
expectedBeyond为geometry（后方确有可见环境）、open-background（图中确为空天等背景）或unknown（不能判断）。beyondDescription说明可见后景、纵深及由哪个模板负责；referenceIndices标记依据图片，纯文字输入填空；evidence用中文区分观察与推断。后景需要实际三维内容及多视角关系，不能用整图平面填充。不要把开口净空和远处背景混为同一实体。
这些声明随后用于真实网格检查；不能通过缩小开口、减少净空深度或删除声明掩盖错误。声明与检查均不是还原分数，最终仍按Engine实际画面验收。`;

/** 25条双面射线测量不透明网格；局部净空是结构契约，后景命中仅作诊断。 */
export function inspectOpenings(scene:{program:GeometryProgram;spatialOpenings?:SpatialOpening[]},options:{assetTemplateId?:string}={}){
 const openings=(scene.spatialOpenings??[]).filter(o=>!options.assetTemplateId||scene.program.instances.find(i=>i.id===o.instanceId)?.template===options.assetTemplateId);
 const report={version:'opening-rays-v1',scope:options.assetTemplateId?'asset-self':'assembled-scene',status:scene.spatialOpenings===undefined?'not-declared':openings.length?'checked':'not-applicable',method:'沿每个净空内区的法线方向采样25条双面射线；只测alpha>=0.95的不透明几何。只检测声明的开口，不证明轮廓、透视、光照或图像相似度；后景命中不证明内容正确。',checks:[] as any[]};
 if(!openings.length)return report;
 const p=scene.program,program={...p,materials:p.materials.map(m=>({...m,textureId:null})),...(options.assetTemplateId?{templates:p.templates.filter(t=>t.id===options.assetTemplateId),instances:p.instances.filter(i=>i.template===options.assetTemplateId)}:{})};
 const meshes=compileGeometryProgram(program).meshes.filter(m=>(m.geometry.material?.surface?.baseColor?.[3]??1)>=.95);
 const sharedCast=options.assetTemplateId?null:rayScene(meshes,{near:1e-5,doubleSided:true});
 for(const o of openings){
  const instance=p.instances.find(i=>i.id===o.instanceId)!;
  const cast=sharedCast??rayScene(meshes.filter(m=>m.entityId===o.instanceId),{near:1e-5,doubleSided:true});
  const right=cross(o.up,o.normal),samples:any[]=[],blockers:Record<string,number>={};let blocked=0,emptyBeyond=0;
  const startOffset=.02,fromCenter=transformPoint(add(o.center,o.normal,-startOffset),instance),toCenter=transformPoint(add(o.center,o.normal,o.clearDepth),instance);
  const delta=toCenter.map((v,k)=>v-fromCenter[k]),limit=Math.hypot(...delta),direction=delta.map(v=>v/limit);
  for(const u of [-.4,-.2,0,.2,.4])for(const v of [-.4,-.2,0,.2,.4]){
   const local=add(add(add(o.center,right,u*o.width),o.up,v*o.height),o.normal,-startOffset),origin=transformPoint(local,instance),hit=cast(origin,direction);
   const isBlocked=!!hit&&hit.distance<limit-1e-4;if(isBlocked){blocked++;blockers[hit!.meshId]=(blockers[hit!.meshId]??0)+1;}if(!hit)emptyBeyond++;
   samples.push({uv:[u+.5,v+.5],blocked:isBlocked,hit:hit?{meshId:hit.meshId,distance:Number(hit.distance.toFixed(4))}:null});
  }
  const blockedFraction=blocked/25,emptyBeyondFraction=emptyBeyond/25;
  report.checks.push({id:o.id,label:o.label,instanceId:o.instanceId,clearDepth:o.clearDepth,expectedBeyond:o.expectedBeyond,beyondDescription:o.beyondDescription,blockedFraction,emptyBeyondFraction,status:blockedFraction>=.8?'blocked':!options.assetTemplateId&&o.expectedBeyond==='geometry'&&emptyBeyondFraction>=.8?'missing-background':blockedFraction>.2?'partially-obstructed':'clear',blockers,samples});
 }
 return report;
}
export function assertAssetOpenings(scene:{program:GeometryProgram;spatialOpenings?:SpatialOpening[]},templateId:string){
 const report=inspectOpenings(scene,{assetTemplateId:templateId}),failed=report.checks.filter(c=>c.status==='blocked');
 assert(!failed.length,'资产自身封堵已冻结净空：'+JSON.stringify(failed.map(c=>({id:c.id,blockedFraction:c.blockedFraction,blockers:c.blockers}))));return report;
}
