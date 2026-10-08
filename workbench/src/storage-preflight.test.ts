import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {assertStorageAvailable,STORAGE_RESERVE_BYTES} from './storage-preflight';
import {callValidated} from './contracts';
const stat=(bytes:number)=>(()=>({bavail:bytes/4096,bsize:4096})) as any;
test('输出卷可用空间低于余量时停止，边界值可以执行',()=>{
 expect(()=>assertStorageAvailable('/output',STORAGE_RESERVE_BYTES,stat(STORAGE_RESERVE_BYTES-4096))).toThrow('STORAGE_CAPACITY_BLOCKED');
 expect(assertStorageAvailable('/output',STORAGE_RESERVE_BYTES,stat(STORAGE_RESERVE_BYTES)).availableBytes).toBe(STORAGE_RESERVE_BYTES);
});
test('磁盘不足不是模型格式错误，不消耗一次额外纠正调用',async()=>{const dir=mkdtempSync(join(tmpdir(),'storage-contract-'));let calls=0;try{
 await expect(callValidated({role:'scene-refine',system:'test',text:'test',maxTokens:1},dir,x=>x,(async()=>{calls++;throw Error('STORAGE_CAPACITY_BLOCKED');}) as any)).rejects.toThrow('STORAGE_CAPACITY_BLOCKED');expect(calls).toBe(1);
}finally{rmSync(dir,{recursive:true,force:true})}});
