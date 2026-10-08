import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProviderPressure,rateLimitDelay} from './provider-pressure';
import {withProviderRecovery} from './provider-recovery';
import {modelPool,providerPressure,useModelPermit} from './concurrency';

test('TPM waits for the advertised refill; hard quota and ordinary network faults stay distinct',()=>{
 expect(rateLimitDelay('rate limit exceeded: token rate limit')).toBe(60000);
 expect(rateLimitDelay('PROVIDER_HTTP_429',1)).toBe(120000);
 expect(rateLimitDelay('PROVIDER_HTTP_429\nRetry-After: 90')).toBe(90000);
 expect(rateLimitDelay('PROVIDER_HTTP_429 retry-after-ms: 8500')).toBe(8500);
 expect(rateLimitDelay('PROVIDER_HTTP_429 Retry-After: Wed, 01 Oct 2025 00:02:00 GMT',0,Date.parse('2025-10-01T00:00:00Z'))).toBe(120000);
 expect(rateLimitDelay('PROVIDER_HTTP_429 insufficient_quota')).toBeNull();
 expect(rateLimitDelay('ECONNRESET')).toBeNull();
});
test('one in-flight burst reduces concurrency once; stale successes do not undo backpressure',()=>{
 let now=1000;const p=new ProviderPressure(()=>now),epoch=p.epoch;
 p.limited('rate limit',8);p.limited('rate limit',8);expect(p.capacity(8)).toBe(0);expect(p.ceiling).toBe(4);
 for(let i=0;i<8;i++)p.succeeded(epoch,8);expect(p.healthy).toBe(0);
 now+=60000;expect(p.capacity(8)).toBe(4);p.limited('rate limit',8);expect(p.ceiling).toBe(2);
 now+=60000;for(let i=0;i<4;i++)p.succeeded(p.epoch,8);expect(p.capacity(8)).toBe(3);expect(p.capacity(1)).toBe(1);
});
test('real admission wrapper publishes pressure before releasing permits; queued cancellation spends no call',async()=>{
 const oldLimit=modelPool.limit;let release!:()=>void,calls=0;const ctl=new AbortController();
 try{
  modelPool.setLimit(1);providerPressure.until=0;providerPressure.ceiling=Infinity;
  const a=useModelPermit('pressure-a',undefined,async()=>{calls++;await new Promise<void>(r=>release=r);throw Error('rate limit exceeded: token rate limit');});
  await Promise.resolve();const b=useModelPermit('pressure-b',ctl.signal,async()=>{calls++;return 'unexpected';});
  release();await expect(a).rejects.toThrow('token rate');await Promise.resolve();
  expect(calls).toBe(1);expect(modelPool.active.size).toBe(0);expect(modelPool.waiting.length).toBe(1);
  ctl.abort(Error('user cancelled'));await expect(b).rejects.toThrow('user cancelled');expect(calls).toBe(1);
 }finally{providerPressure.until=0;providerPressure.ceiling=Infinity;providerPressure.healthy=0;modelPool.setLimit(oldLimit);}
});
test('saved Azure error consumes at most three actual attempts with 60/120 second refill windows',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'pressure-recovery-'));let now=100,n=0;const delays:number[]=[];
 try{await expect(withProviderRecovery({role:'geometry-asset'},dir,async()=>{n++;throw Error('Your requests to gpt-6-astra in eastus2 have exceeded token rate limit.');},{now:()=>now,wait:async ms=>{delays.push(ms);now+=ms;}})).rejects.toThrow('PROVIDER_RECOVERY_EXHAUSTED');expect(n).toBe(3);expect(delays).toEqual([60000,120000]);}
 finally{rmSync(dir,{recursive:true,force:true});}
});
