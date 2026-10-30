/**
 * measured-orientation-v1, per job like the other measured locks, so recorded runs replay unchanged.
 *
 * The owner's blind calibration (2026-10-30, 9 graybox pairs) named "wrong viewpoint" in nearly every pair. Two causes were measured on the
 * ground-truth benchmark: reference cameras are rolled 5–12° in about half of the Hypersim views while every pipeline camera was level, and
 * the camera's heading relative to the room walls was the model's guess (median error 13°, 59 of 94 views over 10°). A Manhattan frame of
 * the MoGe-2 point map object3d already stores reads roll within 0.3° (median; max 3.3°) and the heading relative to the walls within 1.3°
 * (max 6.2°) on 36 views. Under the policy every perspective reference camera takes its measured roll, and reference camera 1 is turned
 * about the vertical so its angle to the scene's own wall axis matches the measurement; cameras 2..n still follow camera 1 by the measured
 * relative pose.
 */
import {join} from 'node:path';
import {save} from '../store';
import {compileGeometryProgram} from './program';

export const MEASURED_ORIENTATION={version:'measured-orientation-v1',source:'object3d reference-points (MoGe-2)'} as const;
const SCRIPT=join(import.meta.dir,'measure-orientation.py');
export type ViewOrientation={roll:number;wall:number};

export function measuredOrientationRule(job:any){return job?.measuredOrientationPolicy?.version===MEASURED_ORIENTATION.version;}
/** Needs the reference point maps of object3d-gate-v1. */
export function measuredOrientationPolicyFor(sceneKind:string,object3d:any,env=process.env){return sceneKind!=='voxel'&&object3d&&env.PIPELINE_ORIENTATION_LOCK!=='0'?{...MEASURED_ORIENTATION}:null;}
/** Measured orientation of reference image `index` (0-based), in radians. */
export function measuredOrientation(job:any,index:number):ViewOrientation|undefined{
 const v=job?.referenceOrientation?.views?.[index];if(!measuredOrientationRule(job)||!v)return undefined;
 return {roll:v.roll*Math.PI/180,wall:v.wall*Math.PI/180};
}

export async function measureReferenceOrientation(job:any,count:number,dir:string,signal?:AbortSignal){
 const python=process.env.PIPELINE_FOV_PYTHON;if(!python)throw Error('measured-orientation-v1 需要 PIPELINE_FOV_PYTHON');
 const p=Bun.spawn([python,'-I',SCRIPT,join(dir,'generation/reference-points'),String(count)],{stdout:'pipe',stderr:'pipe',signal,env:process.env});
 const [out,err,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);
 if(code)throw Error('参考图朝向测量失败：'+err.slice(-600));
 const views=JSON.parse(out.trim().split('\n').at(-1)!).map((v:any,i:number)=>({referenceIndex:i+1,...v}));
 if(views.length!==count||views.some((v:any)=>![v.roll,v.wall].every(Number.isFinite)||Math.abs(v.roll)>25))throw Error('参考图朝向测量结果无效');
 const record={version:MEASURED_ORIENTATION.version,source:MEASURED_ORIENTATION.source,views};save(join(dir,'generation/reference-orientation.json'),record);return record;
}

/** The scene's own wall axis (radians, mod 90°): area-weighted 4-fold mean of the azimuths of its near-vertical faces. */
export function sceneWallAxis(program:any){
 let c=0,s=0;
 for(const m of compileGeometryProgram({...program,materials:program.materials.map((x:any)=>({...x,textureId:null,surfaceDetail:null}))}).meshes){
  const p=m.geometry.positions,ix=m.geometry.indices;
  for(let t=0;t<ix.length;t+=3){
   const a=ix[t]*3,b=ix[t+1]*3,d=ix[t+2]*3,u=[p[b]-p[a],p[b+1]-p[a+1],p[b+2]-p[a+2]],v=[p[d]-p[a],p[d+1]-p[a+1],p[d+2]-p[a+2]];
   const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],area=Math.hypot(...n)/2;if(area<1e-6)continue;
   if(Math.abs(n[2])/(2*area)>.26)continue;const az=Math.atan2(n[1],n[0]);c+=area*Math.cos(4*az);s+=area*Math.sin(4*az);
  }
 }
 return c||s?Math.atan2(s,c)/4:0;
}

/** Camera 1 turned about the vertical through its position so that its heading is (wall axis − measured angle) + k·90°, nearest the scene's. */
export function lockHeading(anchor:{position:number[];target:number[]},orientation:ViewOrientation,wallAxis:number){
 const f=anchor.target.map((v,k)=>v-anchor.position[k]),horizontal=Math.hypot(f[0],f[1]),current=Math.atan2(f[1],f[0]);
 const base=wallAxis-orientation.wall,quarter=Math.PI/2,k=Math.round((current-base)/quarter),heading=base+k*quarter;
 return {position:[...anchor.position],target:[anchor.position[0]+horizontal*Math.cos(heading),anchor.position[1]+horizontal*Math.sin(heading),anchor.target[2]]};
}

export function measuredOrientationGuidance(job:any){
 if(!measuredOrientationRule(job)||!job.referenceOrientation)return '';
 return '参考机位的侧倾与机位 1 相对墙面的夹角已由单目几何测量并在渲染时固定：'+job.referenceOrientation.views.map((v:any)=>`图${v.referenceIndex} 侧倾 ${v.roll.toFixed(1)}°、视线与最近墙面方向夹角 ${v.wall.toFixed(1)}°`).join('；')+'。房间墙体请沿统一的正交方向布置，物体朝向随墙体对齐；不要通过旋转相机或整体旋转房间来对齐画面。';
}
