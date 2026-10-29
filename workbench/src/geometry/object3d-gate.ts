/**
 * object3d-gate-v1, per job like the other graybox policies, so recorded runs replay unchanged.
 *
 * The graybox gate was the model's 0-5 space review. On the ground-truth benchmark (bench/gt, 18 Hypersim interiors, 2026-10-27..29) it
 * ranked 8 of 12 known-worse layouts correctly and ran against the truth on real interiors (ρ −0.31); so did the 2D landmark residual
 * (ρ −0.43, −0.13 with measured cameras): a layout can match every reference box while its objects sit at the wrong depth.
 *
 * object3d-v1 measures that depth. Per observed landmark it compares the graybox position of its bound instances, seen from the reference
 * camera, with the MoGe-2 point map of the reference image inside the landmark's observation box (one scale per view). Against
 * label-free truth from Hypersim depth and instance masks: per landmark ρ 0.84 [0.74, 0.90] (203 landmark-views), per scene ρ 0.75
 * [0.40, 0.91] (18 scenes, measured cameras), 11 of 12 known-worse variants ranked worse, including objects pushed back and enlarged so
 * they look the same in view 1. Under the policy a round passes on object3d plus the measured checks (critical landmarks visible, not
 * mirrored, camera clear); the review still runs and becomes repair feedback, but no longer decides.
 *
 * Limit .35: on the benchmark a scene whose landmarks are off by 25-35% of their distance on average is the boundary between layouts the
 * truth puts mostly right and mostly wrong (truth error per landmark: median .21).
 */
import {join} from 'node:path';
import {existsSync,readFileSync} from 'node:fs';
import {digest,save} from '../store';
import {compileGeometryProgram} from './program';
import {basis,cameraRay,rayScene} from './camera-fit';

export const OBJECT3D_GATE={version:'object3d-gate-v1',judge:'object3d-v1',tool:'moge-2'} as const;
export const OBJECT3D_LIMITS={score:.35,gridWidth:64,gridHeight:48,feedbackRows:8,feedbackError:.35};
const MEASURE=join(import.meta.dir,'measure-points.py'),JUDGE=join(import.meta.dir,'object3d-judge.py'),GRID=join(import.meta.dir,'object3d-grid-cli.ts');
const DEFAULT_MODEL='Ruicheng/moge-2-vitl-normal';
/** Checks that stay with object3d; the judge-row checks (evidence, critical-present, critical-floor) and the 2D residual checks do not. */
const KEPT=['critical-visible','not-mirrored','camera-clear'];

export function object3dRule(job:any){return job?.object3dGatePolicy?.version===OBJECT3D_GATE.version;}
export function object3dPolicyFor(sceneKind:string,env=process.env){return sceneKind!=='voxel'&&env.PIPELINE_FOV_PYTHON&&env.PIPELINE_OBJECT3D_GATE!=='0'?{...OBJECT3D_GATE,model:env.PIPELINE_FOV_MODEL||DEFAULT_MODEL}:null;}

async function python(args:string[],signal?:AbortSignal){
 const bin=process.env.PIPELINE_FOV_PYTHON;if(!bin)throw Error('object3d-gate-v1 需要 PIPELINE_FOV_PYTHON');
 const p=Bun.spawn([bin,'-I',...args],{stdout:'pipe',stderr:'pipe',signal,env:process.env});
 const [out,err,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);
 if(code)throw Error(err.slice(-600));return JSON.parse(out.trim().split('\n').at(-1)!);
}

/** Once per job: the reference point maps the gate compares against, under generation/reference-points. */
export async function measureReferencePoints(job:any,images:{path:string}[],dir:string,signal?:AbortSignal){
 const out=join(dir,'generation/reference-points');let views:any[];
 try{views=await python([MEASURE,job.object3dGatePolicy.model,out,...images.map(i=>i.path)],signal);}catch(e){throw Error('参考图点云测量失败：'+String(e));}
 if(views.length!==images.length||views.some((v:any)=>!(v.valid>.2)))throw Error('参考图点云测量结果无效');
 const record={version:OBJECT3D_GATE.version,tool:OBJECT3D_GATE.tool,model:job.object3dGatePolicy.model,dir:'generation/reference-points',
  views:views.map((v:any,i:number)=>({...v,imageSha256:digest(readFileSync(images[i].path)),pointsSha256:digest(readFileSync(join(out,v.file)))}))};
 save(join(dir,'generation/reference-points.json'),record);return record;
}

/** Ray hits of the rendered scene from each perspective reference camera: [instanceId, x, y, z] in OpenCV camera axes, or null. */
export function object3dGrid(scene:any,W=OBJECT3D_LIMITS.gridWidth,H=OBJECT3D_LIMITS.gridHeight){
 const meshes=compileGeometryProgram({...scene.program,materials:scene.program.materials.map((m:any)=>({...m,textureId:null,surfaceDetail:null}))}).meshes.map((m:any)=>({...m,name:m.entityId}));
 const cast=rayScene(meshes,{doubleSided:true}),dot=(a:number[],b:number[])=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],views:any={};
 for(const c of scene.cameras.filter((x:any)=>Number.isInteger(x.referenceIndex)&&x.projection!=='orthographic')){
  const b=basis(c),grid:any[]=[];
  for(let j=0;j<H;j++)for(let i=0;i<W;i++){const r=cameraRay(c,[(i+.5)/W,(j+.5)/H]),h=cast(r.origin,r.direction);if(!h){grid.push(null);continue;}
   const d=h.point.map((v:number,k:number)=>v-c.position[k]);grid.push([h.meshId,dot(d,b.right),-dot(d,b.up),dot(d,b.forward)]);}
  views[c.referenceIndex]={W,H,grid};
 }
 return {bindings:Object.fromEntries((scene.observedBindings??[]).map((b:any)=>[b.landmarkId,b.instanceIds])),views};
}

