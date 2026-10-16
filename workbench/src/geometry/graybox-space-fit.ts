import {createHash} from 'node:crypto';
import {CAMERA_FOV} from './constraints';

type Vector=[number,number,number];
export type GrayboxSpaceFitOptions={
 space:{program:{instances:any[]};cameras:any[];[key:string]:any};
 basePatch:any;
 instanceIds:string[];
 referenceIndices:number[];
 measure:(patch:any)=>any;
 sourceReport:()=>any;
 jointFit:(report:any)=>any;
 signal?:AbortSignal;
 maxEvaluations?:number;
};
export const GRAYBOX_SPACE_FIT='graybox-space-fit-v1';
export const GRAYBOX_SPACE_FIT_LIMITS={calls:2,evaluationsPerCall:160,evaluations:320,timeLimitMs:60000,instances:6,cameras:2};
/** Only ordinary jobs created under the policy get the numeric fit; historical repairs replay without it. */
export function spaceFitRule(job:any){return job?.grayboxFitPolicy===GRAYBOX_SPACE_FIT;}
export const GRAYBOX_SPACE_FIT_PROMPT='graybox-space-fit-v1 本任务另可调用fit_graybox_space：先写出依据原图的完整basePatch（可只含reason/checks与parts/groups/templates等结构改动，instances/cameras可为空），再列出最多6个与阻塞关系直接相关的已有实例和最多2个referenceIndex参考机位。程序用零Engine编译几何测量，对所列实例的位置（0.5米步长起逐步减半）、统一缩放（来源0.5至2倍内）及所列参考机位的位置、偏航、俯仰与fov作有界坐标下降，目标是降低各机位已测目标平均边缘残差之和，每个被采用的候选都须通过jointFit，已测目标丢失的候选不采用。手工逐项微调每机位只能改善约0.01时应先用它；关键关系的占幅、纵深、交接错位时建议在第一次真实预览前拟合。每轮最多2次拟合、合计320次测量、每次60秒，失败与无改善也计入，重试与恢复不重置。它只拟合可测范围，不改变实体、模板、需求或原图目标，unverified目标不进入目标函数也不能因此视为已对齐。返回patch只是几何预测：须把该完整patch交给preview_graybox_space看真实画面，对照原图确认没有遮挡主体、穿插或借机位隐藏结构，最终只选择真实预览过的摘要。';
const EPSILON=1e-4;
const finite=(v:any)=>typeof v==='number'&&Number.isFinite(v);
const vector=(v:any)=>Array.isArray(v)&&v.length===3&&v.every(finite);
const fail=(ok:any,message:string)=>{if(!ok)throw Error('灰模数值拟合：'+message);};
const stable=(value:any):string=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const hash=(value:any)=>createHash('sha256').update(stable(value)).digest('hex');
const round=(n:number)=>Math.round(n*1e5)/1e5;
const fixed=(n:number)=>+n.toFixed(6);

// Rows compared against the frozen source, keyed by target, view and binding; the objective set is fixed by the baseline.
function compared(report:any){
 fail(report&&typeof report==='object'&&Array.isArray(report.rows),'measure必须返回包含rows的同步测量报告');
 const seen=new Map<string,number>(),rows=new Map<string,any>();
 for(const row of report.rows){
  if(!row?.sourceDelta||row.sourceDelta.edgeResidual===null||!finite(row.edgeResidual)||!Number.isInteger(row.referenceIndex))continue;
  const key=stable([row.targetId??row.landmarkId,row.referenceIndex,[...(row.instanceIds??[])].sort()]),n=seen.get(key)??0;seen.set(key,n+1);rows.set(key+'#'+n,row);
 }
 return rows;
}
function score(keys:string[],rows:Map<string,any>){
 const cameras=new Map<number,number[]>();
 for(const key of keys){const row=rows.get(key);if(!row)return null;if(!cameras.has(row.referenceIndex))cameras.set(row.referenceIndex,[]);cameras.get(row.referenceIndex)!.push(row.edgeResidual);}
 const means=[...cameras].sort((a,b)=>a[0]-b[0]).map(([referenceIndex,v])=>({referenceIndex,targets:v.length,meanEdgeResidual:v.reduce((a,b)=>a+b,0)/v.length}));
 return {objective:means.reduce((s,c)=>s+c.meanEdgeResidual,0),cameras:means.map(c=>({...c,meanEdgeResidual:round(c.meanEdgeResidual)}))};
}

