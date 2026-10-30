/**
 * measured-camera-v1, per job like measured-fov-v1 / measured-pose-v1, so recorded runs replay unchanged. Opt-in (PIPELINE_CAMERA_LOCK=1).
 *
 * After the relative pose was locked, camera 1 itself was the error: on the ground-truth benchmark (bench/gt, 18 Hypersim interiors)
 * the model's camera-1 height over its own median depth was off by 41% (median |log|) and its pitch by 2.4°, and the room seen from
 * camera 1 was 16–36% off in far / left / right extent. MoGe-2 on reference image 1 reads the height ratio within 4%, pitch within
 * 0.4° and the extents within 2–7% (2026-10-28, ~/scene-foundry-verify/spike-pose/scripts/moge_cam1.py, room_ratio.py).
 *
 * Under the policy view 1 is measured once per job. bindReferenceFrames sets camera 1's height to the measured ratio times the scene's
 * own median depth above the floor found straight below the camera, and its pitch to the measured pitch (yaw and target distance
 * kept), before the other reference cameras are derived from it. The room proportions go to the space prompt. Same Python as the FoV
 * measurement (PIPELINE_FOV_PYTHON, MoGe-2).
 */
import {join} from 'node:path';
import {mkdirSync,readFileSync} from 'node:fs';
import {digest,save} from '../store';
import type {sceneProbe} from './measured-pose';

export const MEASURED_CAMERA={version:'measured-camera-v1',tool:'moge-2'} as const;
const SCRIPT=join(import.meta.dir,'measure-camera.py');
const DEFAULT_MODEL='Ruicheng/moge-2-vitl-normal';
export type AnchorCamera={heightRatio:number|null;pitch:number|null;far:number;left:number;right:number};

export function measuredCameraRule(job:any){return job?.measuredCameraPolicy?.version===MEASURED_CAMERA.version;}
export function measuredCameraPolicyFor(sceneKind:string,env=process.env){return sceneKind!=='voxel'&&env.PIPELINE_FOV_PYTHON&&env.PIPELINE_CAMERA_LOCK==='1'?{...MEASURED_CAMERA,model:env.PIPELINE_FOV_MODEL||DEFAULT_MODEL}:null;}
/** The measured view-1 camera for reference image `index` (0-based); only image 0 carries one. */
export function measuredCamera(job:any,index:number):AnchorCamera|undefined{return measuredCameraRule(job)&&index===0&&job.referenceCamera?job.referenceCamera.view:undefined;}

export async function measureReferenceCamera(job:any,images:{path:string}[],dir:string,signal?:AbortSignal){
 const python=process.env.PIPELINE_FOV_PYTHON;if(!python)throw Error('measured-camera-v1 需要 PIPELINE_FOV_PYTHON');
 const p=Bun.spawn([python,'-I',SCRIPT,job.measuredCameraPolicy.model,images[0].path],{stdout:'pipe',stderr:'pipe',signal,env:process.env});
 const [out,err,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);
 if(code)throw Error('参考机位 1 测量失败：'+err.slice(-600));
 const v=JSON.parse(out.trim().split('\n').at(-1)!);
 if(![v.far,v.left,v.right].every(Number.isFinite))throw Error('参考机位 1 测量结果无效');
 const record={version:MEASURED_CAMERA.version,tool:MEASURED_CAMERA.tool,model:job.measuredCameraPolicy.model,view:{heightRatio:v.heightRatio,pitch:v.pitch,far:v.far,left:v.left,right:v.right},imageSha256:digest(readFileSync(images[0].path))};
 mkdirSync(join(dir,'generation'),{recursive:true});save(join(dir,'generation/reference-camera.json'),record);return record;
}

const deg=Math.PI/180;
/** Camera 1 with the measured height (over the floor straight below it) and pitch; unchanged parts when a value is missing. */
export function lockAnchorCamera(anchor:{position:number[];target:number[]},measured:AnchorCamera,probe:ReturnType<typeof sceneProbe>){
 const f=anchor.target.map((v,k)=>v-anchor.position[k]),reach=Math.hypot(...f),yaw=Math.atan2(f[1],f[0]);
 const pitch=measured.pitch!==null?measured.pitch*deg:Math.asin(f[2]/reach);
 const aim=(position:number[])=>({position,target:[position[0]+reach*Math.cos(pitch)*Math.cos(yaw),position[1]+reach*Math.cos(pitch)*Math.sin(yaw),position[2]+reach*Math.sin(pitch)],fov:(anchor as any).fov,frame:(anchor as any).frame});
 const floor=probe.clearance(anchor.position,[0,0,-1]);let camera=aim([...anchor.position]);
 if(measured.heightRatio===null||floor===undefined)return {position:camera.position,target:camera.target};
 // the median depth depends on the camera's own height and pitch, so settle it in a few passes (one pass left ~11% on the benchmark)
 for(let i=0;i<3;i++){const depth=probe.depth(camera);if(depth===undefined)break;camera=aim([anchor.position[0],anchor.position[1],anchor.position[2]-floor+measured.heightRatio*depth]);}
 return {position:camera.position,target:camera.target};
}

export function measuredCameraGuidance(job:any){
 if(!measuredCameraRule(job)||!job.referenceCamera)return '';
 const v=job.referenceCamera.view,f=(x:number)=>x.toFixed(2);
 const height=v.heightRatio!==null?`图1相机离地高度约为画面中位深度的 ${f(v.heightRatio)} 倍，视线${v.pitch>=0?'抬高':'压低'}约 ${Math.abs(v.pitch).toFixed(1)}°；`:'';
 return `参考图1的机位与房间比例已由独立的单目几何测量得出（以图1画面中位深度为 1）：${height}画面中较远处（95% 分位）约 ${f(v.far)}，左侧可见范围约 ${f(v.left)}，右侧约 ${f(v.right)}。图1机位的高度和俯仰会按测量值固定；房间尺寸、机位在房间中的位置（离左右墙和后墙的距离）以及物体距离必须与这些比例一致，不要把机位贴近侧墙或把房间做得比画面所示更窄更浅。`;
}

/**
 * What the repair model may still change on the reference cameras. The v28 repair (ai_053_007, 2026-10-29) spent its round moving camera 1
 * up and back while height, pitch and every FoV were locked and camera 2 follows camera 1, so the render barely moved (object3d .810 → .811)
 * and the mirrored layout and the wall in front of camera 2 stayed. Empty when no measured lock applies.
 */
export function lockedCameraRepairGuidance(job:any,locks:{fov:boolean;pose:boolean;camera:boolean;orientation?:boolean}){
 if(!locks.fov&&!locks.pose&&!locks.camera&&!locks.orientation)return '';
 const fixed=[locks.fov?'所有参考机位的视场（fov）':'',locks.camera?'参考机位 1 的离地高度与俯仰':'',locks.pose?'参考机位 2 及之后相对机位 1 的朝向与移动方向（它们随机位 1 一起移动）':'',locks.orientation?'各参考机位的侧倾与机位 1 相对墙面的水平朝向':''].filter(Boolean).join('、');
 const free=locks.orientation?'机位 1 的水平位置':locks.camera?'机位 1 的水平位置与水平朝向':locks.pose?'机位 1 的位置与朝向':'机位的位置与朝向';
 return '参考机位已按原图独立测量锁定：'+fixed+'。这些量在渲染时会被测量值覆盖，修改无效；机位上仍可调整的只有'+free+'。原图与灰模的左右镜像、某机位被墙体挡住、物体远近不符，应通过移动、镜像或缩放实例与房间结构来修正，而不是改机位。';
}
