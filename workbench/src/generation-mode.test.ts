import {test,expect} from 'bun:test';
import {generationMode,iterationPolicyFor} from './generation-mode';
import {generationInput} from './reference-input';
import {boundedIterations} from './geometry/iteration-policy';
import {automaticContinuationOptions} from './provider-recovery';
test('首次成品未达标也只评估一次、保存首稿且不触发修正',async()=>{
 const policy=iterationPolicyFor({generationMode:'first-pass'});let evaluated=0,refined=0;const snapshots:any[]=[];
 const result=await boundedIterations({maxRepairs:policy.maxVisualRepairs,signal:new AbortController().signal,canRefine:()=>true,evaluate:async()=>{evaluated++;return {status:'failed',score:63};},snapshot:async c=>{snapshots.push(c);},refine:async()=>{refined++;}});
 expect(evaluated).toBe(1);expect(refined).toBe(0);expect(snapshots[0].score).toBe(63);expect(result.firstDraft.status).toBe('failed');expect(result.cycles).toHaveLength(1);
});
test('检查点和自动技术恢复保留首轮模式、原attempt与图片次序',()=>{
 const source={id:'source',attempt:1,prompt:'按第一张质量还原',images:[{id:'a'.repeat(64)},{id:'b'.repeat(64)}],complexity:'complex',generationMode:'first-pass'};
 const input=generationInput(source),options=automaticContinuationOptions(source,true);
 expect(iterationPolicyFor(input).maxVisualRepairs).toBe(0);expect(options.attempt).toBe(1);expect(options.executionRecoveryPolicy.enabled).toBe(true);expect(input.imageIds).toEqual(source.images.map(x=>x.id));
});
test('默认有限修正保持两轮，非法模式在生成前拒绝',()=>{
 expect(generationMode()).toBe('bounded');expect(iterationPolicyFor({}).maxVisualRepairs).toBe(2);for(const value of ['bad',false,0,null])expect(()=>generationMode(value)).toThrow();
});
