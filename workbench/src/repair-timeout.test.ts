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
