export const JOINT_FIT='joint-fit-v1';
export const JOINT_FIT_LIMITS={cameraMeanRegression:.002,criticalRowRegression:.01};
export const JOINT_FIT_PROMPT='graybox-space-preview-v13起 跨机位联合门槛：每个候选相对同一来源同时检查全部参考机位。任一机位已测目标的平均边缘残差变差超过0.002、任一关键目标残差变差超过0.01、关键目标从可见变为不可见，或某机位可测关键目标数量减少，或原来可测关键目标的实际测量实例子集改变，该候选不能最终选择。measure_graybox_space与preview_graybox_space都会返回jointFit；先用零Engine测量排除会让另一机位退步的候选，再花真实预览额度。只改善一个机位而牺牲另一机位不是改进。jointFit.cameras列出每机位measured/unverified关键目标数；unverified目标不受此门槛保护、不是0误差，仍须对照原图与实拍判断，也不能据此声称该机位已对齐。';
export const JOINT_FIT_NET='joint-fit-net-v1';
export const JOINT_FIT_NET_LIMITS={cameraMeanGain:.01,criticalRowCap:.03,rowsPerCamera:1};
export const JOINT_FIT_NET_PROMPT='joint-fit-net-v1 本任务的jointFit另允许净改善：某机位已测目标平均残差至少改善0.01时，该机位最多1个关键目标残差变差不超过0.03可容忍（列入jointFit.tolerated），其余门槛不变；被容忍目标仍须对照实拍检查，不能宣称已对齐。若两个真实预览都未通过jointFit，仍须如实选择较好的一个并说明，程序会把本轮记为无增益并保留较好来源，不会采用该候选。';
/** Only jobs created under the policy tolerate net-improving rows and continue past blocked rounds; historical jobs replay strictly. */
export function jointFitRule(job:any){return job?.jointFitPolicy===JOINT_FIT_NET;}
const round=(n:number)=>Math.round(n*1e5)/1e5;

/** Cross-camera non-regression of one candidate against its frozen source; unverified views are counted, never scored as matches. */
export function jointFitCheck(candidate:any,source:any,options:{net?:boolean}={}){
 const cameras=new Map<number,any>(),violations:any[]=[];
 const camera=(referenceIndex:number)=>{if(!cameras.has(referenceIndex))cameras.set(referenceIndex,{referenceIndex,deltas:[],before:[],after:[],sourceCritical:{measured:0,unverified:0},candidateCritical:{measured:0,unverified:0}});return cameras.get(referenceIndex);};
 const scope=(row:any)=>['bound-instance-union','exclusive-instance-subset','exclusive-part-subset'].includes(row.comparisonScope)?'measured':'unverified';
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
 // A single bounded critical regression is tolerated only where the same camera improves on net.
 const tolerated=options.net===true?rows.flatMap(c=>{const rowsHere=violations.filter(v=>v.kind==='critical-row-regression'&&v.referenceIndex===c.referenceIndex);return c.meanEdgeResidualDelta!==null&&c.meanEdgeResidualDelta<=-JOINT_FIT_NET_LIMITS.cameraMeanGain&&rowsHere.length<=JOINT_FIT_NET_LIMITS.rowsPerCamera&&rowsHere.every(v=>v.edgeResidualDelta<=JOINT_FIT_NET_LIMITS.criticalRowCap)?rowsHere:[];}):[];
 const blocking=violations.filter(v=>!tolerated.includes(v));
 return {version:options.net===true?JOINT_FIT_NET:JOINT_FIT,limits:options.net===true?{...JOINT_FIT_LIMITS,net:JOINT_FIT_NET_LIMITS}:JOINT_FIT_LIMITS,cameras:rows,violations:blocking,...(options.net===true?{tolerated}:{}),passed:blocking.length===0,
  scope:'只覆盖可测量的实例绑定目标；unverified关键目标未受保护，仍须独立评审。'};
}

export function assertJointFit(report:any){
 if(!report.passed)throw Error('GRAYBOX_JOINT_FIT_REGRESSION：候选在部分参考机位退步，不能选择；'+JSON.stringify(report.violations));
}
