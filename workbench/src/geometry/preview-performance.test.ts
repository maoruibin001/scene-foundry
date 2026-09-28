import {test,expect} from 'bun:test';
import {previewPerformance} from './preview-performance';
test('性能反馈来自真实帧间隔，缺失样本不能报告通过',()=>{
 expect(previewPerformance([]).signal).toBe('insufficient-samples');
 expect(previewPerformance([{pose:{frameTimes:[NaN,-1,0,16]}}]).signal).toBe('insufficient-samples');
 const normal=previewPerformance([{referenceIndex:1,pose:{frameTimes:Array(60).fill(25)}}]);expect(normal.views[0].averageFps).toBe(40);expect(normal.signal).toBe('preview-only');expect(normal.formalRuntimePassed).toBe(false);
 const slow=previewPerformance([{pose:{frameTimes:Array(60).fill(120)}}]);expect(slow.signal).toBe('runtime-risk');expect(slow.views[0].averageFps).toBeCloseTo(8.333);
 const spikes=previewPerformance([{pose:{frameTimes:[...Array(110).fill(25),...Array(10).fill(150)]}}]);expect(spikes.signal).toBe('runtime-risk');
});
