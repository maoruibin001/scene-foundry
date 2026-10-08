import {existsSync,readFileSync} from 'node:fs';
import {join,basename} from 'node:path';
import {read,save,digest,runDir} from '../store';
import {improvement} from '../improvement-governance';
import {stable} from '../validated-cache';

const same=(a:any,b:any)=>stable(a)===stable(b);
const HARD=['framing','cameraMotion','nonFlat','multipleViews','entitiesLoaded','frameRate','runtime','noErrors','hudToggle','video','cameraStopped'];
export function sameRejectedSpatialCase(current:any,other:any){
 return current.improvementId&&current.improvementId===other.improvementId&&['prompt','baselineId','complexity','matchingLevel'].every(k=>same(current[k],other[k]))&&same(current.plan,other.plan)&&same(current.modelSettings,other.modelSettings)&&same(current.policy,other.policy)
  &&same((current.images??[]).map(i=>i.id),(other.images??[]).map(i=>i.id))
  &&['engineSha','generatorSha','assessmentProtocolSha256'].every(k=>current.profile?.[k]&&current.profile[k]===other.profile?.[k]);
}

/** Negative feedback is immutable evidence, not the next repair's baseline or a new target image. */
export function rejectedSpatialAttempt(folder:string,job:any,ctx:any,sourceFolder:string){
 const sourceGate=read(join(sourceFolder,'gate.json')),gate=read(join(folder,'gate.json')),handoff=join(folder,'graybox-parts-source.json');
 if(!sameRejectedSpatialCase(ctx.job,job)||gate.passed!==false||gate.protocol!==sourceGate.protocol||!same(gate.threshold,sourceGate.threshold)||gate.review?.confidence<gate.threshold.confidence||!existsSync(handoff))return null;
 const repair=read(handoff).repairFolder,receipt=read(join(repair,'repair-receipt.json'));
 if(receipt.sourceFolder!==sourceFolder)return null;
 const runtime=read(join(folder,'runtime/runtime.json')),report=read(join(folder,'project/evidence/run-report.json')),parsed=read(join(folder,'scene-space-judge-parsed.json')),judge=read(join(folder,'scene-space-judge-receipt.json'));
 if(!same(parsed,gate.review)||judge.stopReason!=='completed'||judge.requestedModel!==ctx.job.modelSettings.model||gate.runtimeDigest!==runtime.distManifestDigest||report.distManifestDigest!==gate.runtimeDigest||report.engineSha!==ctx.job.profile.engineSha||report.generatorSha!==ctx.job.profile.generatorSha||!HARD.every(k=>runtime.hard?.[k]===true))throw Error('失败空间反馈缺少对应的独立评分或Engine证据');
 if(runtime.images.length!==runtime.hashes.length)throw Error('失败空间反馈图片清单不完整');
 runtime.images.forEach((file,n)=>{if(basename(file)!==file||digest(readFileSync(join(folder,'runtime',file)))!==runtime.hashes[n])throw Error('失败空间反馈图片哈希变化');});
 for(const image of read(join(folder,'scene-space-judge-input-receipt.json')).images)if(digest(readFileSync(image.path))!==image.sha256)throw Error('失败空间评审输入哈希变化');
 const scene=read(join(repair,'reviewed-scene.json')),patch=read(join(repair,'patch.json')),audit=read(join(repair,'preview/graybox-preview-audit.json')),selected=audit.attempts.find(r=>r.status==='rendered'&&r.patchSha256===receipt.preview.patchSha256);
 if(!selected||digest(stable(scene))!==receipt.preview.canonicalSceneSha256||digest(stable(patch))!==selected.patchSha256)throw Error('失败空间反馈与实际选中补丁不一致');
 const frames=gate.frames.map(file=>{const row=runtime.referenceFrames.find(f=>f.file===file&&f.referenceIndex);if(!row)throw Error('失败空间反馈没有实际评分机位');return {file,path:join(folder,'runtime',file),mime:'image/png',referenceIndex:row.referenceIndex,sha256:runtime.hashes[runtime.images.indexOf(file)]};});
 return {jobId:job.id,round:gate.round,folder,sourceFolder,endedAt:gate.endedAt,review:gate.review,failed:gate.failed,patch,patchSha256:selected.patchSha256,canonicalSceneSha256:receipt.preview.canonicalSceneSha256,frames};
}

export function spatialRejectedFeedback(ctx:any,sourceFolder:string,folder:string){
 const file=join(folder,'rejected-spatial-context.json');
 let selected:any[];
 if(existsSync(file)){
  const saved=read(file);if(saved.sourceFolder!==sourceFolder)throw Error('失败反馈恢复的基线改变');
  selected=saved.attempts.map(a=>{const job=read(join(runDir(a.jobId),'job.json')),v=rejectedSpatialAttempt(a.folder,job,ctx,sourceFolder);if(!v||!same(v,a))throw Error('已保存失败反馈改变，不能静默丢失后原样重跑');return v;});
 }else{
  const rows=ctx.job.improvementId?improvement.get(ctx.job.improvementId).jobs.slice(-32).flatMap(id=>{const p=join(runDir(id),'job.json');if(!existsSync(p))return [];const job=read(p);if(!sameRejectedSpatialCase(ctx.job,job))return [];return (job.blockout?.rounds??[]).filter(r=>r.passed===false&&/^generation\/blockout\/\d+$/.test(r.path)).map(r=>({job,folder:join(runDir(id),r.path),at:r.endedAt}));}).sort((a,b)=>b.at-a.at):[];
  selected=[];for(const row of rows){const v=rejectedSpatialAttempt(row.folder,row.job,ctx,sourceFolder);if(v&&!selected.some(a=>a.canonicalSceneSha256===v.canonicalSceneSha256))selected.push(v);if(selected.length===2)break;}
  save(file,{version:'spatial-rejected-feedback-v1',sourceFolder,attempts:selected});
 }
 return {attempts:selected,images:selected.flatMap(a=>a.frames.map(f=>({path:f.path,mime:f.mime}))),context:selected.map(({folder,sourceFolder,frames,...a})=>({...a,frameNames:frames.map(f=>f.file),scope:'已独立判失败的候选及其改动，既不是本次来源也不是参考目标；保留较好来源，避免重复此失败几何'}))};
}

export function assertNotRejectedSpatialScene(attempts:any[],scene:any){
 const sha=digest(stable(scene));if(attempts.some(a=>a.canonicalSceneSha256===sha))throw Error('GRAYBOX_PREVIOUSLY_REJECTED：候选几何和机位与已有独立失败实拍完全相同；请依据失败反馈作实际改变，不重复渲染或评分');
 return scene;
}
