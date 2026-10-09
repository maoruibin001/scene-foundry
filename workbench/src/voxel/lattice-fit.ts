import {createHash} from 'node:crypto';

type Vector=[number,number,number];
type Instance={id:string;position:Vector;rotation:Vector;scale:Vector};
type Patch={instances:Instance[];[key:string]:any};
type Measurement={version?:string;source?:{observationSha256?:string};rows:any[];[key:string]:any};
type Target={key:string;targetId:string;instanceIds:string[];expected:number[];edge:number;centre:number;size:number;objective:number};
export type VoxelLatticeFitOptions={
 space:{program:{instances:Instance[]};[key:string]:any};
 basePatch:Patch;
 instanceIds:string[];
 step:number;
 axes:(0|1|2)[];
 measure:(patch:Patch)=>Measurement;
 signal?:AbortSignal;
 maxEvaluations?:number;
};
export const VOXEL_LATTICE_FIT='voxel-lattice-fit-v1';
const TIME_LIMIT_MS=20000;
const EPSILON=1e-6;
const finite=(v:any)=>typeof v==='number'&&Number.isFinite(v);
const vector=(v:any,n=3)=>Array.isArray(v)&&v.length===n&&v.every(finite);
const fail=(ok:any,message:string)=>{if(!ok)throw Error('体素整数布局拟合：'+message);};
const stable=(value:any):string=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const hash=(value:any)=>createHash('sha256').update(stable(value)).digest('hex');
const rectangle=(r:any)=>vector(r,4)&&r.every((n:number)=>n>=0&&n<=1)&&r[0]<r[2]&&r[1]<r[3];
const ids=(row:any)=>Array.isArray(row?.instanceIds)&&row.instanceIds.length>0&&row.instanceIds.every((id:any)=>typeof id==='string'&&id.length)&&new Set(row.instanceIds).size===row.instanceIds.length?row.instanceIds.toSorted():null;
function target(row:any):Target|null{
 if(row?.status!=='measured-visible-extent'||row.comparisonScope!=='bound-instance-union'||typeof row.targetId!=='string'||!row.targetId.length)return null;
 const bindings=ids(row);
 if(!bindings||!rectangle(row.expected)||!rectangle(row.visible)||!finite(row.edgeResidual)||row.edgeResidual<0||!vector(row.centreDelta,2)||!vector(row.spanRatio,2)||row.spanRatio.some((n:number)=>n<=0)||!finite(row.pixels)||row.pixels<8)return null;
 const delta=row.visible.map((n:number,k:number)=>n-row.expected[k]);
 const edge=Math.sqrt(delta.reduce((sum:number,n:number)=>sum+n*n,0)/4);
 const centreDelta=[(delta[0]+delta[2])/2,(delta[1]+delta[3])/2];
 const spans=[0,1].map(k=>row.visible[k+2]-row.visible[k]-(row.expected[k+2]-row.expected[k]));
 // Derive the objective from the frozen rectangles, rather than trusting a candidate's claimed residual.
 if(Math.abs(edge-row.edgeResidual)>1e-4||centreDelta.some((n,k)=>Math.abs(n-row.centreDelta[k])>1e-4))return null;
 const ratios=[0,1].map(k=>(row.visible[k+2]-row.visible[k])/(row.expected[k+2]-row.expected[k]));
 if(ratios.some((n,k)=>Math.abs(n-row.spanRatio[k])>1e-4))return null;
 const centre=Math.hypot(...centreDelta)/Math.SQRT2,size=Math.hypot(...spans)/Math.SQRT2;
 return {key:stable([row.targetId,bindings]),targetId:row.targetId,instanceIds:bindings,expected:[...row.expected],edge,centre,size,objective:edge+centre+size*.5};
}
function measured(report:Measurement){
 fail(report&&typeof report==='object'&&!Array.isArray(report)&&Array.isArray(report.rows),'measure必须返回包含rows的同步测量报告');
 const rows=new Map<string,Target>();
 for(const row of report.rows){const value=target(row);if(!value)continue;fail(!rows.has(value.key),'测量目标身份重复');rows.set(value.key,value);}
 return rows;
}
function compare(source:Map<string,Target>,report:Measurement,sourceReport:Measurement){
 if(report.version!==sourceReport.version||report.source?.observationSha256!==sourceReport.source?.observationSha256)return {error:'原图观察或测量版本改变'};
 const rows=measured(report);
 for(const [key,before] of source){
  const after=rows.get(key);
  if(!after)return {error:'原来可测目标隐藏、丢失、身份改变或数值无效：'+before.targetId};
  if(stable(after.expected)!==stable(before.expected))return {error:'目标范围改变：'+before.targetId};
  if(after.edge>before.edge+EPSILON||after.centre>before.centre+EPSILON||after.size>before.size+EPSILON)return {error:'原来可测目标发生回退：'+before.targetId};
 }
 // Newly visible or unverified targets do not enter the fixed objective or count as zero error.
 return {rows:new Map([...source.keys()].map(key=>[key,rows.get(key)!]))};
}
const objective=(rows:Map<string,Target>)=>[...rows.values()].reduce((sum,row)=>sum+row.objective,0)/rows.size;

