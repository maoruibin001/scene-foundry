// Derive current progress from execution evidence; completed round verdicts stay immutable.
export function spatialProgress(job) {
  const rounds = job.blockout?.rounds ?? [];
  const last = rounds.at(-1);
  const nextRound = last ? last.round + 2 : 1;
  const prior = last && !last.passed ? `第 ${last.round + 1} 轮未通过（${last.review?.score ?? '未评分'}/5）` : '';
  const running = job.status === 'running';
  const stage = job.stages?.[job.stage];
  const fresh = !last || !Number.isFinite(last.endedAt) || stage?.startedAt >= last.endedAt;
  if (running && stage?.status === 'running' && fresh) {
    if (job.stage === 'graybox') return {
      status: 'running', round: nextRound, label: `第 ${nextRound} 轮验收中`,
      detail: `${prior ? prior + '；空间修正已完成，' : ''}正在生成、运行并检查灰模。通过后才进入详细资产生成。`,
    };
    if (job.stage === 'space' && prior) return {
      status: 'repairing', round: nextRound, label: '正在自动修正空间',
      detail: `${prior}；正在修正空间与参考机位，完成后进行第 ${nextRound} 轮灰模验收。任务仍在执行。`,
    };
  }
  if (!job.blockout) return null;
  if (last?.passed || job.blockout.status === 'passed') return {
    status: 'passed', round: last ? last.round + 1 : null, label: '空间验收通过',
    detail: '灰模空间验收已通过；成品仍需视觉与制作规范验收。',
  };
  if (['cancelled', 'blocked'].includes(job.status)) return {
    status: job.status, round: nextRound, label: job.status === 'cancelled' ? '验收已取消' : '验收执行受阻',
    detail: `${prior ? prior + '；' : ''}当前未继续验收，请查看执行诊断与恢复状态。`,
  };
  if(job.diagnosis?.decision.action==='diagnose')return {status:'failed',round:last?last.round+1:null,label:'已转入原因分析',detail:job.diagnosis.decision.reason+'；请查看原因分析与优化方案。'};
  return {
    status: 'failed', round: last ? last.round + 1 : null, label: '空间验收未通过',
    detail: `${prior || '尚无通过的灰模结果'}；${running ? '等待后续处理。' : '本次任务已停止，详细资产未获放行。'}`,
  };
}

export function spatialTimingStage(stage, job) {
  if (stage.id !== 'graybox') return stage;
  const progress = spatialProgress(job);
  if (!progress) return stage;
  return { ...stage, status: progress.status, statusLabel: progress.label, statusDetail: progress.detail };
}
