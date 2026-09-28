import {test,expect} from 'bun:test';
import {mkdtempSync,writeFileSync,rmSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {JsonReadCache} from './read-cache';
import {dependencyFingerprint} from './stage-contract';
import {requestJSON,singleFlight} from '../public/request.js';
test('缓存内容依赖变化才失效，UI更新不失效；递归依赖改动必须失效',()=>{
 const dir=mkdtempSync(join(tmpdir(),'contract-test-'));try{
 writeFileSync(join(dir,'main.ts'),"import {x} from './dep';export const y=x;");writeFileSync(join(dir,'dep.ts'),'export const x=1;');
 const before=dependencyFingerprint(['main.ts'],dir);writeFileSync(join(dir,'ui.js'),'new UI');
 expect(dependencyFingerprint(['main.ts'],dir)).toBe(before);writeFileSync(join(dir,'dep.ts'),'export const x=2;');expect(dependencyFingerprint(['main.ts'],dir)).not.toBe(before);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('磁盘任务缓存跟随原子替换，读取者不能污染后续记录',()=>{
 const dir=mkdtempSync(join(tmpdir(),'read-cache-'));try{const file=join(dir,'job.json'),cache=new JsonReadCache();writeFileSync(file,'{"a":1}');const a=cache.read(file);a.a=9;expect(cache.read(file).a).toBe(1);writeFileSync(file+'.tmp','{"a":2}');renameSync(file+'.tmp',file);expect(cache.read(file).a).toBe(2);}finally{rmSync(dir,{recursive:true,force:true});}
});
test('请求超时结束等待且不自动重试POST；并发轮询共享同一请求',async()=>{
 let calls=0;const hung:any=(_url:any,init:any)=>new Promise((_resolve,reject)=>{calls++;init.signal.addEventListener('abort',()=>reject(Error('aborted')))});
 await expect(requestJSON('/x',{start:true},{fetch:hung,timeoutMs:5})).rejects.toThrow('请求超时');expect(calls).toBe(1);
 let done:any,n=0;const run=singleFlight(()=>{n++;return new Promise(resolve=>{done=resolve})});const a=run(),b=run();await Promise.resolve();expect(n).toBe(1);done('ok');expect(await a).toBe('ok');expect(await b).toBe('ok');
});
