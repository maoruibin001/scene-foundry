import {test,expect} from 'bun:test';
import {assetWorkers} from './asset-workers';
test('资产并发有界且结果保持输入顺序',async()=>{
 let active=0,peak=0;const releases:(()=>void)[]=[];
 const done=assetWorkers([0,1,2,3],3,new AbortController().signal,async(n)=>{active++;peak=Math.max(peak,active);await new Promise<void>(r=>releases[n]=r);active--;return n*2;});
 expect(active).toBe(3);releases[2]();await Bun.sleep(0);expect(active).toBe(3);releases[3]();releases[1]();releases[0]();expect(await done).toEqual([0,2,4,6]);expect(peak).toBe(3);
});
test('失败中止同批活跃调用，等待它们退出，不再派发剩余资产',async()=>{
 const started:number[]=[];let cleanup=false;let fail!:()=>void;const gate=new Promise<void>(r=>fail=r);
 const done=assetWorkers([0,1,2,3],2,new AbortController().signal,async(n,_i,signal)=>{started.push(n);if(n===1){await gate;throw Error('具体供应商失败');}await new Promise<void>(r=>signal.addEventListener('abort',()=>r(),{once:true}));cleanup=true;signal.throwIfAborted();return n;});
 fail();await expect(done).rejects.toThrow('具体供应商失败');expect(started).toEqual([0,1]);expect(cleanup).toBe(true);
});
test('用户取消传递到全部活跃资产；取消前没有新调用',async()=>{
 const ctl=new AbortController();let count=0,exits=0;
 const done=assetWorkers([0,1,2],2,ctl.signal,async(_n,_i,signal)=>{count++;await new Promise<void>(r=>signal.addEventListener('abort',()=>r(),{once:true}));exits++;signal.throwIfAborted();return 0;});ctl.abort();await expect(done).rejects.toThrow();expect(count).toBe(2);expect(exits).toBe(2);
 await expect(assetWorkers([0],1,ctl.signal,async()=>{count++;return 0;})).rejects.toThrow();expect(count).toBe(2);
});
test('六个独立资产同时启动，剩余资产等待空槽',async()=>{let active=0,peak=0;const values=await assetWorkers(Array.from({length:13},(_,i)=>i),6,new AbortController().signal,async n=>{active++;peak=Math.max(peak,active);await Bun.sleep(1);active--;return n;});expect(peak).toBe(6);expect(values).toHaveLength(13);await expect(assetWorkers([0],7,new AbortController().signal,async n=>n)).rejects.toThrow();});
