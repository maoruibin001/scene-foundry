import {test,expect} from 'bun:test';
import {captureWithRetry} from './capture-retry';
const live=()=>new AbortController().signal;
test('a transient capture failure is retried once on the same preview, keeping the failure for evidence',async()=>{
 let calls=0;const retried:unknown[]=[];
 expect(await captureWithRetry(async()=>{if(++calls===1)throw Error('原始录屏取帧 failed 30111ms');return 'runtime';},live(),e=>retried.push(e))).toBe('runtime');
 expect(calls).toBe(2);expect(String(retried[0])).toContain('原始录屏取帧');
 calls=0;expect(await captureWithRetry(async()=>++calls,live(),()=>{throw Error('unexpected retry');})).toBe(1);
});
test('a second failure stays CAPTURE_EVIDENCE_FAILED and a cancelled job never retries',async()=>{
 let calls=0;
 await expect(captureWithRetry(async()=>{calls++;throw Error('timeout');},live(),()=>{})).rejects.toThrow('CAPTURE_EVIDENCE_FAILED');expect(calls).toBe(2);
 const c=new AbortController();calls=0;
 await expect(captureWithRetry(async()=>{calls++;c.abort(Error('用户取消'));throw Error('killed');},c.signal,()=>{throw Error('unexpected retry');})).rejects.toThrow('用户取消');expect(calls).toBe(1);
});