/** Judge one rendered round (folder holds render-scene.json); writes object3d.json beside it. */
export async function judgeObject3d(folder:string,runDir:string,signal?:AbortSignal){
 const observation=join(runDir,'generation/reference-observations.json');
 if(!existsSync(observation))throw Error('object3d 评审缺少原图观察记录');
 // Ray-casting two 64×48 grids takes tens of seconds on a full graybox; a child process keeps the server's API answering meanwhile.
 const g=Bun.spawn([process.execPath,GRID,join(folder,'render-scene.json'),join(folder,'object3d-grid.json')],{stdout:'pipe',stderr:'pipe',signal});
 const [gerr,gcode]=await Promise.all([new Response(g.stderr).text(),g.exited]);if(gcode)throw Error('object3d 射线网格失败：'+gerr.slice(-600));
 let result:any;try{result=await python([JUDGE,join(folder,'object3d-grid.json'),observation,join(runDir,'generation/reference-points')],signal);}catch(e){throw Error('object3d 评审失败：'+String(e));}
 if(!Number.isFinite(result.score))throw Error('object3d 评审没有可测地标');
 save(join(folder,'object3d.json'),result);return result;
}

/** The objective gate under the policy: object3d plus the measured checks it keeps; `passed` is this verdict, the review is advisory. */
export function withObject3dAcceptance(gate:any,result:any){
 const kept=(gate.objective?.checks??[]).filter((c:any)=>KEPT.includes(c.id));
 const check={id:'object3d',passed:result.score<=OBJECT3D_LIMITS.score,detail:'地标三维位置误差 '+result.score+'（'+result.rows+' 项，'+result.invisible+' 项不可见），上限 '+OBJECT3D_LIMITS.score};
 const checks=[...kept,check],failed=checks.filter((c:any)=>!c.passed);
 return {...gate,passed:!failed.length,vlmPassed:gate.vlmPassed??gate.passed,
  objective:{version:OBJECT3D_GATE.version,passed:!failed.length,checks,reasons:failed.map((c:any)=>c.detail),metrics:{object3d:result.score,rows:result.rows,invisible:result.invisible},
   advisory:{score:gate.review.score,note:'模型空间评审仅作修复参考，不参与灰模放行'}},
  object3d:{version:result.version,score:result.score,rows:result.rows,invisible:result.invisible}};
}

const failedChecks=(g:any)=>(g.objective?.checks??[]).filter((c:any)=>!c.passed).length;
/** Negative when `a` is closer to acceptance: fewer failed checks, then the lower object3d score. */
export function compareObject3d(a:any,b:any){return failedChecks(a)-failedChecks(b)||a.object3d.score-b.object3d.score;}
export const OBJECT3D_PROGRESS='object3d-progress-v1';
/** Plateau score in its own ledger family: 25 per failed kept check plus 100 × (1 − object3d), so a .02 drop in error is the 2-point gain. */
export function object3dProgressScore(gate:any){const kept=gate.objective.checks.filter((c:any)=>!c.passed&&c.id!=='object3d').length;return Math.round((100*(1-gate.object3d.score)-25*kept)*100)/100;}

/** Repair input: the landmarks the gate measured furthest from the reference, with whether each sits too near or too far. */
export function object3dRepairFeedback(gate:any,folder:string){
 if(!gate?.object3d||gate.passed||!existsSync(join(folder,'object3d.json')))return null;
 const r=JSON.parse(readFileSync(join(folder,'object3d.json'),'utf8'));
 const worst=r.landmarks.filter((x:any)=>x.error>=OBJECT3D_LIMITS.feedbackError).sort((a:any,b:any)=>(b.critical-a.critical)||(b.error-a.error)).slice(0,OBJECT3D_LIMITS.feedbackRows)
  .map((x:any)=>({landmarkId:x.landmarkId,label:x.label,referenceIndex:x.referenceIndex,error:x.error,
   issue:!x.visible?'绑定实例在该参考机位不可见':x.depthRatio===null?'位置偏差':x.depthRatio<.85?'离相机过近（深度约为原图 '+Math.round(x.depthRatio*100)+'%）':x.depthRatio>1.15?'离相机过远（深度约为原图 '+Math.round(x.depthRatio*100)+'%）':'在画面平面内偏移'}));
 return {version:OBJECT3D_GATE.version,score:r.score,limit:OBJECT3D_LIMITS.score,failed:gate.objective.checks.filter((c:any)=>!c.passed).map((c:any)=>({id:c.id,detail:c.detail})),
  note:'误差是地标灰模位置与原图单目三维测量的相对距离偏差；按 issue 调整实例前后位置与尺寸，不要只为对齐画面框放大或拉近物体',landmarks:worst};
}
