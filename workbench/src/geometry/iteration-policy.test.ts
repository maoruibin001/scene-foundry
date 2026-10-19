import {test,expect} from 'bun:test';
import {boundedIterations} from './iteration-policy';
import {NoActionableChange} from '../contracts';
function setup(rows:{status:string;score:number}[],maxRepairs=2){const snapshots:any[]=[],sources:any[]=[],ctl=new AbortController();return {snapshots,sources,ctl,options:{maxRepairs,signal:ctl.signal,canRefine:()=>true,evaluate:async(i:number)=>rows[i],snapshot:async(c:any)=>{snapshots.push(structuredClone(c));},refine:async(i:number,n:number)=>{sources.push([i,n]);}}};}
test('用户只提交一次：首稿不通过、两轮修正后通过，成绩均保留',async()=>{const s=setup([{status:'failed',score:56},{status:'failed',score:73},{status:'passed',score:83}]);const r=await boundedIterations(s.options);expect(r.bestIndex).toBe(2);expect(r.firstDraft.score).toBe(56);expect(r.firstDraft.status).toBe('failed');expect(s.sources).toEqual([[0,1],[1,2]]);expect(s.snapshots.map(c=>c.score)).toEqual([56,73,83]);expect(r.stopReason).toBe('passed');});
test('连续两轮无提升才停止，不能用最新结果覆盖最佳结果',async()=>{const s=setup([{status:'failed',score:65},{status:'failed',score:54},{status:'failed',score:55}]);const r=await boundedIterations(s.options);expect(r.bestIndex).toBe(0);expect(r.stopReason).toBe('no-improvement');expect(s.sources).toHaveLength(2);});
test('首稿已通过时零修正；未通过也不超过两轮',async()=>{let s=setup([{status:'passed',score:83}]);expect((await boundedIterations(s.options)).cycles).toHaveLength(1);expect(s.sources).toHaveLength(0);s=setup([{status:'failed',score:60},{status:'failed',score:70},{status:'failed',score:79}]);expect((await boundedIterations(s.options)).stopReason).toBe('limit');expect(s.sources).toHaveLength(2);await expect(boundedIterations({...s.options,maxRepairs:3})).rejects.toThrow('两轮');});
test('预算不足保留首稿；取消不会启动下一轮；模型异常不自动重试',async()=>{const s=setup([{status:'failed',score:60}]);expect((await boundedIterations({...s.options,canRefine:()=>false})).stopReason).toBe('budget');expect(s.sources).toHaveLength(0);s.ctl.abort();await expect(boundedIterations(s.options)).rejects.toThrow();const b=setup([{status:'failed',score:60}]);await expect(boundedIterations({...b.options,refine:async()=>{throw Error('PROVIDER_TIMEOUT')}})).rejects.toThrow('PROVIDER_TIMEOUT');expect(b.snapshots).toHaveLength(1);});

test('首轮小波动不提前停止，保留最佳候选继续受限修复',async()=>{const s=setup([{status:'failed',score:55.7},{status:'failed',score:56.1},{status:'passed',score:81}]);const r=await boundedIterations(s.options);expect(r.bestIndex).toBe(2);expect(r.stopReason).toBe('passed');expect(r.cycles[1].score).toBe(56.1);expect(s.sources).toHaveLength(2);});

test('策略停滞与调用或轮数耗尽分别显示，首稿和证据仍保留',async()=>{
 for(const reason of ['no-improvement','budget','limit'] as const){const s=setup([{status:'failed',score:90}]);const r=await boundedIterations({...s.options,canRefine:()=>false,refineBlockedReason:()=>reason});expect(r.stopReason).toBe(reason);expect(r.bestIndex).toBe(0);expect(s.snapshots).toHaveLength(1);expect(s.sources).toHaveLength(0);}
});

test('修正模型确认没有合法改法时按边界结束并保留最佳轮次，不把任务记为失败',async()=>{
 const s=setup([{status:'failed',score:60},{status:'needs_review',score:72}],null as any);let calls=0;
 const r=await boundedIterations({...s.options,refine:async(i:number,n:number)=>{calls++;s.sources.push([i,n]);if(n===2)throw new NoActionableChange('REPAIR_NO_LEGAL_CHANGE：保留原状');}});
 expect(r.stopReason).toBe('no-actionable-repair');expect(r.bestIndex).toBe(1);expect(r.cycles.map(c=>c.score)).toEqual([60,72]);expect(calls).toBe(2);expect(s.snapshots).toHaveLength(2);
 // A first repair that abstains keeps the first draft.
 const f=setup([{status:'failed',score:60}]);const first=await boundedIterations({...f.options,refine:async()=>{throw new NoActionableChange('没有有依据的修正目标')}});
 expect(first.stopReason).toBe('no-actionable-repair');expect(first.bestIndex).toBe(0);expect(first.cycles).toHaveLength(1);
});
