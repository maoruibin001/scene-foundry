import {compileGeometryProgram,transformPoint,type GeometryProgram,type Pose} from './program';

type Vec=[number,number,number];
type Instance=GeometryProgram['instances'][number];
/** points 属于 aId 的局部坐标；bId 的同一连接位置由冻结变换推导，避免两个模型各猜一套接口。 */
export type SpatialContact={id:string;label:string;kind:'support'|'seam';aId:string;bId:string;points:Vec[];referenceIndices:number[];evidence:string};
export const CONTACT_TOLERANCE_METERS=.03;
const num={type:'number'},str={type:'string'},vec={type:'array',items:num,minItems:3,maxItems:3};
const obj=(properties:any)=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
export function contactsSchema(){return {type:'array',maxItems:24,items:obj({id:str,label:str,kind:{type:'string',enum:['support','seam']},aId:str,bId:str,points:{type:'array',items:vec,minItems:1,maxItems:8},referenceIndices:{type:'array',items:{type:'integer'}},evidence:str})};}
const assert=(ok:any,message:string)=>{if(!ok)throw Error('空间连接：'+message)};
const sub=(a:number[],b:number[]):Vec=>a.map((v,k)=>v-b[k]) as Vec;
const dot=(a:number[],b:number[])=>a.reduce((s,v,k)=>s+v*b[k],0);
const squared=(a:number[],b:number[])=>dot(sub(a,b),sub(a,b));
const vector=(v:any):v is Vec=>Array.isArray(v)&&v.length===3&&v.every(n=>Number.isFinite(n)&&Math.abs(n)<=100);
export function localPoint(world:Vec,pose:Pose):Vec{
 const delta=sub(world,pose.position);
 return [0,1,2].map(k=>{const unit:Vec=[0,0,0];unit[k]=1;const basis=sub(transformPoint(unit,pose),pose.position);return dot(delta,basis)/dot(basis,basis);}) as Vec;
}
export function validateContacts(contacts:SpatialContact[]|undefined,instances:Instance[],referenceCount:number){
 // 旧记录没有声明不等于连接已检查；只在新生成入口要求明确数组。
 if(contacts===undefined)return;
 assert(Array.isArray(contacts)&&contacts.length<=24,'最多声明24处关键连接');
 const ids=new Set(instances.map(i=>i.id));
 assert(new Set(contacts.map(c=>c.id)).size===contacts.length,'ID重复');
 for(const c of contacts){
  assert(/^[a-zA-Z][a-zA-Z0-9_-]{0,55}$/.test(c.id)&&ids.has(c.aId)&&ids.has(c.bId)&&c.aId!==c.bId,'连接身份或所属实例无效');
  assert(['support','seam'].includes(c.kind)&&[c.label,c.evidence].every(s=>typeof s==='string'&&s.trim()),'缺少连接类型或参考依据');
  assert(Array.isArray(c.points)&&c.points.length>=(c.kind==='seam'?2:1)&&c.points.length<=8&&c.points.every(vector),'接缝需2至8个采样点，支承需1至8个局部采样点');
  assert(new Set(c.points.map(p=>JSON.stringify(p))).size===c.points.length,'不能用重复连接点充当接缝覆盖');
  assert(Array.isArray(c.referenceIndices)&&new Set(c.referenceIndices).size===c.referenceIndices.length&&c.referenceIndices.every(i=>Number.isInteger(i)&&i>=1&&i<=referenceCount)&&(referenceCount===0||c.referenceIndices.length>0),'参考图片依据无效');
 }
}
export function validateContactBounds(contacts:SpatialContact[]|undefined,instances:Instance[],templates:{id:string;bounds:{min:number[];max:number[]}}[]){
 for(const c of contacts??[]){
  const a=instances.find(i=>i.id===c.aId)!,b=instances.find(i=>i.id===c.bId)!;
  for(const point of c.points){const world=transformPoint(point,a);for(const instance of [a,b]){
   const local=instance===a?point:localPoint(world,instance),bounds=templates.find(t=>t.id===instance.template)!.bounds;
   assert(local.every((n,k)=>n>=bounds.min[k]-CONTACT_TOLERANCE_METERS/instance.scale[k]&&n<=bounds.max[k]+CONTACT_TOLERANCE_METERS/instance.scale[k]),`连接点脱离冻结边界：${c.id} / ${instance.id}`);
  }}
 }
}
export function assetContacts(layout:{program:{instances:Instance[]};spatialContacts?:SpatialContact[]},templateId:string){
 return (layout.spatialContacts??[]).flatMap(c=>{
  const a=layout.program.instances.find(i=>i.id===c.aId)!,b=layout.program.instances.find(i=>i.id===c.bId)!;
  return [a,b].filter(i=>i.template===templateId).map(i=>({id:c.id,label:c.label,kind:c.kind,instanceId:i.id,neighborInstanceId:i===a?b.id:a.id,neighborLabel:i===a?b.label:a.label,localPoints:c.points.map(p=>i===a?p:localPoint(transformPoint(p,a),b)),toleranceMeters:CONTACT_TOLERANCE_METERS,referenceIndices:c.referenceIndices,evidence:c.evidence}));
 });
}
const segmentDistanceSquared=(p:Vec,a:Vec,b:Vec)=>{const ab=sub(b,a),d=dot(ab,ab),t=d?Math.max(0,Math.min(1,dot(sub(p,a),ab)/d)):0;return squared(p,a.map((v,k)=>v+t*ab[k]));};
/** 点到三角形的最近距离，包含边、顶点及退化三角形；包围盒不作为实际表面。 */
export function triangleDistanceSquared(p:Vec,a:Vec,b:Vec,c:Vec){
 const ab=sub(b,a),ac=sub(c,a),ap=sub(p,a),cross:Vec=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];
 if(dot(cross,cross)<1e-20)return Math.min(segmentDistanceSquared(p,a,b),segmentDistanceSquared(p,b,c),segmentDistanceSquared(p,c,a));
 const d1=dot(ab,ap),d2=dot(ac,ap);if(d1<=0&&d2<=0)return squared(p,a);
 const bp=sub(p,b),d3=dot(ab,bp),d4=dot(ac,bp);if(d3>=0&&d4<=d3)return squared(p,b);
 const vc=d1*d4-d3*d2;if(vc<=0&&d1>=0&&d3<=0){const v=d1/(d1-d3);return squared(p,a.map((n,k)=>n+v*ab[k]));}
 const cp=sub(p,c),d5=dot(ab,cp),d6=dot(ac,cp);if(d6>=0&&d5<=d6)return squared(p,c);
 const vb=d5*d2-d1*d6;if(vb<=0&&d2>=0&&d6<=0){const w=d2/(d2-d6);return squared(p,a.map((n,k)=>n+w*ac[k]));}
 const va=d3*d6-d5*d4;if(va<=0&&d4-d3>=0&&d5-d6>=0){const w=(d4-d3)/((d4-d3)+(d5-d6));return squared(p,b.map((n,k)=>n+w*(c[k]-n)));}
 const denominator=1/(va+vb+vc),v=vb*denominator,w=vc*denominator;return squared(p,a.map((n,k)=>n+ab[k]*v+ac[k]*w));
}
export function inspectContacts(scene:{program:GeometryProgram;spatialContacts?:SpatialContact[]},options:{assetTemplateId?:string}={}){
 const p=scene.program,contacts=(scene.spatialContacts??[]).filter(c=>!options.assetTemplateId||[c.aId,c.bId].some(id=>p.instances.find(i=>i.id===id)?.template===options.assetTemplateId));
 const report={version:'contact-surfaces-v1',scope:options.assetTemplateId?'asset-self':'assembled-scene',status:scene.spatialContacts===undefined?'not-declared':contacts.length?'checked':'not-applicable',toleranceMeters:CONTACT_TOLERANCE_METERS,method:'在声明的共享连接点测量双方实际不透明三角面距离，单点误差阈值3厘米。仅证明这些采样点，不证明整条接缝、无穿插、物理支撑或图像匹配。诊断不阻止已有输出及评分。',checks:[] as any[]};
 if(!contacts.length)return report;
 const program={...p,materials:p.materials.map(m=>({...m,textureId:null,surfaceDetail:null})),...(options.assetTemplateId?{templates:p.templates.filter(t=>t.id===options.assetTemplateId),instances:p.instances.filter(i=>i.template===options.assetTemplateId)}:{})};
 const byInstance=new Map<string,any[]>();
 for(const mesh of compileGeometryProgram(program).meshes){
  if((mesh.geometry.material?.surface?.baseColor?.[3]??1)<.95)continue;
  const rows=byInstance.get(mesh.entityId)??[];rows.push(mesh);byInstance.set(mesh.entityId,rows);
 }
 for(const c of contacts){
  const a=p.instances.find(i=>i.id===c.aId)!,b=p.instances.find(i=>i.id===c.bId)!;
  const sides=[a,b].filter(i=>!options.assetTemplateId||i.template===options.assetTemplateId),samples:any[]=[];
  for(const [index,point] of c.points.entries()){
   const world=transformPoint(point,a);
   for(const i of sides){let best=Infinity,part:string|null=null;
    for(const mesh of byInstance.get(i.id)??[]){const {positions,indices}=mesh.geometry;
     for(let t=0;t<indices.length;t+=3){const vertices=[0,1,2].map(k=>positions.slice(indices[t+k]*3,indices[t+k]*3+3) as Vec),distance=triangleDistanceSquared(world,vertices[0],vertices[1],vertices[2]);if(distance<best){best=distance;part=mesh.name;}}
    }
    samples.push({index,instanceId:i.id,worldPoint:world,distanceMeters:Number.isFinite(best)?Math.sqrt(best):null,part,status:!Number.isFinite(best)?'missing-surface':Math.sqrt(best)>CONTACT_TOLERANCE_METERS+1e-6?'gap':'connected'});
   }
  }
  report.checks.push({id:c.id,label:c.label,kind:c.kind,instanceIds:[c.aId,c.bId],referenceIndices:c.referenceIndices,evidence:c.evidence,status:samples.every(s=>s.status==='connected')?'connected':'gap',maximumDistanceMeters:samples.some(s=>s.distanceMeters===null)?null:Math.max(...samples.map(s=>s.distanceMeters),0),samples});
 }
 return report;
}
export function contactSummary(report:ReturnType<typeof inspectContacts>){return {...report,checks:report.checks.map(({samples,...check})=>({...check,failedSampleCount:samples.filter((s:any)=>s.status!=='connected').length,failedSamples:samples.filter((s:any)=>s.status!=='connected').slice(0,4)}))};}
export const CONTACTS_PROMPT=`spatialContacts 显式声明参考图可见且影响主体的支承或连续接缝，无此类依据时填[]；不要把相邻、遮挡、刻意留空误认为必须接触。同一连续主轮廓优先放在一个模板，确需拆成独立资产时共享接口，不能分别猜测边缘。
每项为{id,label,kind,aId,bId,points,referenceIndices,evidence}，kind为support或seam，aId/bId为两个不同实例ID。points全部在aId模板的局部坐标中，标记双方表面应共同经过的位置；程序按冻结实例变换推导bId局部位置。支承选1至8点；接缝选2至8个分散点覆盖两端和关键转折，不重复点。点必须落入双方冻结外包络，单位米、Z向上。只记有图片依据的关键连接，最多24处；不要凭空约束隐藏界面。referenceIndices及中文evidence区分观察和尺度推断。
详细资产输入将收到自己的localPoints，应以有厚度的实际构件连续经过连接点，不能靠包围盒、悬浮小补丁或增加遮挡伪装贴合。诊断使用实际网格，不以这些采样替代最终画面验收；不能删除声明掩盖接缝。`;
