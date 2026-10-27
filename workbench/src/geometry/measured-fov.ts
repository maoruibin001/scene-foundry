/**
 * measured-fov-v1, per job like the other geometry policies, so recorded runs replay unchanged.
 *
 * The reference cameras' vertical FoV was a model guess. On the ground-truth benchmark (bench/gt, 18 Hypersim interiors, 2026-10-27)
 * it was 12.5° too wide on average (up to 25°), and the later 2D repairs fit object boxes to that wrong FoV: objects grew or moved
 * toward the camera to keep their framing, so the 2D residual stayed low while the 3D layout was wrong. MoGe-2 single-image intrinsics
 * read the vertical FoV within about 2° on the same views and on known-zoom crops (true 26.8–46.8°).
 *
 * Under the policy the FoV is measured once per job from the reference images and locks every reference perspective camera in
 * bindReferenceFrames, the step every reference render and composition measurement goes through. The tool is optional and comes from
 * the environment (PIPELINE_FOV_PYTHON: a Python with moge installed; PIPELINE_FOV_MODEL: model id); without it the policy is off.
 */
import {join} from 'node:path';
import {mkdirSync,readFileSync} from 'node:fs';
import {digest,save} from '../store';

export const MEASURED_FOV={version:'measured-fov-v1',tool:'moge-2'} as const;
const SCRIPT=join(import.meta.dir,'measure-fov.py');
const DEFAULT_MODEL='Ruicheng/moge-2-vitl-normal';

export function measuredFovRule(job:any){return job?.measuredFovPolicy?.version===MEASURED_FOV.version;}
export function measuredFovPolicyFor(sceneKind:string,env=process.env){return sceneKind!=='voxel'&&env.PIPELINE_FOV_PYTHON?{...MEASURED_FOV,model:env.PIPELINE_FOV_MODEL||DEFAULT_MODEL}:null;}
/** The measured vertical FoV for reference image `index` (0-based), or undefined when the job has none. */
export function measuredVfov(job:any,index:number):number|undefined{const v=job?.referenceIntrinsics?.views?.[index]?.vfov;return measuredFovRule(job)&&Number.isFinite(v)?v:undefined;}

export async function measureReferenceFov(job:any,images:{path:string}[],dir:string,signal?:AbortSignal){
 const python=process.env.PIPELINE_FOV_PYTHON;if(!python)throw Error('measured-fov-v1 需要 PIPELINE_FOV_PYTHON');
 const p=Bun.spawn([python,'-I',SCRIPT,job.measuredFovPolicy.model,...images.map(i=>i.path)],{stdout:'pipe',stderr:'pipe',signal,env:process.env});
 const [out,err,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);
 if(code)throw Error('参考图视场测量失败：'+err.slice(-600));
 const views=JSON.parse(out.trim().split('\n').at(-1)!).map((v:any,i:number)=>({referenceIndex:i+1,vfov:v.vfov,hfov:v.hfov,imageSha256:digest(readFileSync(images[i].path))}));
 if(views.length!==images.length||views.some((v:any)=>!(v.vfov>.3&&v.vfov<2.2)))throw Error('参考图视场测量结果无效');
 const record={version:MEASURED_FOV.version,tool:MEASURED_FOV.tool,model:job.measuredFovPolicy.model,views};mkdirSync(join(dir,'generation'),{recursive:true});save(join(dir,'generation/reference-intrinsics.json'),record);return record;
}

export function measuredFovGuidance(job:any){
 if(!measuredFovRule(job)||!job.referenceIntrinsics)return '';
 const views=job.referenceIntrinsics.views.map((v:any)=>`图${v.referenceIndex} ${v.vfov.toFixed(3)} 弧度（约 ${(v.vfov*180/Math.PI).toFixed(1)}°）`).join('，');
 return `参考图的垂直视场已由独立的单目几何测量得出：${views}，误差约 ±2°。参考机位的 fov 必须使用这些值，程序渲染时也会固定为测量值；物体尺寸与机位距离要按此视场推算，不要用更宽的视场把物体放近或放大来对齐画面。`;
}
