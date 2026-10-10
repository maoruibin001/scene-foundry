export const JOINT_FIT='joint-fit-v1';
export const JOINT_FIT_LIMITS={cameraMeanRegression:.002,criticalRowRegression:.01};
export const JOINT_FIT_PROMPT='graybox-space-preview-v13起 跨机位联合门槛：每个候选相对同一来源同时检查全部参考机位。任一机位已测目标的平均边缘残差变差超过0.002、任一关键目标残差变差超过0.01、关键目标从可见变为不可见，或某机位可测关键目标数量减少，或原来可测关键目标的实际测量实例子集改变，该候选不能最终选择。measure_graybox_space与preview_graybox_space都会返回jointFit；先用零Engine测量排除会让另一机位退步的候选，再花真实预览额度。只改善一个机位而牺牲另一机位不是改进。jointFit.cameras列出每机位measured/unverified关键目标数；unverified目标不受此门槛保护、不是0误差，仍须对照原图与实拍判断，也不能据此声称该机位已对齐。';
const round=(n:number)=>Math.round(n*1e5)/1e5;

/** Cross-camera non-regression of one candidate against its frozen source; unverified views are counted, never scored as matches. */
export function jointFitCheck(candidate:any,source:any){
 const cameras=new Map<number,any>(),violations:any[]=[];
 const camera=(referenceIndex:number)=>{if(!cameras.has(referenceIndex))cameras.set(referenceIndex,{referenceIndex,deltas:[],before:[],after:[],sourceCritical:{measured:0,unverified:0},candidateCritical:{measured:0,unverified:0}});return cameras.get(referenceIndex);};
 const scope=(row:any)=>['bound-instance-union','exclusive-instance-subset'].includes(row.comparisonScope)?'measured':'unverified';
 for(const row of source?.rows??[])if(row.critical)camera(row.referenceIndex).sourceCritical[scope(row)]++;
 for(const row of candidate?.rows??[]){
  const c=camera(row.referenceIndex),delta=row.sourceDelta;
  if(row.critical)c.candidateCritical[scope(row)]++;
  if(!delta)continue;
  if(delta.edgeResidual!==null&&row.edgeResidual!==null){c.deltas.push(delta.edgeResidual);c.before.push(row.edgeResidual-delta.edgeResidual);c.after.push(row.edgeResidual);}
  if(row.critical&&delta.identityChanged)violations.push({kind:'critical-target-identity-changed',landmarkId:row.landmarkId,referenceIndex:row.referenceIndex});
  if(row.critical&&delta.visibilityLost)violations.push({kind:'critical-visibility-lost',landmarkId:row.landmarkId,referenceIndex:row.referenceIndex});
  if(row.critical&&delta.edgeResidual!==null&&delta.edgeResidual>JOINT_FIT_LIMITS.criticalRowRegression)violations.push({kind:'critical-row-regression',landmarkId:row.landmarkId,referenceIndex:row.referenceIndex,edgeResidualDelta:delta.edgeResidual,limit:JOINT_FIT_LIMITS.criticalRowRegression});
 }
 const mean=(v:number[])=>v.length?round(v.reduce((a,b)=>a+b,0)/v.length):null;
 const rows=[...cameras.values()].sort((a,b)=>a.referenceIndex-b.referenceIndex).map(c=>{
  const meanDelta=mean(c.deltas);
  if(meanDelta!==null&&meanDelta>JOINT_FIT_LIMITS.cameraMeanRegression)violations.push({kind:'camera-mean-regression',referenceIndex:c.referenceIndex,meanEdgeResidualDelta:meanDelta,limit:JOINT_FIT_LIMITS.cameraMeanRegression});
  if(c.candidateCritical.measured<c.sourceCritical.measured)violations.push({kind:'critical-coverage-reduced',referenceIndex:c.referenceIndex,source:c.sourceCritical.measured,candidate:c.candidateCritical.measured});
  return {referenceIndex:c.referenceIndex,compared:c.deltas.length,meanEdgeResidualBefore:mean(c.before),meanEdgeResidualAfter:mean(c.after),meanEdgeResidualDelta:meanDelta,criticalCoverage:{source:c.sourceCritical,candidate:c.candidateCritical}};
 });
 return {version:JOINT_FIT,limits:JOINT_FIT_LIMITS,cameras:rows,violations,passed:violations.length===0,
  scope:'只覆盖可测量的实例绑定目标；unverified关键目标未受保护，仍须独立评审。'};
}

export function assertJointFit(report:any){
 if(!report.passed)throw Error('GRAYBOX_JOINT_FIT_REGRESSION：候选在部分参考机位退步，不能选择；'+JSON.stringify(report.violations));
}
