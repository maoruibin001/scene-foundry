/**
 * measured-pose-v1, per job like measured-fov-v1, so recorded runs replay unchanged.
 *
 * The model placed the second reference camera on its own. On the ground-truth benchmark (bench/gt, 18 Hypersim interiors,
 * gt-scene-score-v4) the relative rotation between the two reference cameras was off by 16.9° (median, up to 80°), so the two
 * views could not pin object depth against each other. Depth Anything 3 (DA3-BASE, Apache-2.0 weights) reads it within 0.6° on the
 * native views and 4.2° median on centre crops that change the FoV (2026-10-28, ~/scene-foundry-verify/spike-pose).
 *
 * Under the policy the pose of every reference view relative to view 1 is measured once per job. bindReferenceFrames then keeps
 * camera 1 as placed and sets each other reference perspective camera from it: direction from the measured relative rotation
 * (roll dropped, cameras here are roll-free), position along the measured baseline direction, or at camera 1's position when the
 * measurement says the camera only turned.
 *
 * Spacing. v1 kept the scene's own camera spacing. In a controlled run (v24, 3 interiors) the model's spacing was short against its
 * own room, so the anchored rig read the room 1.1–1.9× too large and far. v2 sets the spacing to the measured baselineRatio (baseline
 * over view 1's median depth, scale-free; within 2% of ground truth on the views) times the scene's own median depth seen from
 * camera 1, so the rig and the room share one scale. Offline on 28 recorded grayboxes: anchored recall 0.320 → 0.374, scenes at 0
 * from 7 to 3. v1 jobs replay unchanged. The tool is optional and comes from the environment
 * (PIPELINE_POSE_PYTHON: a Python with depth_anything_3 installed; PIPELINE_POSE_MODEL: model id); without it the policy is off.
 */
import {join} from 'node:path';
import {mkdirSync,readFileSync} from 'node:fs';
import {digest,save} from '../store';
import {compileGeometryProgram} from './program';
import {cameraRay,rayScene} from './camera-fit';

export const MEASURED_POSE={version:'measured-pose-v2',tool:'depth-anything-3'} as const;
export const MEASURED_POSE_V1='measured-pose-v1';
const SCRIPT=join(import.meta.dir,'measure-pose.py');
const DEFAULT_MODEL='depth-anything/DA3-BASE';
/** Baseline below this fraction of view 1's median depth is read as a pure rotation (AI "other angle" edits often barely move). */
export const PURE_ROTATION_RATIO=.03;

export type ViewPose={R:number[][];base:number[];baselineRatio:number;lockSpacing?:boolean};
export function measuredPoseRule(job:any){return [MEASURED_POSE.version,MEASURED_POSE_V1].includes(job?.measuredPosePolicy?.version);}
export function measuredPosePolicyFor(sceneKind:string,env=process.env){return sceneKind!=='voxel'&&env.PIPELINE_POSE_PYTHON?{...MEASURED_POSE,model:env.PIPELINE_POSE_MODEL||DEFAULT_MODEL}:null;}
/** The measured pose of reference image `index` (0-based) relative to image 0, or undefined (always for image 0). */
export function measuredPose(job:any,index:number):ViewPose|undefined{
 const v=job?.referencePose?.views?.[index];
 return measuredPoseRule(job)&&index>0&&v?.R&&v?.base?{R:v.R,base:v.base,baselineRatio:v.baselineRatio,lockSpacing:job.measuredPosePolicy.version===MEASURED_POSE.version}:undefined;
}

export async function measureReferencePose(job:any,images:{path:string}[],dir:string,signal?:AbortSignal){
 if(images.length<2)return null;
 const python=process.env.PIPELINE_POSE_PYTHON;if(!python)throw Error('measured-pose-v1 需要 PIPELINE_POSE_PYTHON');
 const p=Bun.spawn([python,'-I',SCRIPT,job.measuredPosePolicy.model,...images.map(i=>i.path)],{stdout:'pipe',stderr:'pipe',signal,env:process.env});
 const [out,err,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);
 if(code)throw Error('参考图相对位姿测量失败：'+err.slice(-600));
 const views=JSON.parse(out.trim().split('\n').at(-1)!).views.map((v:any,i:number)=>({...v,imageSha256:digest(readFileSync(images[i].path))}));
 const finite=(a:any)=>Array.isArray(a)&&a.flat().every((x:any)=>Number.isFinite(x));
 if(views.length!==images.length||views.slice(1).some((v:any)=>!finite(v.R)||v.R.length!==3||!finite(v.base)||!Number.isFinite(v.baselineRatio)))throw Error('参考图相对位姿测量结果无效');
 const record={version:MEASURED_POSE.version,tool:MEASURED_POSE.tool,model:job.measuredPosePolicy.model,views};
 mkdirSync(join(dir,'generation'),{recursive:true});save(join(dir,'generation/reference-pose.json'),record);return record;
}

