import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {read,save,digest} from '../store';
import {ensureProjectionEvidence} from './projection-evidence';
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'projection-proof-')),source={program:{id:'immutable geometry'},cameras:[{name:'参考',referenceIndex:1,position:[0,-5,1],target:[0,0,1],fov:1}]},sourceFolder=join(root,'original');mkdirSync(join(sourceFolder,'runtime'),{recursive:true});
 const original=Buffer.from('immutable original capture');writeFileSync(join(sourceFolder,'runtime/reference-1.png'),original);
 const runtime={images:['reference-1.png'],hashes:[digest(original)],referenceFrames:[{file:'reference-1.png',referenceIndex:1}],poses:[{selectedView:0,position:[0,1,5],target:[0,1,0],fov:1}],distManifestDigest:'original-native-build'};
 let calls=0,fail=false;
 const render:any=async(scene:any,_images:any,_refs:any,dir:string)=>{calls++;if(fail)throw Error('fixture capture failed');mkdirSync(join(dir,'capture'),{recursive:true});const bytes=Buffer.alloc(32);Buffer.from('89504e470d0a1a0a','hex').copy(bytes);bytes.writeUInt32BE(1600,16);bytes.writeUInt32BE(900,20);writeFileSync(join(dir,'capture/candidate-1.png'),bytes);save(join(dir,'engine-preview-receipt.json'),{sceneSha256:digest(JSON.stringify(scene)),distManifestDigest:'diagnostic-native-build',report:{pageErrors:[],consoleErrors:[]},frames:[{file:'candidate-1.png',referenceIndex:1,sha256:digest(bytes),pose:{...runtime.poses[0],cameraProjection:{projection:0,fov:1,aspect:16/9,near:.1,far:1000}}}]});};
 return {root,source,sourceFolder,runtime,folder:join(root,'repair'),render,calls:()=>calls,setFail:()=>{fail=true},close:()=>rmSync(root,{recursive:true,force:true})};
}
test('历史机位只作一次相同几何的实际投影诊断，恢复校验回执与图片，不重评或改写原文件',async()=>{
 const f=fixture();try{const before=JSON.stringify(f.runtime),raw=readFileSync(join(f.sourceFolder,'runtime/reference-1.png'));
  const args=[f.source,[],[],f.sourceFolder,f.runtime,f.folder,new AbortController().signal,f.render] as const;
  const replay=await ensureProjectionEvidence(...args);expect(f.calls()).toBe(1);expect(replay.runtime.poses[0].cameraProjection.projection).toBe(0);expect(replay.runtime.hard).toBeUndefined();expect(replay.runtime.scope).toContain('未重新评分');
  expect(JSON.stringify(f.runtime)).toBe(before);expect(readFileSync(join(f.sourceFolder,'runtime/reference-1.png'))).toEqual(raw);expect(read(join(f.folder,'projection-replay/projection-replay.json')).modelCalls).toBe(0);
  expect((await ensureProjectionEvidence(...args)).runtime).toEqual(replay.runtime);expect(f.calls()).toBe(1);
  await expect(ensureProjectionEvidence({...f.source,program:{id:'changed geometry'}},[],[],f.sourceFolder,f.runtime,f.folder,new AbortController().signal,f.render)).rejects.toThrow('来源发生变化');
  writeFileSync(join(f.folder,'projection-replay/engine/capture/candidate-1.png'),'tampered');await expect(ensureProjectionEvidence(...args)).rejects.toThrow('摘要不一致');expect(f.calls()).toBe(1);
 }finally{f.close();}
});
test('已有实际投影不重复采集；取消和同因采集失败保持停止，不消耗模型调用',async()=>{
 const f=fixture();try{const runtime={...f.runtime,poses:[{...f.runtime.poses[0],cameraProjection:{projection:0}}]};expect((await ensureProjectionEvidence(f.source,[],[],f.sourceFolder,runtime,f.folder,new AbortController().signal,f.render)).runtime).toBe(runtime);expect(f.calls()).toBe(0);
  const controller=new AbortController();controller.abort();await expect(ensureProjectionEvidence(f.source,[],[],f.sourceFolder,f.runtime,f.folder,controller.signal,f.render)).rejects.toThrow();expect(f.calls()).toBe(0);
  f.setFail();await expect(ensureProjectionEvidence(f.source,[],[],f.sourceFolder,f.runtime,f.folder,new AbortController().signal,f.render)).rejects.toThrow('fixture capture failed');expect(f.calls()).toBe(1);
  await expect(ensureProjectionEvidence(f.source,[],[],f.sourceFolder,f.runtime,f.folder,new AbortController().signal,f.render)).rejects.toThrow('没有新条件');expect(f.calls()).toBe(1);
 }finally{f.close();}
});