/** Source-relative integer translations only. Predictions still require the normal actual preview and independent gates. */
export function fitVoxelLattice(options:VoxelLatticeFitOptions){
 const {signal,measure}=options,maxEvaluations=options.maxEvaluations??24;
 signal?.throwIfAborted();
 fail(Array.isArray(options.instanceIds)&&options.instanceIds.length>0&&options.instanceIds.length<=3&&new Set(options.instanceIds).size===options.instanceIds.length,'只允许1至3个不同来源实例');
 fail(Array.isArray(options.axes)&&options.axes.length>0&&options.axes.length<=2&&new Set(options.axes).size===options.axes.length&&options.axes.every(axis=>Number.isInteger(axis)&&axis>=0&&axis<=2),'每个实例只能拟合1至2个坐标轴');
 fail(finite(options.step)&&options.step>=.001&&options.step<=1,'整数步长须为0.001至1米');
 fail(Number.isInteger(maxEvaluations)&&maxEvaluations>=1&&maxEvaluations<=24,'测量次数须为1至24，包含来源测量');
 fail(typeof measure==='function','缺少同步测量回调');
 const source=options.space?.program?.instances;
 fail(Array.isArray(source)&&source.length>0&&new Set(source.map(i=>i.id)).size===source.length,'来源实例身份无效');
 const originals=new Map(source.map(i=>[i.id,i]));
 for(const id of options.instanceIds){const row=originals.get(id);fail(row&&['position','rotation','scale'].every(key=>vector(row[key])),'只能拟合坐标有效的来源实例：'+id);}
 const base=structuredClone(options.basePatch);
 fail(base&&Array.isArray(base.instances)&&new Set(base.instances.map(i=>i?.id)).size===base.instances.length,'来源补丁instances必须为无重复数组');
 for(const row of base.instances)fail(originals.has(row?.id)&&['position','rotation','scale'].every(key=>vector(row[key])),'来源补丁包含未知实例或无效坐标');
 // Source scene instances also contain template/label/requirements. A repair instance may carry only its frozen identity and pose.
 const basePoses=new Map(options.instanceIds.map(id=>{const row=base.instances.find(i=>i.id===id)??originals.get(id)!;return [id,structuredClone({id,position:row.position,rotation:row.rotation,scale:row.scale})];}));
 const offsets:Record<string,Vector>=Object.fromEntries(options.instanceIds.map(id=>[id,[0,0,0]]));
 const startedAt=Date.now(),attempts:any[]=[],seen=new Set<string>();
 let evaluations=0,termination='converged',sourceMeasurement:Measurement|undefined,sourceTargets:Map<string,Target>|undefined,bestRows:Map<string,Target>|undefined,bestPatch=base,bestObjective=Infinity;
 const limit=()=>{signal?.throwIfAborted();if(Date.now()-startedAt>=TIME_LIMIT_MS){termination='time-budget';return true;}if(evaluations>=maxEvaluations){termination='evaluation-budget';return true;}return false;};
 const evaluate=(patch:Patch,translation:Record<string,Vector>,baseline=false)=>{
  if(limit())return null;
  const patchSha256=hash(patch);if(seen.has(patchSha256))return null;seen.add(patchSha256);evaluations++;
  const row:any={index:evaluations,patch:structuredClone(patch),patchSha256,integerOffsets:structuredClone(translation),status:'invalid',quality:'geometry-prediction-only'};attempts.push(row);
  let report:Measurement;
  try{report=measure(structuredClone(patch));}catch(error){signal?.throwIfAborted();row.error=String(error);return null;}
  signal?.throwIfAborted();
  if(Date.now()-startedAt>=TIME_LIMIT_MS){termination='time-budget';row.status='time-budget';return null;}
  try{
   row.measurementSha256=hash(report);
   let rows:Map<string,Target>;
   if(baseline){rows=measured(report);fail([...rows.values()].every(value=>value.instanceIds.every(id=>originals.has(id))),'可测目标绑定了未知来源实例');sourceMeasurement=structuredClone(report);sourceTargets=rows;if(!rows.size){row.status='no-measurable-targets';termination='no-measurable-targets';return null;}}
   else{const checked=compare(sourceTargets!,report,sourceMeasurement!);if(checked.error){row.status='rejected';row.error=checked.error;return null;}rows=checked.rows!;}
   row.objective=objective(rows);row.targets=[...rows.values()];row.status='measured';
   return {rows,objective:row.objective};
  }catch(error){row.error=String(error);return null;}
 };
 const baseline=evaluate(base,offsets,true);
 if(baseline){bestRows=baseline.rows;bestObjective=baseline.objective;
  // At most two deterministic passes. Each coordinate remains within two steps of the supplied base pose.
  outer:for(let pass=0;pass<2;pass++){
   let passImproved=false;
   for(const id of options.instanceIds)for(const axis of options.axes){
    let selected:any=null;
    const commit=()=>{if(selected){bestRows=selected.rows;bestObjective=selected.objective;bestPatch=selected.patch;Object.assign(offsets,selected.offsets);passImproved=true;}};
    for(const displacement of [-1,1,-2,2]){
     if(limit()){commit();break outer;}if(displacement===offsets[id][axis])continue;
     const candidateOffsets=structuredClone(offsets);candidateOffsets[id][axis]=displacement;
     const patch=structuredClone(base);
     for(const candidateId of options.instanceIds){
      if(!candidateOffsets[candidateId].some(n=>n!==0))continue;
      const pose=structuredClone(basePoses.get(candidateId)!);
      pose.position=pose.position.map((n,k)=>+(n+candidateOffsets[candidateId][k]*options.step).toFixed(12)) as Vector;
      const index=patch.instances.findIndex(i=>i.id===candidateId);if(index<0)patch.instances.push(pose);else patch.instances[index]=pose;
     }
     const result=evaluate(patch,candidateOffsets);
     if(result&&result.objective<bestObjective-EPSILON&&(!selected||result.objective<selected.objective-EPSILON))selected={...result,patch,offsets:candidateOffsets};
     if(termination==='time-budget'){commit();break outer;}
    }
    commit();
   }
   if(!passImproved)break;
  }
 }else if(!['time-budget','no-measurable-targets'].includes(termination))termination='baseline-invalid';
 const improved=!!baseline&&bestObjective<baseline.objective-EPSILON;
 return {patch:structuredClone(improved?bestPatch:base),report:{version:VOXEL_LATTICE_FIT,quality:'not-assessed',method:'最多3实例、2轴、相对来源至多正负2格的有界整数坐标下降；只比较唯一绑定的可测原图目标',requiresActualPreview:true,requiresIndependentAcceptance:true,
  instanceIds:[...options.instanceIds],axes:[...options.axes],step:options.step,integerOffsets:improved?structuredClone(offsets):Object.fromEntries(options.instanceIds.map(id=>[id,[0,0,0]])),improved,status:improved?'prediction-improved':'not-improved',termination,
  evaluations,maxEvaluations,timeLimitMs:TIME_LIMIT_MS,elapsedMs:Date.now()-startedAt,basePatchSha256:hash(base),selectedPatchSha256:hash(improved?bestPatch:base),sourceMeasurementSha256:sourceMeasurement?hash(sourceMeasurement):null,
  before:baseline?{objective:baseline.objective,targets:[...baseline.rows.values()]}:null,after:baseline?{objective:improved?bestObjective:baseline.objective,targets:[...(improved?bestRows!:baseline.rows).values()]}:null,attempts,
  limitations:'矩形来自观察，不是像素分割或质量分；未验证目标不进入目标函数。同步回调不能在内部被抢占，超时结果不会被选用。所有候选仍须冻结边界、开口、接触校验，并实际Engine预览及独立原图验收。'}};
}