/** Source-relative bounded descent over listed instance poses and reference cameras. Predictions still require the normal actual preview and independent gates. */
export function fitGrayboxSpace(options:GrayboxSpaceFitOptions){
 const {signal,measure,jointFit,space}=options,maxEvaluations=options.maxEvaluations??GRAYBOX_SPACE_FIT_LIMITS.evaluationsPerCall;
 signal?.throwIfAborted();
 fail(Array.isArray(options.instanceIds)&&options.instanceIds.length<=GRAYBOX_SPACE_FIT_LIMITS.instances&&new Set(options.instanceIds).size===options.instanceIds.length,'最多6个不重复的已有实例');
 fail(Array.isArray(options.referenceIndices)&&options.referenceIndices.length<=GRAYBOX_SPACE_FIT_LIMITS.cameras&&new Set(options.referenceIndices).size===options.referenceIndices.length,'最多2个不重复的参考机位');
 fail(options.instanceIds.length+options.referenceIndices.length>0,'至少列出一个实例或参考机位');
 fail(Number.isInteger(maxEvaluations)&&maxEvaluations>=1&&maxEvaluations<=GRAYBOX_SPACE_FIT_LIMITS.evaluationsPerCall,'测量次数须为1至160，包含基线');
 const base=structuredClone(options.basePatch);
 fail(base&&typeof base==='object'&&Array.isArray(base.instances)&&Array.isArray(base.cameras)&&Array.isArray(base.checks)&&base.checks.length>0,'basePatch须为含instances/cameras及至少一项checks的完整补丁');
 const sources=new Map(space.program.instances.map((i:any)=>[i.id,i]));
 const vars:any[]=[],instances=options.instanceIds.map(id=>{
  const source:any=sources.get(id);fail(source&&['position','rotation','scale'].every(k=>vector(source[k])),'只能拟合坐标有效的已有实例：'+id);
  const edit=base.instances.find((i:any)=>i?.id===id),pose=edit??source;fail(['position','rotation','scale'].every(k=>vector(pose[k])),'basePatch实例坐标无效：'+id);
  for(const axis of [0,1,2])vars.push({kind:'position',id,axis,step:.5});vars.push({kind:'scale',id,step:.1});
  return {id,source,pose:{id,position:[...pose.position],rotation:[...pose.rotation],scale:[...pose.scale]}};
 });
 const cameras=options.referenceIndices.map(referenceIndex=>{
  const matches=space.cameras.filter((c:any)=>c.referenceIndex===referenceIndex);fail(Number.isInteger(referenceIndex)&&matches.length===1,'参考机位必须唯一存在：'+referenceIndex);
  const source=matches[0],edit=base.cameras.find((c:any)=>c?.name===source.name),pose=edit??source;fail(vector(pose.position)&&vector(pose.target)&&finite(pose.fov),'basePatch机位参数无效：'+source.name);
  for(const axis of [0,1,2])vars.push({kind:'camera-position',name:source.name,axis,step:.5});vars.push({kind:'camera-yaw',name:source.name,step:.04},{kind:'camera-pitch',name:source.name,step:.03});
  if(source.projection!=='orthographic')vars.push({kind:'camera-fov',name:source.name,step:.05});
  return {name:source.name,pose:{name:source.name,position:[...pose.position],target:[...pose.target],fov:pose.fov,...(edit&&Object.hasOwn(edit,'orthographicHeight')?{orthographicHeight:edit.orthographicHeight}:{})}};
 });
 // Out-of-contract candidates are skipped before measurement and never consume budget.
 const candidate=(x:number[])=>{
  const patch=structuredClone(base),delta=(match:(v:any)=>boolean)=>vars.reduce((d:any,v,j)=>{if(match(v)&&x[j])d[v.kind+(v.axis??'')]=x[j];return d;},{});
  for(const row of instances){
   const d=delta(v=>v.id===row.id);if(!Object.keys(d).length)continue;
   const f=1+(d.scale??0),pose={...structuredClone(row.pose),position:row.pose.position.map((n,k)=>fixed(n+(d['position'+k]??0))) as Vector,scale:row.pose.scale.map(n=>fixed(n*f)) as Vector};
   if(pose.scale.some((n,k)=>n/row.source.scale[k]<.5||n/row.source.scale[k]>2))return null;
   const index=patch.instances.findIndex((i:any)=>i.id===row.id);if(index<0)patch.instances.push(pose);else patch.instances[index]=pose;
  }
  for(const row of cameras){
   const d=delta(v=>v.name===row.name);if(!Object.keys(d).length)continue;
   const p=row.pose.position,t=row.pose.target,dir=t.map((n,k)=>n-p[k]),dist=Math.hypot(...dir);if(dist<1e-6)return null;
   const yaw=Math.atan2(dir[1],dir[0])+(d['camera-yaw']??0),pitch=Math.atan2(dir[2],Math.hypot(dir[0],dir[1]))+(d['camera-pitch']??0),fov=fixed(row.pose.fov+(d['camera-fov']??0));
   if(Math.abs(pitch)>1.45||fov<CAMERA_FOV.min||fov>CAMERA_FOV.max)return null;
   const position=p.map((n,k)=>fixed(n+(d['camera-position'+k]??0))),target=[position[0]+Math.cos(pitch)*Math.cos(yaw)*dist,position[1]+Math.cos(pitch)*Math.sin(yaw)*dist,position[2]+Math.sin(pitch)*dist].map(fixed);
   const pose={...structuredClone(row.pose),position,target,fov},index=patch.cameras.findIndex((c:any)=>c.name===row.name);if(index<0)patch.cameras.push(pose);else patch.cameras[index]=pose;
  }
  return patch;
 };
 const startedAt=Date.now(),attempts:any[]=[],seen=new Set<string>();
 let evaluations=0,termination='converged';
 const limit=()=>{signal?.throwIfAborted();if(Date.now()-startedAt>=GRAYBOX_SPACE_FIT_LIMITS.timeLimitMs){termination='time-budget';return true;}if(evaluations>=maxEvaluations){termination='evaluation-budget';return true;}return false;};
 // An unchanged basePatch measures as the source itself; any other invalid base is rejected before budget is spent.
 let baseReport:any;evaluations++;seen.add(hash(base));
 try{baseReport=measure(structuredClone(base));}catch(error){signal?.throwIfAborted();if(!String(error).includes('NO_ACTIONABLE_CHANGE'))throw Error('灰模数值拟合：basePatch无法测量，先修正后再拟合；'+String(error).slice(0,600));baseReport=options.sourceReport();}
 const keys=[...compared(baseReport).keys()],baseScore=score(keys,compared(baseReport))!,baseFit=jointFit(baseReport);
 const baseline={patch:base,objective:baseScore.objective,cameras:baseScore.cameras,jointFit:baseFit};
 attempts.push({index:1,objective:round(baseScore.objective),passed:baseFit.passed,baseline:true});
 let best=baseline,x=vars.map(()=>0);
 if(!keys.length)termination='no-measurable-targets';
 else{
  const steps=vars.map(v=>v.step);
  const evaluate=(y:number[])=>{
   const patch=candidate(y);if(!patch)return null;const patchSha256=hash(patch);if(seen.has(patchSha256))return null;seen.add(patchSha256);evaluations++;
   const row:any={index:evaluations};attempts.push(row);
   let report:any;try{report=measure(structuredClone(patch));}catch(error){signal?.throwIfAborted();row.status='invalid';row.error=String(error).slice(0,300);return null;}
   const s=score(keys,compared(report));if(!s){row.status='target-lost';return null;}
   const check=jointFit(report);row.objective=round(s.objective);row.passed=check.passed;
   return {patch,objective:s.objective,cameras:s.cameras,jointFit:check};
  };
  // A failing base may be traded for any passing candidate; afterwards only feasible gains are taken.
  const better=(r:any)=>r&&r.jointFit.passed&&(!best.jointFit.passed||r.objective<best.objective-EPSILON);
  // Cyclic coordinate descent: keep the first feasible gain per coordinate; halve all steps after a sweep without gain.
  outer:for(let halvings=0;halvings<4;){
   let improved=false;
   for(let j=0;j<vars.length;j++)for(const sign of [-1,1]){
    if(limit())break outer;
    const y=[...x];y[j]=+(y[j]+sign*steps[j]).toFixed(9);const result=evaluate(y);
    if(better(result)){best=result!;x=y;improved=true;break;}
   }
   if(!improved){halvings++;steps.forEach((_,j)=>steps[j]/=2);}
  }
 }
 const improved=best!==baseline;
 return {patch:structuredClone(best.patch),report:{version:GRAYBOX_SPACE_FIT,quality:'not-assessed',method:'所列实例位置/统一缩放与参考机位位置/朝向/fov的有界贪心坐标下降；目标为基线已测目标各机位平均边缘残差之和，候选须通过jointFit',requiresActualPreview:true,requiresIndependentAcceptance:true,
  instanceIds:[...options.instanceIds],referenceIndices:[...options.referenceIndices],improved,status:improved?'prediction-improved':'not-improved',termination,evaluations,maxEvaluations,timeLimitMs:GRAYBOX_SPACE_FIT_LIMITS.timeLimitMs,elapsedMs:Date.now()-startedAt,
  basePatchSha256:hash(base),selectedPatchSha256:hash(best.patch),moves:vars.flatMap((v,j)=>x[j]?[{kind:v.kind,...(v.id?{id:v.id}:{name:v.name}),...(v.axis!==undefined?{axis:v.axis}:{}),delta:round(x[j])}]:[]),
  before:{objective:round(baseline.objective),cameras:baseline.cameras,jointFitPassed:baseline.jointFit.passed},after:{objective:round(best.objective),cameras:best.cameras,jointFit:best.jointFit},attempts,
  limitations:'只比较基线已测原图目标的矩形残差，不是像素分割或质量分；unverified目标不进入目标函数。所有候选仍须冻结边界、开口、接触校验，并实际Engine预览及独立原图验收。'}};
}
