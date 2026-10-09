import {mkdirSync,existsSync,readFileSync,copyFileSync} from 'node:fs';
import {join} from 'node:path';
import {digest,read,save} from '../store';
import {stable} from '../validated-cache';
import {renderRepairPreview} from './repair-engine-preview';
import {assertVisibilityCamera} from './visibility-evidence';

/** A historical pose lacks actual projection values. Replay unchanged geometry once for diagnosis only. */
export async function ensureProjectionEvidence(source:any,images:{path:string;mime:string}[],refs:string[],sourceFolder:string,runtime:any,folder:string,signal:AbortSignal,render=renderRepairPreview){
 if(source.cameras.every((_:any,i:number)=>runtime.poses?.[i]?.cameraProjection))return {sourceFolder,runtime};
 signal.throwIfAborted();
 const replay=join(folder,'projection-replay'),auditFile=join(replay,'projection-replay.json');mkdirSync(replay,{recursive:true});
 const key=digest(stable({source,refs,runtimeDigest:runtime.distManifestDigest,frames:runtime.referenceFrames,hashes:runtime.hashes}));
 let audit=existsSync(auditFile)?read(auditFile):null;
 if(audit&&audit.key!==key)throw Error('投影诊断重放的来源发生变化');
 if(audit&&audit.status!=='completed')throw Error('相同来源投影诊断重放未完成，没有新条件不重复构建');
 if(!audit){
  audit={version:'native-projection-replay-v1',key,status:'running',modelCalls:0,quality:'not-assessed',sourceFolder,sourceRuntimeDigest:runtime.distManifestDigest};save(auditFile,audit);
  try{await render(source,images,refs,join(replay,'engine'),signal);audit.receiptSha256=digest(readFileSync(join(replay,'engine/engine-preview-receipt.json')));audit.status='completed';}
  catch(error){audit.status='failed';audit.error=String(error);throw error;}
  finally{save(auditFile,audit);}
 }
 const receiptFile=join(replay,'engine/engine-preview-receipt.json'),receipt=read(receiptFile);
 if(digest(readFileSync(receiptFile))!==audit.receiptSha256||receipt.sceneSha256!==digest(JSON.stringify(source))||receipt.frames?.length!==source.cameras.length||receipt.report?.pageErrors?.length||receipt.report?.consoleErrors?.length)throw Error('投影诊断重放证据与原场景不一致');
 const output=join(replay,'runtime');mkdirSync(output,{recursive:true});
 const frames=receipt.frames.map((f:any,i:number)=>{
  const original=runtime.referenceFrames?.[i];if(!original||original.referenceIndex!==f.referenceIndex||!/^candidate-\d+\.png$/.test(f.file)||!/^(reference|inspection)-\d+\.png$/.test(original.file))throw Error('投影诊断机位身份不一致');
  const path=join(replay,'engine/capture',f.file),bytes=readFileSync(path);if(digest(bytes)!==f.sha256||bytes.length<24||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('投影诊断实际图片摘要不一致');
  assertVisibilityCamera(source.cameras[i],f.pose,i,bytes.readUInt32BE(16),bytes.readUInt32BE(20),true);
  copyFileSync(path,join(output,original.file));return {file:original.file,referenceIndex:f.referenceIndex,pose:f.pose,sha256:f.sha256};
 });
 const diagnostic={images:frames.map((f:any)=>f.file),hashes:frames.map((f:any)=>f.sha256),referenceFrames:frames.map(({pose,sha256,...f}:any)=>f),poses:frames.map((f:any)=>f.pose),distManifestDigest:receipt.distManifestDigest,scope:'相同几何、机位与画幅的当前投影诊断；未重新评分，不是来源质量提升或新运行验收'};
 save(join(replay,'diagnostic-runtime.json'),diagnostic);
 return {sourceFolder:replay,runtime:diagnostic};
}
