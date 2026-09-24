import {test,expect} from 'bun:test';
import {PermitPool,SceneQueue,validateLimits} from './concurrency';
const tick=()=>new Promise(r=>setTimeout(r,0));
const deferred=()=>{let resolve!:()=>void;return {promise:new Promise<void>(r=>resolve=r),done:()=>resolve()};};
test('scene jobs overlap up to cap and next starts as soon as one finishes',async()=>{
 const q=new SceneQueue(2),gates=Array.from({length:4},deferred),started:number[]=[];
 for(let i=0;i<4;i++)q.enqueue('j'+i,'key'+i,async()=>{started.push(i);await gates[i].promise;});
 await tick();expect(started).toEqual([0,1]);expect(q.pending.length).toBe(2);gates[1].done();await tick();expect(started).toEqual([0,1,2]);gates[0].done();gates[2].done();await tick();gates[3].done();await tick();expect(q.active.size).toBe(0);
});
test('same experiment stays serial while unrelated jobs run; cancel queued never starts',async()=>{
 const q=new SceneQueue(3),a=deferred(),started:string[]=[];q.enqueue('a','same',async()=>{started.push('a');await a.promise;});q.enqueue('b','same',async()=>{started.push('b');});q.enqueue('c','other',async()=>{started.push('c');});q.cancel('b');await tick();expect(started).toEqual(['a','c']);a.done();await tick();expect(started).not.toContain('b');
});
test('lowered scene cap drains active work and thrown work releases slot',async()=>{
 const errors:any[]=[],q=new SceneQueue(2,()=>0,(id,e)=>errors.push(id)),a=deferred(),b=deferred();q.enqueue('a','a',()=>a.promise);q.enqueue('b','b',()=>b.promise);await tick();q.setLimit(1);q.enqueue('c','c',async()=>{throw Error('test');});a.done();await tick();expect(q.active.has('c')).toBe(false);b.done();await tick();await tick();expect(errors).toEqual(['c']);expect(q.active.size).toBe(0);
});
test('model permits cap aggregate asset workers; cancellation and failure release slots',async()=>{
 const pool=new PermitPool(2),a=await pool.acquire('a'),b=await pool.acquire('b'),ctl=new AbortController();const cancelled=pool.acquire('c',ctl.signal).catch(e=>String(e));let got=false;const d=pool.acquire('d').then(release=>{got=true;return release;});ctl.abort();expect(await cancelled).toContain('Abort');expect(got).toBe(false);a();const release=await d;expect(got).toBe(true);expect(pool.active.size).toBe(2);release();b();await expect(pool.use('bad',undefined,async()=>{throw Error('bad');})).rejects.toThrow('bad');expect(pool.active.size).toBe(0);
});
test('legacy reservations count toward cap and are released without interrupting jobs',async()=>{
 let legacy=6;const pool=new PermitPool(8,()=>legacy),a=await pool.acquire('a'),b=await pool.acquire('b');let got=false;const c=pool.acquire('c').then(r=>{got=true;return r;});await tick();expect(got).toBe(false);legacy=0;pool.drain();const release=await c;expect(got).toBe(true);release();a();b();
});
test('lowered model cap waits for drain; abort queued requests do not consume capacity',async()=>{
 const pool=new PermitPool(2),a=await pool.acquire('a'),b=await pool.acquire('b');pool.setLimit(1);let got=false;const c=pool.acquire('c').then(r=>{got=true;return r;});a();await tick();expect(got).toBe(false);b();const release=await c;expect(got).toBe(true);release();
});
test('limits reject malformed and excessive values',()=>{for(const v of [{scenes:0},{models:17},{renders:5},{models:1.1},{scenes:'3'}])expect(()=>validateLimits(v)).toThrow();expect(validateLimits({})).toEqual({scenes:3,models:8,renders:2});});
test('200-job batch keeps scene and aggregate model caps and continues after an individual failure',async()=>{
 const q=new SceneQueue(3),models=new PermitPool(4);let done=0,active=0,peak=0,peakScenes=0;const complete=deferred();
 for(let i=0;i<200;i++)q.enqueue('batch-'+i,'experiment-'+i,async()=>{peakScenes=Math.max(peakScenes,q.active.size);try{await Promise.all(Array.from({length:3},(_,k)=>models.use(i+':'+k,undefined,async()=>{active++;peak=Math.max(peak,active);try{await tick();if(i===4&&k===0)throw Error('one case failed');}finally{active--;}})).map(p=>p.catch(()=>{})));}finally{if(++done===200)complete.done();}});
 await complete.promise;await tick();expect(done).toBe(200);expect(peakScenes).toBe(3);expect(peak).toBe(4);expect(q.pending).toHaveLength(0);expect(models.active.size).toBe(0);
});
