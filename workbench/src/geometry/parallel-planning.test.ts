import {test,expect} from 'bun:test';
import {parallelPlanning} from './parallel-planning';
const signal=()=>new AbortController().signal;
test('材质与空间验收并行；未验收不能放出布局',async()=>{
 let surfaceStarted=false,release!:()=>void,done=false;
 const pending=parallelPlanning({id:1},async s=>{await new Promise<void>(r=>release=r);return s;},async()=>{surfaceStarted=true;return 'surface';},signal(),(a,b)=>a.id===b.id).then(v=>{done=true;return v;});
 await Bun.sleep(1);expect(surfaceStarted).toBe(true);expect(done).toBe(false);release();expect(await pending).toEqual({space:{id:1},surface:'surface'});
});
test('空间变更后重新绑定材质，不能沿用旧空间推测',async()=>{
 const calls:number[]=[];const result=await parallelPlanning(1,async()=>2,async s=>{calls.push(s);if(s===1)throw Error('old invalid');return 'new';},signal(),(a,b)=>a===b);expect(calls).toEqual([1,2]);expect(result).toEqual({space:2,surface:'new'});
});
test('空间未通过会清理并行材质；不继续详细生成',async()=>{
 let aborted=false;const promise=parallelPlanning(1,async()=>{await Bun.sleep(2);throw Error('space rejected');},async(_s,child)=>{await new Promise<void>(r=>child.addEventListener('abort',()=>{aborted=true;r();},{once:true}));child.throwIfAborted();return 0;},signal(),(a,b)=>a===b);
 await expect(promise).rejects.toThrow('space rejected');expect(aborted).toBe(true);
});
test('验收原地修改空间也不会污染并行材质输入',async()=>{
 const seen:number[]=[];const result=await parallelPlanning({camera:1},async s=>{s.camera=2;return s;},async s=>{seen.push(s.camera);return s.camera;},signal(),(a,b)=>a.camera===b.camera);expect(seen).toEqual([1,2]);expect(result.surface).toBe(2);
});