const sub=(a:number[],b:number[])=>a.map((v,k)=>v-b[k]),norm=(a:number[])=>Math.hypot(...a),unit=(a:number[])=>{const l=norm(a);return a.map(v=>v/l);};
const cross=(a:number[],b:number[])=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
/** World-from-camera (OpenCV axes) for a roll-free camera in this Z-up world: columns right, down, forward. */
function opencvBasis(position:number[],target:number[]){const f=unit(sub(target,position)),r=unit(cross(f,[0,0,1])),u=cross(r,f);return (v:number[])=>[0,1,2].map(k=>r[k]*v[0]-u[k]*v[1]+f[k]*v[2]);}
/** Median z-depth of the scene's geometry seen from `camera` over a fixed ray grid; undefined when nothing is hit. */
export function anchorMedianDepth(program:any,camera:any){
 const compiled=compileGeometryProgram({...program,materials:program.materials.map((m:any)=>({...m,textureId:null,surfaceDetail:null}))});
 const cast=rayScene(compiled.meshes.map((m:any)=>({...m,name:m.entityId})),{doubleSided:true}),forward=unit(sub(camera.target,camera.position)),z:number[]=[];
 for(let j=0;j<18;j++)for(let i=0;i<32;i++){const r=cameraRay(camera,[(i+.5)/32,(j+.5)/18]),hit=cast(r.origin,r.direction);if(hit)z.push(sub(hit.point,camera.position).reduce((s,v,k)=>s+v*forward[k],0));}
 if(!z.length)return undefined;z.sort((a,b)=>a-b);return z[z.length>>1];
}
/** Camera `camera` re-placed from `anchor` (reference view 1) by a measured relative pose. Spacing is baselineRatio × `depth` (view 1's
 * median depth in this scene) when the pose locks spacing and a depth is given, else the scene's own. */
export function poseFromAnchor(anchor:{position:number[];target:number[]},camera:{position:number[];target:number[]},pose:ViewPose,depth?:number){
 const toWorld=opencvBasis(anchor.position,anchor.target);
 const forward=unit(toWorld([pose.R[0][2],pose.R[1][2],pose.R[2][2]]));
 if(Math.abs(forward[2])>.999)throw Error('测量位姿使参考机位竖直朝向，无法表示为无滚转机位');
 const length=pose.lockSpacing&&depth!==undefined&&depth>0?pose.baselineRatio*depth:norm(sub(camera.position,anchor.position));
 const position=pose.baselineRatio<PURE_ROTATION_RATIO||length<1e-6?[...anchor.position]:anchor.position.map((v,k)=>v+length*toWorld(pose.base)[k]);
 const reach=norm(sub(camera.target,camera.position))||1;
 return {position,target:position.map((v,k)=>v+reach*forward[k])};
}

const deg=(r:number)=>(r*180/Math.PI).toFixed(1);
export function measuredPoseGuidance(job:any){
 if(!measuredPoseRule(job)||!job.referencePose)return '';
 const rows=job.referencePose.views.slice(1).map((v:any)=>{
  const fwd=[v.R[0][2],v.R[1][2],v.R[2][2]],yaw=Math.atan2(fwd[0],fwd[2]),pitch=Math.asin(Math.max(-1,Math.min(1,-fwd[1])));
  const move=v.baselineRatio<PURE_ROTATION_RATIO?'机位基本未移动，只是转向':`机位相对图1向${v.base[0]>=0?'右':'左'}、向${v.base[2]>=0?'前':'后'}移动（方向向量 右 ${v.base[0].toFixed(2)}、下 ${v.base[1].toFixed(2)}、前 ${v.base[2].toFixed(2)}），移动距离约为图1画面中位深度的 ${v.baselineRatio.toFixed(2)} 倍`;
  return `图${v.referenceIndex}：相对图1朝向${yaw>=0?'右':'左'}转约 ${deg(Math.abs(yaw))}°、视线${pitch>=0?'抬高':'压低'}约 ${deg(Math.abs(pitch))}°；${move}`;
 }).join('；');
 return rows?`参考图之间的相对机位已由独立的多视图几何测量得出：${rows}。图1机位由你确定；其余参考机位的朝向和相对图1的移动方向必须与此一致，程序渲染时会按测量值从图1机位推出其余参考机位，机位间距也按测得的比例和场景中图1的深度确定。房间尺寸与物体距离要与这个机位间距一致。物体位置要同时满足各参考图的画面。`:'';
}
