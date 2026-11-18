import {test,expect} from 'bun:test';
import {meshContentHashWithKit} from './export-pack';
import {callCbcWithRetry,isTransientCbcTimeout} from './node-models';
import {getActiveWorkerCount,runWorkerTasks} from './parallel-assets';

test('网格缓存键随生成器源码摘要与参数变化，避免命中旧几何',()=>{
 const a=meshContentHashWithKit('kit-a','GEN-HALL-01',{width:48});
 expect(meshContentHashWithKit('kit-a','GEN-HALL-01',{width:48})).toBe(a);
 expect(meshContentHashWithKit('kit-b','GEN-HALL-01',{width:48})).not.toBe(a);
 expect(meshContentHashWithKit('kit-a','GEN-HALL-01',{width:49})).not.toBe(a);
});

test('只有瞬态超时重跑一次，两次尝试各留一份日志前缀',async()=>{
 const opts:any={args:[],cwd:'/tmp',env:{},input:'',prefix:'probe-',timeoutMs:1000};
 const prefixes:string[]=[];
 const stalled:any=async(o:any)=>{prefixes.push(o.prefix);return {code:1,timedOut:true,stdout:'',stderr:'',trace:{timeoutReason:'stalled',stdoutBytes:0}};};
 const r=await callCbcWithRetry(opts,2,stalled);
 expect(prefixes).toEqual(['probe-','probe--retry2']);
 expect(r.timedOut).toBe(true);
 let heavyCalls=0;
 const heavy:any=async()=>{heavyCalls++;return {code:1,timedOut:true,stdout:'',stderr:'',trace:{timeoutReason:'absolute-limit',stdoutBytes:8_000_000}};};
 await callCbcWithRetry(opts,2,heavy);
 expect(heavyCalls).toBe(1);
 expect(isTransientCbcTimeout({timedOut:true,trace:{timeoutReason:'stalled',stdoutBytes:0}})).toBe(true);
 expect(isTransientCbcTimeout({timedOut:true,trace:{timeoutReason:'absolute-limit',stdoutBytes:8_000_000}})).toBe(false);
 expect(isTransientCbcTimeout({timedOut:false,trace:{}})).toBe(false);
});

test('Worker 无响应时看门狗终止整批并回收线程计数',async()=>{
 const RealWorker=globalThis.Worker;
 let terminated=0;
 class SilentWorker{
  onmessage:any=null;onerror:any=null;
  postMessage(){}
  terminate(){terminated++;}
 }
 (globalThis as any).Worker=SilentWorker;
 try{
  const before=getActiveWorkerCount();
  const task:any={kind:'preview',position:new Float32Array(0),indices:new Uint32Array(0),drawList:[]};
  await expect(runWorkerTasks([task],{concurrency:1,watchdogMs:120})).rejects.toThrow('ASSET_WORKER_WATCHDOG_TIMEOUT');
  expect(terminated).toBe(1);
  expect(getActiveWorkerCount()).toBe(before);
 }finally{(globalThis as any).Worker=RealWorker;}
});
