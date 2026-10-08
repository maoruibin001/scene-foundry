/** 从已核验同契约记录派生差距与重复策略；不预测分数，也不改变验收阈值。 */
export function repairReflection(quality:any,history:any){
 const connected=(history.attempts??[]).filter(a=>a.relation!=='ancestor-alternative'&&a.scoreComparison?.comparableWithinAttempt&&a.scoreComparison?.comparableToCurrentAssessment);
 const dimensions=(quality?.dimensions??[]).map((d:any)=>{
  const attempts=connected.filter(a=>a.selectedGoals.some(g=>g.dimension===d.id));
  const deltas=attempts.map(a=>({jobId:a.jobId,gain:Number.isFinite(a.dimensionsBefore[d.id])&&Number.isFinite(a.dimensionsAfter[d.id])?Math.round((a.dimensionsAfter[d.id]-a.dimensionsBefore[d.id])*100)/100:null,changes:a.actualChanges,validationKind:a.validationKind}));
  const stalled=attempts.length>=2&&deltas.slice(0,2).every(a=>a.gain!==null&&a.gain<.2);
  return {id:d.id,score:d.score,weight:d.weight,pointsLost:Math.round((d.weight-d.points)*100)/100,attempts:deltas,stalled,action:stalled?'需要新的可验证机制假设，不能只重复同类参数修复':'依据实际缺陷选择可执行修复；分项小幅变化可能有评审波动'};
 }).sort((a,b)=>b.pointsLost-a.pointsLost);
 return {version:'repair-reflection-v2',score:quality?.score,verifiedAttempts:connected.length,dimensions,roundAudits:connected.filter(a=>a.roundAudit).map(a=>({jobId:a.jobId,relation:a.relation,...a.roundAudit})),capabilities:{uvProjection:'新增可验证能力：world-box按最终世界米制坐标投影，长箱六面可统一真实尺度，相邻墙片可共享相位。需要明确metersPerRepeat与origin，通常uvScale=[1,1]；圆筒保留native，不修复原图裁切自带的透视/阴影。',surfaceUpdates:'只输出表面参数，不重写顶点',uvTransform:'支持以单位UV中心翻转、旋转及缩放后偏移；lathe V反向按profile索引',smoothAngle:'在不移动几何的前提下平滑相邻面法线并保留折边'},scope:'只使用已校验来源、真实画面和同评估契约的历史；辅助修复明确标注，不能证明自动首次成功。优先补最大差距，先区分输入证据、表达能力、生成策略、运行与评分问题。'};
}
