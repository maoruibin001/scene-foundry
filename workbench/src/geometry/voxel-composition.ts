import {basis,project} from './camera-fit';
import {referenceFrame} from './reference-frame.mjs';
import {transformPoint} from './program';
import {projectedHeight} from './runtime-metrics.mjs';

export const VOXEL_COMPOSITION='voxel-composition-v1';
/** Only new voxel jobs created under the policy check and fit their reference cameras; historical and ordinary jobs are unchanged. */
export function voxelCompositionRule(job:any){return job?.voxelCompositionPolicy===VOXEL_COMPOSITION;}
/** Measured on the first voxel-lattice-v1 plans: a left-right mirrored layout gave a 0.33 mean centre error against 0.02 when mirrored back; correct plans stayed under 0.06. */
export const VOXEL_COMPOSITION_LIMITS={mirrorError:.12,mirrorRatio:.5,minimumRows:4,maxShift:.25,scale:[.8,1.25],minimumGain:.01,gainRatio:.8};
/** The runtime framing hard check: subject-role parts must span at least this share of every reference frame's height. */
export const SUBJECT_FRAMING_MINIMUM=.25;
export const VOXEL_COMPOSITION_GUIDANCE='参考机位画面方向按Engine右手系计算（Z向上）：forward=normalize(target-position)，画面右方=normalize(cross(forward,[0,0,1]))=(forward.y,-forward.x,0)的单位向量，画面上方=cross(右方,forward)。例如机位在+X+Y一侧俯视原点时，世界+Y偏向画面右侧、+X偏向画面左侧。决定实例左右位置前先用该公式核对原图左右；程序会把每个地标模板边界投影到参考机位与原图观察框比对，整体左右镜像会被退回。参考机位的平移与正交覆盖高度可能由程序按观察框做确定性微调，不改变实例、模板和格网。entities.role=subject标注原图画面主体的主要结构与关键物件（不只一个小物件），它们在每个参考机位合起来须占画面高度至少'+SUBJECT_FRAMING_MINIMUM*100+'%，否则运行取景硬检查每轮失败；规划会按同一投影退回。';

type Row={landmarkId:string;extent:string;observed:number[];projected:number[];weight:number};
const WEIGHT:Record<string,number>={complete:1,partial:.6,occluded:.4};
const centre=(b:number[])=>[(b[0]+b[2])/2,(b[1]+b[3])/2];

