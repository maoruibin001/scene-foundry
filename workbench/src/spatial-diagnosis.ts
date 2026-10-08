import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {read,runDir,digest} from './store';
import {GRAYBOX_SPACE_REPAIR} from './geometry/graybox-space-repair';
import {assertVisibilityCamera} from './geometry/visibility-evidence';
import type {ImprovementLedger} from './improvement-governance';

const HARD=['framing','cameraMotion','nonFlat','multipleViews','entitiesLoaded','frameRate','runtime','noErrors','hudToggle','video','cameraStopped'];
export function spatialRepairBasis(source:any,round:unknown){
 if(source.generationMode!=='qualified'||!['failed','needs_review'].includes(source.status)||source.blockout?.status!=='stopped'||!source.improvementId||source.sceneProgram)throw Error('需要已按无改善停止、尚未放行详细资产的灰模任务');
 if(!Number.isInteger(round)||!source.blockout.rounds?.some(r=>r.round===round&&r.passed===false&&Number.isFinite(r.review?.score)&&Number.isFinite(r.endedAt)))throw Error('只能选择已经完整评估的灰模轮次');
 return {jobId:source.id,round:round as number};
}

/** Inspect immutable Engine and score evidence before a diagnosed continuation can be dispatched. */
export function loadSpatialRepairSeed(source:any,round:unknown){
 const basis=spatialRepairBasis(source,round),folder=join(runDir(source.id),'generation/blockout',String(basis.round));
 const names=['space.json','scene.json','render-scene.json','presentation.json','gate.json','runtime/runtime.json','project/evidence/run-report.json','scene-space-judge-parsed.json','scene-space-judge-receipt.json','scene-space-judge-input-receipt.json'];
 const values=Object.fromEntries(names.map(n=>[n,read(join(folder,n))]));
 const runtime=values['runtime/runtime.json'],gate=values['gate.json'],presentation=values['presentation.json'];
 if(gate.round!==basis.round||JSON.stringify(gate.review)!==JSON.stringify(values['scene-space-judge-parsed.json'])||values['scene-space-judge-receipt.json'].stopReason!=='completed'||values['scene-space-judge-receipt.json'].requestedModel!==source.modelSettings.model)throw Error('灰模来源评分与完成收据不一致');
 if(!HARD.every(k=>runtime.hard?.[k]===true)||runtime.distManifestDigest!==values['project/evidence/run-report.json'].distManifestDigest||gate.runtimeDigest!==runtime.distManifestDigest)throw Error('灰模来源完整Engine证据未通过');
 if(presentation.canonicalSha256!==digest(JSON.stringify(values['scene.json']))||presentation.renderSha256!==digest(JSON.stringify(values['render-scene.json'])))throw Error('灰模来源场景与实际渲染不一致');
 for(const [index,file] of runtime.images.entries())if(digest(readFileSync(join(folder,'runtime',file)))!==runtime.hashes[index])throw Error('灰模来源运行图片哈希不一致');
 for(const [index,camera] of values['render-scene.json'].cameras.entries()){
  const frame=runtime.referenceFrames?.[index];if(!frame||frame.referenceIndex!==camera.referenceIndex||!runtime.images.includes(frame.file))throw Error('灰模来源实际机位不完整');
  const png=readFileSync(join(folder,'runtime',frame.file));if(png.length<24||png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('灰模来源机位图片无效');
  assertVisibilityCamera(camera,runtime.poses?.[index],index,png.readUInt32BE(16),png.readUInt32BE(20));
 }
 for(const image of values['scene-space-judge-input-receipt.json'].images)if(digest(readFileSync(image.path))!==image.sha256)throw Error('灰模来源评分输入哈希不一致');
 return {...basis,folder,space:values['space.json'],feedback:gate.review,provenance:{sourceJobId:source.id,sourceRound:basis.round,sourceVersion:source.pipelineVersion,sourceFiles:Object.fromEntries(names.map(n=>[n,digest(readFileSync(join(folder,n)))])),runtimeDigest:runtime.distManifestDigest,score:gate.review.score,sourceAccepted:false,modelCall:false}};
}

export function resumeDiagnosedSpatialRepair(ledger:ImprovementLedger,source:any,round:unknown,reason:unknown,version:any,assessmentProtocol:string){
 spatialRepairBasis(source,round);
 if(typeof reason!=='string'||reason.trim().length<40||reason.length>6000)throw Error('请说明真实失败证据、已验证的新机制和下一轮检查（40至6000字）');
 if(!version?.id||version.id===source.pipelineVersion?.id)throw Error('来源路径已停止，需要已验证并冻结的新机制版本；不能原样重跑');
 if(assessmentProtocol!==source.profile?.assessmentProtocolSha256)throw Error('空间诊断续接不能改变评分协议或复评旧画面');
 const current=ledger.get(source.improvementId);
 if(current.limits.repairs!==null||current.limits.calls!==null)throw Error('新机制入口不绕过累计预算');
 const id=digest(JSON.stringify([source.executionRecoveryRoot??source.id,version.id,GRAYBOX_SPACE_REPAIR]));
 if(current.strategyRevisions?.some(r=>r.id===id))throw Error('此冻结机制已经尝试，改写说明或换来源轮次不会重新获得重跑机会');
 if(!current.stopped?.startsWith('同一评审契约连续两轮'))throw Error('外部阻塞或其他停止原因需先解除，不能冒充质量诊断');
 ledger.reviseStrategy(source.improvementId,{id,reason:reason.trim(),pipelineVersion:version,additionalRepairs:0});
 return {contract:GRAYBOX_SPACE_REPAIR,reason:reason.trim(),revisionId:id,sourceRound:round,sourceJobId:source.id};
}

export function activeSpatialRepair(source:any,jobs:any[]){return jobs.find(j=>j.improvementId===source.improvementId&&['running','queued'].includes(j.status));}
