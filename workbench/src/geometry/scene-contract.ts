import {geometryProgramSchema,GEOMETRY_RULES} from './program-schema';
import {validateGeometryProgram,type GeometryProgram} from './program';
import {openingsSchema,validateOpenings,OPENINGS_PROMPT,type SpatialOpening} from './openings';
const num={type:'number'},str={type:'string'},vector={type:'array',items:num,minItems:3,maxItems:3};
const arr=(items:any)=>({type:'array',items}),obj=(properties:any)=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
// 语义类别是显示和计数用的文本，不是资产 ID、文件名或路径。
const categoryPattern='^[^\\s\\u0000-\\u001f\\u007f-\\u009f](?:[^\\u0000-\\u001f\\u007f-\\u009f]{0,54}[^\\s\\u0000-\\u001f\\u007f-\\u009f])?$';
const categorySchema={type:'string',minLength:1,maxLength:56,pattern:categoryPattern,description:'自由定义的中文语义类别，同类实体使用相同名称；不含首尾空白或控制字符。'};
export function semanticCounts(entities:{category:string}[]):Record<string,number>{
 const counts:Record<string,number>=Object.create(null);
 for(const e of entities)counts[e.category]=(counts[e.category]??0)+1;
 return counts;
}
export type SceneInput={spatialOpenings?:SpatialOpening[];textureReuse?:{textureId:string;assetId:string;reason:string}[];version:'scene-v1';program:GeometryProgram;entities:{instanceId:string;role:'subject'|'context'|'ground';category:string}[];cameras:{name:string;referenceIndex:number|null;position:number[];target:number[];fov:number}[];textures:{id:string;referenceIndex:number;quad:number[][];size:number;description:string}[];lighting:{direction:number[];color:number[];intensity:number;ambientColor:number[];ambientIntensity:number;points:{position:number[];color:number[];intensity:number;range:number}[]};assumptions:string[]};
export function sceneSchema(ids?:string[]){return obj({spatialOpenings:openingsSchema(),textureReuse:arr(obj({textureId:str,assetId:str,reason:str})),version:{type:'string',enum:['scene-v1']},program:geometryProgramSchema(ids),entities:arr(obj({instanceId:str,role:{type:'string',enum:['subject','context','ground']},category:categorySchema})),cameras:arr(obj({name:str,referenceIndex:{type:['integer','null']},position:vector,target:vector,fov:num})),textures:arr(obj({id:str,referenceIndex:{type:'integer'},quad:{type:'array',minItems:4,maxItems:4,items:{type:'array',minItems:2,maxItems:2,items:num}},size:{type:'integer',enum:[256,512]},description:str})),lighting:obj({direction:vector,color:vector,intensity:num,ambientColor:vector,ambientIntensity:num,points:arr(obj({position:vector,color:vector,intensity:num,range:num}))}),assumptions:arr(str)});}
const assert=(ok:any,message:string)=>{if(!ok)throw Error(message)};
const finite=(n:any,min:number,max:number)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
const vec=(v:any,min=-100,max=100)=>Array.isArray(v)&&v.length===3&&v.every(n=>finite(n,min,max));
export function validateScene(s:SceneInput,plan:any,referenceCount:number){
 assert(s?.version==='scene-v1','场景数据版本无效');validateGeometryProgram(s.program,plan.requirements.map((r:any)=>r.id));
 validateSceneContext(s,plan,referenceCount);return s;
}
/** 共享布局和最终几何使用同一份机位、材质来源与需求绑定检查。 */
export function validateSceneContext(s:Omit<SceneInput,'version'|'program'>&{program:Pick<GeometryProgram,'instances'|'materials'>},plan:any,referenceCount:number){
 validateSceneTopology(s,plan,referenceCount);
 assert(Array.isArray(s.textures),'贴图声明须为数组');
 assert(s.textures.length<=24,'贴图数量超限：最多 24 个声明，实际 '+s.textures.length+' 个；优先复用正确贴图，保留仍被材质引用的资源');
 assert(new Set(s.textures.map(t=>t.id)).size===s.textures.length,'贴图声明 ID 重复');
 for(const t of s.textures){
  assert(/^[a-zA-Z][a-zA-Z0-9_-]{0,55}$/.test(t.id)&&Number.isInteger(t.referenceIndex)&&t.referenceIndex>=1&&t.referenceIndex<=referenceCount&&[256,512].includes(t.size)&&typeof t.description==='string'&&t.description.trim(),'贴图引用无效');
  assert(Array.isArray(t.quad)&&t.quad.length===4&&t.quad.every(p=>Array.isArray(p)&&p.length===2&&p.every(n=>finite(n,0,1))),'贴图四角须为完整原图的归一化坐标');
  const cross=t.quad.map((a,i)=>{const b=t.quad[(i+1)%4],c=t.quad[(i+2)%4];return (b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);});
  assert(cross.every(x=>x>1e-8)||cross.every(x=>x< -1e-8),'贴图四角顺序错误或形状退化');
  const area=Math.abs(t.quad.reduce((n,a,i)=>{const b=t.quad[(i+1)%4];return n+a[0]*b[1]-a[1]*b[0]},0)/2);
  assert(area>=.00005&&area<=.3,'贴图片段过小或覆盖整幅场景，不能用整图面板代替三维结构');
 }
 const reuse=s.textureReuse??[];assert(Array.isArray(reuse)&&new Set(reuse.map(x=>x.textureId)).size===reuse.length&&reuse.every(x=>s.textures.some(t=>t.id===x.textureId)&&/^[a-f0-9]{64}$/.test(x.assetId)&&typeof x.reason==='string'&&x.reason.trim()),'材质复用声明无效');
 for(const m of s.program.materials)if(m.textureId)assert(s.textures.some(t=>t.id===m.textureId),'材质引用了未声明的图像片段');
 const light=s.lighting;assert(light&&vec(light.direction,-1,1)&&Math.hypot(...light.direction)>.01&&vec(light.color,0,1)&&vec(light.ambientColor,0,1)&&finite(light.intensity,0,8)&&finite(light.ambientIntensity,.02,2)&&Array.isArray(light.points)&&light.points.length<=16,'光照参数无效');
 for(const p of light.points)assert(vec(p.position)&&vec(p.color,0,1)&&finite(p.intensity,0,10)&&finite(p.range,.1,30),'局部光照参数无效');
 assert(Array.isArray(s.assumptions)&&s.assumptions.every(x=>typeof x==='string'),'推断说明无效');return s;
}
export function validateSceneTopology(s:Pick<SceneInput,'entities'|'cameras'|'assumptions'>&{program:Pick<GeometryProgram,'instances'>},plan:any,referenceCount:number){
 validateOpenings((s as any).spatialOpenings,s.program.instances,referenceCount);
 const instances=new Map(s.program.instances.map(i=>[i.id,i]));
 assert(Array.isArray(s.entities)&&s.entities.length===instances.size&&new Set(s.entities.map(e=>e.instanceId)).size===instances.size,'语义实体与几何实例须一一对应');
 for(const e of s.entities)assert(instances.has(e.instanceId)&&['subject','context','ground'].includes(e.role)&&typeof e.category==='string'&&new RegExp(categoryPattern).exec(e.category)?.[0]===e.category,'实体分类无效');
 assert(s.entities.some(e=>e.role==='subject'),'场景缺少主体');
 for(const r of plan.requirements){const matching=s.program.instances.filter(i=>i.requirementIds.includes(r.id));if(r.critical)assert(matching.length>0,'关键需求未绑定任何几何：'+r.id);if(r.count!=null)assert(matching.length===r.count,'明确数量与实例不符：'+r.id);}
 assert(Array.isArray(s.cameras)&&s.cameras.length>=Math.max(2,referenceCount)&&s.cameras.length<=6,'需要全部参考机位及至少两个不同观察位置，最多六个');
 for(const c of s.cameras)assert(typeof c.name==='string'&&c.name.trim()&&vec(c.position)&&vec(c.target)&&Math.hypot(...c.position.map((v,i)=>v-c.target[i]))>.1&&finite(c.fov,.3,2.2)&&(c.referenceIndex===null||Number.isInteger(c.referenceIndex)&&c.referenceIndex>=1&&c.referenceIndex<=referenceCount),'相机位置、视角或引用无效');
 for(let i=1;i<=referenceCount;i++)assert(s.cameras.filter(c=>c.referenceIndex===i).length===1,'每张参考图必须有且只有一个对应机位');
 assert(Math.max(...s.cameras.map(c=>Math.hypot(...c.position.map((v,i)=>v-s.cameras[0].position[i]))))>.2,'不同机位必须有真实平移');
 assert(Array.isArray(s.assumptions)&&s.assumptions.every(x=>typeof x==='string'),'推断说明无效');return s;
}
export const SCENE_RULES=`所有可见布局、材质片段、相机位置和补全均由当前输入决定，禁止依赖任何场景专用实现。
多图先确定共同空间结构，再安排相机与物件。墙体必须以门窗洞两侧和上下的实体组合，留出真正洞口；不能用完整墙板挡住视线。重要家具、设备、结构要通过轮廓、厚度、曲面及组合部件还原，不用一堆同样的箱子代替。建筑、主体、配件分层组合；同类物体复用模板。位置和材质来自当前图，不能借附加物件满足复杂度却遗漏原参考。
entities 为 program.instances 的逐一分类；category 使用自由定义的中文语义类别名称（1至56字符，无首尾空白或控制字符，同类实体使用相同名称），不作为资产ID或路径，role 标识 subject/context/ground。建筑或地面可作为 context/ground，关键物件为 subject。每个明确数量需求只由对应完整物体实例绑定，不让配件重复计数。
cameras 至少两个不同位置，最多六个；每张参考图必须有一个 referenceIndex 对应的相机，可增加 referenceIndex:null 的检查机位。坐标与 program 同为 Z 向上；fov 是垂直视场弧度。通过实际场景尺寸和图中的透视估计位置、朝向、镜头，不把相机放到墙里或靠远处俯视来掩盖细节。
textures 可从本次参考图提取最多 24 个局部材质片段：id、referenceIndex、quad、size、description。quad 是未裁剪原图上的四角归一化坐标，顺序为左上、右上、右下、左下，支持透视纠正；size 仅 256 或 512。优先选清楚、无遮挡的重复纹理或真实物件表面。不得包含水印、黑边、标注，不能取整幅图贴成背景冒充场景；每片最多原图 30% 面积。纹理是照片颜色，会包含原图光照，不称为完美无光照反射率。无图片时 textures 为空，不捏造资源。重复表面用部件 uvScale 控制尺度，避免巨大砖块、木纹拉伸；已贴图材质 color 通常用 [1,1,1,1]，按实物设置 roughness/metallic。
lighting 提供一个方向光 direction/color/intensity、ambientColor/ambientIntensity 和最多 16 个实际有依据的局部 points(position/color/intensity/range)。光照应还原输入的方向与层次，同时关键对象可辨。所有向量继续使用 Z 向上。assumptions 用中文列出不可见区域、相机和尺度估计；不把推断说成已观察事实。
`;
export const SCENE_PROMPT=`根据全部参考图和冻结需求，生成一个可自由观察的完整三维场景，返回 scene-v1 JSON。program 使用通用几何契约。\n${SCENE_RULES}\n${OPENINGS_PROMPT}\n${GEOMETRY_RULES}`;
