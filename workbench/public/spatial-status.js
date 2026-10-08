// Derive current progress from execution evidence; completed round verdicts stay immutable.
export function spatialProgress(job) {
  const rounds = job.blockout?.rounds ?? [];
  const last = rounds.at(-1);
  const nextRound = last ? last.round + 2 : 1;
  const prior = last && !last.passed ? `第 ${last.round + 1} 轮未通过（${last.review?.score ?? '未评分'}/5）` : '';
  const running = job.status === 'running';
  // Surface preparation may run beside graybox; job.stage is only the last event.
  const active = ['graybox','space'].filter(id => {
    const stage = job.stages?.[id];
    return stage?.status === 'running' && (!last || !Number.isFinite(last.endedAt) || stage.startedAt >= last.endedAt);
  }).sort((a,b) => job.stages[b].startedAt - job.stages[a].startedAt)[0];
  if (running && active) {
    if (active === 'graybox') return {
      status: 'running', round: nextRound, label: `第 ${nextRound} 轮验收中`,
      detail: `${prior ? prior + '；空间修正已完成，' : ''}正在生成、运行并检查灰模。通过后才进入详细资产生成。`,
    };
    if (active === 'space' && (prior || job.spatialDiagnosis)) return {
      status: 'repairing', round: nextRound, label: '正在自动修正空间',
      detail: `${prior || '正在依据来源灰模与已验证机制准备局部补丁'}；正在修正空间与参考机位，完成后进行第 ${nextRound} 轮灰模验收。任务仍在执行。`,
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

export function spatialPolicyDescription(job) {
  const policy=job.optimizationPolicy?.spatialPreflight;
  if(policy==='composition-v3')return '构图灰模：空间 ≥3.5/5、关键关系 ≥3/5、置信度 ≥0.6，且无关键主体缺失后进入详细制作；局部偏差与灰模无法验证的材质关系保留警告。';
  if(policy==='coarse-v2')return '快速灰模：空间 ≥3/5、置信度 ≥0.6，关键主体和主通路没有严重缺失即可进入详细制作；局部比例与细节后续修正。';
  return '严格灰模：空间 ≥4/5 且关键关系满足后，才开始详细资产。';
}

export function canUseLegacySpatialUpgrade(job) {
  return !!job.improvementId && !!job.baselineId && ['space','graybox'].includes(job.stage)
    && ['failed','needs_review','cancelled'].includes(job.status)
    && !['coarse-v2','composition-v3'].includes(job.optimizationPolicy?.spatialPreflight);
}
