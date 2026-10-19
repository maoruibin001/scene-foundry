import {test,expect} from 'bun:test';
import {modelTimeoutPolicy} from './model-selection';

test('含实际Engine反馈的修复获得合理时间但仍受单次和恢复总时限约束',()=>{
 const initial=modelTimeoutPolicy('high','scene-refine');
 expect(initial.timeoutMs).toBe(15*60*1000);expect(initial.maxTimeoutMs).toBe(30*60*1000);
 expect(initial.activityWindowMs).toBe(5*60*1000);
 expect(modelTimeoutPolicy('high','scene-refine',1,90*1000).maxTimeoutMs).toBe(90*1000);
 expect(modelTimeoutPolicy('high','scene-surface').timeoutMs).toBe(5*60*1000);
 expect(modelTimeoutPolicy('xhigh','judge').timeoutMs).toBe(15*60*1000);
 expect(modelTimeoutPolicy('high','scene-refine',1).maxTimeoutMs).toBe(45*60*1000);
});

test('初始空间构建按工具检查点计时：不再在 10 分钟处杀掉仍在保存检查点的调用',()=>{
 // Recorded voxel temple runs r6–r10: the first space call timed out at 600 s, retries needed 716–839 s and one was killed at 900 s while still saving.
 for(const v of ['space-checkpoint-v1','space-checkpoint-v2'])expect(modelTimeoutPolicy('high','scene-space',0,3600000,v)).toMatchObject({timeoutMs:15*60*1000,maxTimeoutMs:30*60*1000});
 expect(modelTimeoutPolicy('high','scene-space',1,20*60*1000,'space-checkpoint-v2').maxTimeoutMs).toBe(20*60*1000);
 expect(modelTimeoutPolicy('high','scene-space').timeoutMs).toBe(5*60*1000);
});