function cameraAspect(camera:any,sizes:{referenceIndex:number;width:number;height:number}[]){const s=sizes.find(s=>s.referenceIndex===camera.referenceIndex);if(!s)throw Error('参考机位没有对应原图尺寸：'+camera.name);const f=referenceFrame(s.width,s.height);return f.width/f.height;}
/** Each bound landmark's template bounds, projected through one reference camera, against its observed box. */
export function compositionRows(space:any,observation:any,camera:any,aspect:number):Row[]{
 const templates=new Map(space.program.templates.map((t:any)=>[t.id,t])),instances=new Map(space.program.instances.map((i:any)=>[i.id,i])),rows:Row[]=[];
 for(const landmark of observation.landmarks){
  const view=landmark.views?.find((v:any)=>v.referenceIndex===camera.referenceIndex),binding=space.observedBindings?.find((b:any)=>b.landmarkId===landmark.id);
  if(!view?.box||!binding?.instanceIds?.length)continue;
  const lo=[Infinity,Infinity],hi=[-Infinity,-Infinity];let behind=false;
  for(const id of binding.instanceIds){const instance:any=instances.get(id),template:any=instance&&templates.get(instance.template);if(!template)continue;
   for(let c=0;c<8;c++){const p=[0,1,2].map(k=>c&(1<<k)?template.bounds.max[k]:template.bounds.min[k]),uv=project(camera,transformPoint(p as any,instance),aspect);if(uv[2]<=0)behind=true;for(let k=0;k<2;k++){lo[k]=Math.min(lo[k],uv[k]);hi[k]=Math.max(hi[k],uv[k]);}}}
  if(behind||!Number.isFinite(lo[0]))continue;
  rows.push({landmarkId:landmark.id,extent:view.extent,observed:centre(view.box),projected:[(lo[0]+hi[0])/2,(lo[1]+hi[1])/2],weight:WEIGHT[view.extent]??.4});
 }
 return rows;
}
const meanError=(rows:Row[],k=1,t=[0,0])=>rows.reduce((s,r)=>s+Math.hypot(.5+k*(r.projected[0]-.5)+t[0]-r.observed[0],.5+k*(r.projected[1]-.5)+t[1]-r.observed[1]),0)/Math.max(1,rows.length);
export function mirrorErrors(rows:Row[]){const n=Math.max(1,rows.length);return {direct:rows.reduce((s,r)=>s+Math.abs(r.projected[0]-r.observed[0]),0)/n,mirrored:rows.reduce((s,r)=>s+Math.abs(r.projected[0]-(1-r.observed[0])),0)/n};}
/** Robust weighted least squares for a uniform image scale about the centre plus an image shift. */
export function fitImageShift(rows:Row[]){
 const L=VOXEL_COMPOSITION_LIMITS;let k=1,t=[0,0];
 for(let iteration=0;iteration<8;iteration++){
  let spp=0,spo=0;const w=[0,0],sp=[0,0],so=[0,0];
  for(const r of rows)for(let a=0;a<2;a++){const p=r.projected[a]-.5,o=r.observed[a]-.5,e=Math.abs(k*p+t[a]-o),q=r.weight*(e>.05?.05/e:1);w[a]+=q;spp+=q*p*p;spo+=q*p*o;sp[a]+=q*p;so[a]+=q*o;}
  // One scale and two shifts: eliminate each axis' shift from the normal equations, then solve the scale in closed form.
  const num=spo-sp[0]*so[0]/w[0]-sp[1]*so[1]/w[1],den=spp-sp[0]*sp[0]/w[0]-sp[1]*sp[1]/w[1];
  k=Math.min(L.scale[1],Math.max(L.scale[0],den>1e-9?num/den:1));t=[0,1].map(a=>Math.min(L.maxShift,Math.max(-L.maxShift,(so[a]-k*sp[a])/w[a])));
 }
 return {scale:k,shift:t};
}
/** Moves an orthographic camera in its own image plane and rescales its coverage height so projected content lands on the fitted image shift and scale. */
export function applyImageShift(camera:any,aspect:number,k:number,t:number[]){
 const {right,up}=basis(camera),height=camera.orthographicHeight/k,a=-t[0]*height*aspect,b=t[1]*height,move=[0,1,2].map(i=>right[i]*a+up[i]*b);
 return {...camera,position:camera.position.map((v:number,i:number)=>v+move[i]),target:camera.target.map((v:number,i:number)=>v+move[i]),orthographicHeight:height};
}
const round=(v:number)=>Math.round(v*1e4)/1e4;
/** Rejects a left-right mirrored plan with concrete axes, then fits orthographic reference cameras to the observed boxes. Instances, templates and the lattice are untouched; perspective cameras are left as planned. */
export function checkVoxelComposition(space:any,observation:any,sizes:{referenceIndex:number;width:number;height:number}[]){
 const L=VOXEL_COMPOSITION_LIMITS,cameras:any[]=[],report:any[]=[];
 for(const camera of space.cameras){
  if(!camera.referenceIndex){cameras.push(camera);continue;}
  // Box corners of templates around a perspective camera can sit beside or behind it, so their projected box is not a usable proxy; it misread an alley view as mirrored.
  if(camera.projection!=='orthographic'){cameras.push(camera);report.push({camera:camera.name,referenceIndex:camera.referenceIndex,status:'skipped',reason:'透视机位的模板包围盒投影不可靠'});continue;}
  const aspect=cameraAspect(camera,sizes),rows=compositionRows(space,observation,camera,aspect);
  if(rows.length<L.minimumRows){cameras.push(camera);report.push({camera:camera.name,referenceIndex:camera.referenceIndex,status:'skipped',reason:'可比地标不足',rows:rows.length});continue;}
  const m=mirrorErrors(rows);
  if(m.direct>=L.mirrorError&&m.mirrored<=m.direct*L.mirrorRatio){
   const {right,up}=basis(camera),worst=[...rows].sort((a,b)=>Math.abs(b.projected[0]-b.observed[0])-Math.abs(a.projected[0]-a.observed[0])).slice(0,8);
   throw Error('VOXEL_LAYOUT_MIRRORED：参考机位“'+camera.name+'”下，地标模板边界投影后的左右位置与原图整体镜像（平均水平误差'+m.direct.toFixed(3)+'，左右翻转后仅'+m.mirrored.toFixed(3)+'）。该机位画面右方的世界方向为['+right.map(round).join(',')+']，画面上方为['+up.map(round).join(',')+']。原图在画面左侧的结构须放在世界坐标中沿右方向量为负的一侧。按该方向重新放置实例或重新选择机位，不能只改说明文字。偏差最大的地标（原图中心u→当前投影u）：'+worst.map(r=>r.landmarkId+' '+r.observed[0].toFixed(2)+'→'+r.projected[0].toFixed(2)).join('；'));
  }
  const fit=fitImageShift(rows),before=meanError(rows),after=meanError(rows,fit.scale,fit.shift),accepted=after<=before-L.minimumGain&&after<=before*L.gainRatio;
  const next=accepted?applyImageShift(camera,aspect,fit.scale,fit.shift):camera,check=accepted?meanError(compositionRows(space,observation,next,aspect)):before;
  cameras.push(next);report.push({camera:camera.name,referenceIndex:camera.referenceIndex,status:accepted?'fitted':'kept',mirror:m,rows:rows.length,scale:fit.scale,shift:fit.shift,before,after:check,original:accepted?{position:camera.position,target:camera.target,orthographicHeight:camera.orthographicHeight}:undefined});
 }
 assertSubjectFraming({...space,cameras},sizes);
 return {space:{...space,cameras},report:{version:VOXEL_COMPOSITION,unit:'画面高度归一化的地标中心距离；投影为模板边界包围盒，不是可见像素，也不是质量得分',cameras:report}};
}
const toEngine=(v:number[])=>[v[0],v[2],-v[1]];
/** Engine-space bounds of each instance's template, as the framing check sees the compiled parts; whole-template bounds never under-estimate it. */
function instanceObjects(space:any,keep:(id:string)=>boolean){
 const templates=new Map(space.program.templates.map((t:any)=>[t.id,t]));
 return space.program.instances.filter((i:any)=>keep(i.id)&&templates.has(i.template)).map((i:any)=>{const t:any=templates.get(i.template),lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
  for(let c=0;c<8;c++){const p=toEngine(transformPoint([0,1,2].map(k=>c&(1<<k)?t.bounds.max[k]:t.bounds.min[k]) as any,i));for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],p[k]);hi[k]=Math.max(hi[k],p[k]);}}
  return {id:i.id,position:lo.map((v,k)=>(v+hi[k])/2),size:hi.map((v,k)=>Math.max(.001,v-lo[k]))};});
}
/**
 * A plan whose subject role covers too little of a reference view fails the framing hard check in every graybox round, and no spatial repair
 * changes roles. The 2026-10-18 temple plan named only a 1.2 m chest as subject (7.7% of the frame) while 25 earlier voxel rounds measured 27–70%.
 */
