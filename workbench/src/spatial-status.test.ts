import {test, expect} from 'bun:test';
import {spatialProgress, spatialTimingStage} from '../public/spatial-status.js';
import {timingSnapshot} from './timing-snapshot';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const failedRound = {round:0,startedAt:2000,endedAt:5000,passed:false,review:{score:1.9}};
const fixture = () => ({
  id:'test', status:'running', stage:'space', stageTrackingVersion:'exclusive-stages-v1',
  createdAt:new Date(1000).toISOString(),
  blockout:{status:'failed',rounds:[structuredClone(failedRound)]},
  stages:{space:{status:'running',startedAt:5001},graybox:{status:'failed',startedAt:2000,endedAt:5000,durationMs:3000}},
});

test('旧任务修正中显示当前修正状态，保留未通过轮次、分数和耗时',()=>{
  const job=fixture(),before=JSON.stringify(job),root=mkdtempSync(join(tmpdir(),'spatial-status-'));
  try {
    const stage=timingSnapshot(job,root,7000).stages.find(s=>s.id==='graybox');
    expect(stage.status).toBe('repairing');
    expect(stage.statusLabel).toBe('正在自动修正空间');
    expect(stage.statusDetail).toContain('第 1 轮未通过（1.9/5）');
    expect(stage.durationMs).toBe(3000);
    expect(stage.attempts[0].status).toBe('failed');
    expect(JSON.stringify(job)).toBe(before);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('第二轮正在验收优先于遗留 blockout.failed，不篡改第一轮',()=>{
  const job:any=fixture();job.stage='graybox';job.stageAttempts={graybox:[job.stages.graybox]};
  job.stages.graybox={status:'running',startedAt:6000};
  const p=spatialProgress(job);
  expect(p.status).toBe('running');expect(p.label).toBe('第 2 轮验收中');
  expect(p.detail).toContain('空间修正已完成');expect(job.blockout.rounds[0].passed).toBe(false);
  expect(spatialTimingStage({id:'space',status:'passed'},job)).toEqual({id:'space',status:'passed'});
});

test('旧空间阶段没有新修正时间证据时不得声称正在自动修正',()=>{
  const job=fixture();job.stages.space.startedAt=1000;
  expect(spatialProgress(job).status).toBe('failed');
  job.stages.space.startedAt=5001;job.stages.space.status='passed';
  expect(spatialProgress(job).status).toBe('failed');
});

test('终止、取消和受阻不能被误标为正在重试，后续成品失败也不抹去灰模通过',()=>{
  for(const status of ['failed','cancelled','blocked']){
    const job=fixture();job.status=status;
    expect(spatialProgress(job).status).toBe(status);
  }
  const job:any=fixture();job.status='failed';job.stage='judge';
  job.blockout.rounds.push({round:1,passed:true,review:{score:4.2}});
  expect(spatialProgress(job).status).toBe('passed');
});

test('首轮与第三轮使用实际轮次，不把首次验收冒充修正后复验',()=>{
  const job:any=fixture();job.stage='graybox';job.stages.graybox={status:'running',startedAt:8000};
  job.blockout.rounds=[];expect(spatialProgress(job).label).toBe('第 1 轮验收中');
  expect(spatialProgress(job).detail).not.toContain('空间修正已完成');
  job.blockout.rounds=[failedRound,{...failedRound,round:1,endedAt:7000}];
  expect(spatialProgress(job).label).toBe('第 3 轮验收中');
  expect(spatialProgress(job).detail).toContain('第 2 轮未通过');
});
