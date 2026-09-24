import {test,expect} from 'bun:test';
import {capturePlan} from './capture-plan.mjs';
test('静态视角仍为官方采集，六张连续画面由录屏取帧且预算包含解码',()=>{
 const p=capturePlan(3);expect(p.captureCount).toBe(5);expect(p.frameTimeoutMs).toBe(30000);
 expect(p.stageTimeoutMs).toBe(292200);expect(p.continuousFrames).toBe(6);expect(p.continuousSource).toBe('recording-pts');
});
test('视角更多相应增加预算，非法计划在开始运行前拒绝',()=>{
 expect(capturePlan(6).stageTimeoutMs).toBeLessThan(600000);
 expect(capturePlan(4).stageTimeoutMs-capturePlan(3).stageTimeoutMs).toBe(30400);
 for(const n of [0,-1,1.5,7,NaN])expect(()=>capturePlan(n)).toThrow('视角数');
});