export function assertSubjectFraming(space:any,sizes:{referenceIndex:number;width:number;height:number}[]){
 const roles=new Map((space.entities??[]).map((e:any)=>[e.instanceId,e.role])),subjects=instanceObjects(space,id=>roles.get(id)==='subject');
 for(const camera of space.cameras.filter((c:any)=>c.referenceIndex)){
  const s=sizes.find(s=>s.referenceIndex===camera.referenceIndex);if(!s)throw Error('参考机位没有对应原图尺寸：'+camera.name);
  const frame=referenceFrame(s.width,s.height),pose={...camera,position:toEngine(camera.position),target:toEngine(camera.target)},ratio=projectedHeight(pose,subjects,frame.width,frame.height).heightRatio;
  if(ratio>=SUBJECT_FRAMING_MINIMUM)continue;
  const others=instanceObjects(space,id=>roles.get(id)==='context').map(o=>({id:o.id,ratio:projectedHeight(pose,[o],frame.width,frame.height).heightRatio})).sort((a,b)=>b.ratio-a.ratio).slice(0,6);
  throw Error('VOXEL_SUBJECT_FRAMING：参考机位“'+camera.name+'”下，role=subject 的实例（'+subjects.map(o=>o.id).join('、')+'）投影仅占画面高度'+(ratio*100).toFixed(1)+'%，运行硬检查要求至少'+SUBJECT_FRAMING_MINIMUM*100+'%，后续灰模修正不改role，此规划每轮都会失败。subject应标注原图画面中构成主体的主要结构和关键物件，不只是一个小物件；按原图把这些实例的entities.role改为subject，不改实例几何、机位或地标绑定。占画面较高的context实例（实例 占比）：'+others.map(o=>o.id+' '+(o.ratio*100).toFixed(0)+'%').join('；'));
 }
}
