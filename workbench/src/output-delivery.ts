import {existsSync,readdirSync,readFileSync,mkdirSync,cpSync,constants,realpathSync} from 'node:fs';
import {join,resolve,relative,sep} from 'node:path';
import {read,save,digest,runDir} from './store';
import {providerFault} from './provider-recovery';
import {externalProviderBlock} from './provider-external-block';
import {validateImageGoal,assessImageReconstruction,IMAGE_RECONSTRUCTION_VERSION} from './image-reconstruction';

/** Execution, output availability and quality are independent. No status/score is promoted here. */
export function failureDisposition(error:unknown){
 const text=String(error??'');
 if(/FIRST_SCORE_WINDOW_EXPIRED/.test(text))return {kind:'time-window',retryable:false,reason:'首轮时间窗已到；保留已有输出和未完成项，不把超时冒充评分完成'};
 if(/CANCELLED|AbortError/.test(text))return {kind:'cancelled',retryable:false,reason:'用户已取消；保留已经生成的结果'};
 if(/SCORE_BUDGET_RESERVED|SCENE_BUDGET_INSUFFICIENT|MODEL_BUDGET_EXHAUSTED|ASSESSMENT_BUDGET_RESERVED|预算不足/.test(text))return {kind:'budget',retryable:false,reason:'本任务调用预算不足，停止新增模型调用；已有结果仍可查看'};
 if(externalProviderBlock(error))return {kind:'external',retryable:false,reason:'供应商额度或授权不可用，需要外部恢复；保留已有结果'};
 if(/CODEX_ROUTE|MODEL_ROUTE|NOT_CONFIGURED|PROVIDER_TOOLS|本角色禁止|版本.*不一致|管线代码/.test(text))return {kind:'configuration',retryable:false,reason:'运行配置或工具契约错误，需要修复管线；不能原样重试'};
 if(/SPATIAL_GATE_FAILED|IMPROVEMENT_STOPPED/.test(text))return {kind:'quality',retryable:false,reason:'质量修正已达当前边界；交付已有候选及差距，等待有依据的改进'};
 if(providerFault(error).recoverable)return {kind:'transient',retryable:true,reason:'模型执行中断，自动校验检查点并恢复；不计场景质量失败，实际调用累计'};
 if(/TIMEOUT|超时|超过.*秒|PROVIDER_HTTP_(408|429|500|502|503|504)|ECONNRESET|ETIMEDOUT|fetch failed/i.test(text))return {kind:'transient',retryable:!text.includes('RECOVERY_EXHAUSTED'),reason:'临时执行故障；在预算内有限恢复，保留现有结果'};
 return {kind:'pipeline',retryable:false,reason:'管线执行异常，需要依据错误修复；已有结果不会删除'};
}
const local=(root:string,p:string)=>{const f=resolve(root,p);if(!f.startsWith(resolve(root)+sep)&&f!==resolve(root))throw Error('交付路径越界');if(existsSync(f)&&!realpathSync(f).startsWith(realpathSync(root)+sep)&&realpathSync(f)!==realpathSync(root))throw Error('交付符号链接越界');return f;};
const ASSESSMENT_FILES=['quality.json','review.json','spec-report.json','runtime/runtime.json','project/evidence/run-report.json'];
const IMAGE_FILES=['reconstruction-goal.json','image-reconstruction.json'];
/** Bind the final verdict to the exact render, scope and score before further work. */
export function sealAssessment(job:any,root:string){
 const files=[...ASSESSMENT_FILES];if(job.deliveryAssessment){save(join(root,'delivery-assessment.json'),job.deliveryAssessment);files.push('delivery-assessment.json');}
 files.push(...IMAGE_FILES.filter(f=>existsSync(join(root,f))));
 const value={version:'delivery-assessment-v1',jobId:job.id,scope:job.partialOutput?'partial':'scene',status:job.status,partial:job.partialOutput??null,distManifestDigest:job.runtime.distManifestDigest,files:Object.fromEntries(files.map(f=>[f,digest(readFileSync(join(root,f)))]))};
 save(join(root,'assessment-evidence.json'),value);return value;
}
function assessmentEvidence(base:string,hash:string){
 const path=join(base,'assessment-evidence.json');if(!existsSync(path))return null;
 const value=read(path);
 if(value.version!=='delivery-assessment-v1'||value.distManifestDigest!==hash||!['scene','partial'].includes(value.scope)||ASSESSMENT_FILES.some(f=>!existsSync(join(base,f))||value.files?.[f]!==digest(readFileSync(join(base,f)))))throw Error('交付评分与产物证据不匹配');
 if(value.files?.['delivery-assessment.json']&&(!existsSync(join(base,'delivery-assessment.json'))||digest(readFileSync(join(base,'delivery-assessment.json')))!==value.files['delivery-assessment.json']))throw Error('基础交付回执与产物不匹配');
 return value;
}
/** Optional visual reports cannot promote quality or invalidate an otherwise runnable output. */
function imageEvidence(job:any,base:string,folder:string,runtime:any,evidence:any,kind:string){
 const empty={reconstructionGoal:null,reconstructionGoalFile:null,imageReconstruction:null,imageReconstructionFile:null};
 if(!job.reconstructionGoal&&!IMAGE_FILES.some(f=>existsSync(join(base,f))))return empty;
 let goal:any=null,goalFile:string|null=null;
 const path=(f:string)=>[folder,f].filter(Boolean).join('/');
 try{
  goal=validateImageGoal(read(local(base,IMAGE_FILES[0])),job.images??[],job.prompt??'');
  if(!job.reconstructionGoal||goal.id!==job.reconstructionGoal.id)throw Error('原图目标与任务冻结目标不匹配');
  goalFile=path(IMAGE_FILES[0]);
  if(kind==='graybox')throw Error('空间草稿没有成品原图对照');
  if(evidence?.jobId!==job.id||evidence.distManifestDigest!==runtime.distManifestDigest)throw Error('缺少对应产物的评审封存证据');
  for(const f of IMAGE_FILES)if(evidence.files?.[f]!==digest(readFileSync(local(base,f))))throw Error('原图对照侧车摘要不匹配');
  const actual=read(local(base,IMAGE_FILES[1]));
  const expected=assessImageReconstruction({...job,reconstructionGoal:goal,partialOutput:kind==='partial'?{}:null,assessmentScope:kind==='partial'?'partial':'scene'},read(local(base,'review.json')),runtime).imageReconstruction;
  if(digest(JSON.stringify(actual))!==digest(JSON.stringify(expected)))throw Error('原图判定与本候选的评审、机位或截图不匹配');
  return {reconstructionGoal:goal,reconstructionGoalFile:goalFile,imageReconstruction:actual,imageReconstructionFile:path(IMAGE_FILES[1])};
 }catch(error){
  return {...empty,reconstructionGoal:goal,reconstructionGoalFile:goalFile,imageReconstruction:{version:IMAGE_RECONSTRUCTION_VERSION,goalId:goal?.id??job.reconstructionGoal?.id??null,distManifestDigest:runtime.distManifestDigest,status:'needs_review',level:'unverified',scope:kind==='scene'?'complete':'partial',references:[],reasons:['当前交付产物的原图对照未核实：'+String(error)]}};
 }
}
export function inspectOutput(job:any,root:string,folder:string,kind:'scene'|'graybox'|'partial'){
 const base=local(root,folder),runtimeFile=join(base,'runtime/runtime.json'),manifest=join(base,'project/game/dist/forgeax-dist.json'),reportFile=join(base,'project/evidence/run-report.json');
 if(![runtimeFile,manifest,reportFile].every(existsSync))return null;
 try{
  const runtime=read(runtimeFile),report=read(reportFile),hash=digest(readFileSync(manifest));
  if(report.distManifestDigest!==hash||runtime.distManifestDigest!==hash||report.engineSha!==job.profile.engineSha||report.generatorSha!==job.profile.generatorSha)return null;
  if(['engine-build','asset-verify','asset-ready','engine-status'].some(k=>report.stages?.[k]?.status!=='passed'))return null;
  if(!runtime.hard?.runtime||!runtime.hard?.noErrors||!runtime.hard?.entitiesLoaded||!runtime.images?.length||runtime.hashes?.length!==runtime.images.length)return null;
  const images=runtime.images.map((name:string,i:number)=>{if(typeof name!=='string'||!existsSync(local(join(base,'runtime'),name))||digest(readFileSync(local(join(base,'runtime'),name)))!==runtime.hashes[i])throw Error('交付截图摘要不匹配');return [folder,'runtime',name].filter(Boolean).join('/');});
  let evidence:any=null,assessmentError:string|null=null;try{evidence=assessmentEvidence(base,hash);}catch(error){assessmentError=String(error);}
  const snapshot=existsSync(join(base,'candidate.json'))?read(join(base,'candidate.json')):null,output=existsSync(join(base,'output.json'))?read(join(base,'output.json')):null;
  let layoutDraft:any=null;const draftPath=join(base,'layout-draft.json');
  if(existsSync(draftPath)){
   layoutDraft=read(draftPath);
   if(layoutDraft.version!=='initial-space-draft-v1'||layoutDraft.jobId!==job.id||layoutDraft.rootJobId!==(job.executionRecoveryRoot??job.id)||layoutDraft.scope!=='bounds-only'||layoutDraft.completeScene!==false||layoutDraft.spatialGatePassed!==false||layoutDraft.quality!=='not-assessed'||layoutDraft.distManifestDigest!==hash)throw Error('布局草稿来源或范围不符');
   for(const file of ['checkpoint-source.json','scene.json','render-scene.json'])if(!existsSync(local(base,file))||layoutDraft.files?.[file]!==digest(readFileSync(local(base,file))))throw Error('布局草稿证据不匹配');
   const checkpoint=read(local(base,'checkpoint-source.json'));
   if(checkpoint.checksum!==layoutDraft.checkpointSha256||checkpoint.inputKey!==layoutDraft.inputKey||checkpoint.jobId!==job.id)throw Error('布局草稿检查点来源不符');
   kind='graybox';
  }else if(output?.layoutDraft)throw Error('布局草稿说明缺失');
  const partial=evidence?.partial??snapshot?.fields?.partialOutput??output?.partial??(!folder?job.partialOutput:null);
  // A partial iteration must never be promoted merely because it has a score.
  if(kind!=='graybox'&&(partial||evidence?.scope==='partial'||snapshot?.fields?.assessmentScope==='partial'))kind='partial';
  const assessed=!assessmentError&&report.browser?.distManifestDigest===hash&&report.spec&&existsSync(join(base,'spec-report.json'))&&digest(JSON.stringify(report.spec))===digest(JSON.stringify(read(join(base,'spec-report.json'))));
  const q=kind!=='graybox'&&assessed&&existsSync(join(base,'quality.json'))?read(join(base,'quality.json')):null;
  const delivery=evidence?.files?.['delivery-assessment.json']?read(join(base,'delivery-assessment.json')):null;
  const status=evidence?.status??snapshot?.fields?.status??output?.assessmentStatus??(!folder?job.status:null);
  return {kind,folder,layoutDraft,deliveryStandard:delivery?.standard??'strict',deliveryStatus:kind==='scene'&&q&&delivery?.status==='passed'&&Object.values(runtime.hard).every(x=>x===true)?'passed':null,distManifestDigest:hash,images,project:[folder,'project'].filter(Boolean).join('/'),runtime:[folder,'runtime/runtime.json'].filter(Boolean).join('/'),engine:'ForgeaX Engine',pipelineVersion:job.generatedVersion??job.pipelineVersion,assessmentScope:kind==='partial'?'partial':kind==='graybox'?'graybox':'scene',partial:partial??null,assessmentError,qualityStatus:q?(kind==='partial'?'partial_assessed':status==='passed'&&q.status==='passed'&&report.spec.status==='passed'&&Object.values(runtime.hard).every(x=>x===true)?'passed':'not_met'):'not_assessed',score:q&&Number.isFinite(q.score)?q.score:null,hardChecks:runtime.hard,qualityFile:q?[folder,'quality.json'].filter(Boolean).join('/'):null,...imageEvidence(job,base,folder,runtime,evidence,kind)};
 }catch{return null;}
}
/** Reuse spatial selection; never rank drafts by score or snapshot directory name. */
function retainedGraybox(job:any,root:string,candidates:any[],basis:any){
 try{
  if(basis.jobId!==job.id||!Number.isFinite(basis.score)||typeof basis.passed!=='boolean')return null;
  const folder='generation/blockout/'+basis.round,base=local(root,folder);
  if(typeof basis.folder!=='string'||realpathSync(basis.folder)!==realpathSync(base))return null;
  const selected=candidates.find(v=>v.kind==='graybox'&&v.folder===folder);
  if(!selected||selected.distManifestDigest!==basis.runtimeDigest)return null;
  const rows=job.blockout.rounds.filter((r:any)=>r.round===basis.round),gate=read(join(base,'gate.json'));
  if(rows.length!==1||digest(JSON.stringify(rows[0]))!==digest(JSON.stringify(gate)))return null;
  const retained=gate.selection?.retained;
  if(!gate.selection?.eligible||!gate.selection?.changed||retained?.jobId!==job.id||retained?.round!==basis.round)return null;
  if(gate.review?.score!==basis.score||gate.passed!==basis.passed||gate.runtimeDigest!==basis.runtimeDigest)return null;
  if(retained.score!==basis.score||retained.passed!==basis.passed||retained.runtimeDigest!==basis.runtimeDigest)return null;
  return selected;
 }catch{return null;}
}
export function deliveryInfo(job:any,root=runDir(job.id)){
 const candidates:any[]=[];
 const current=inspectOutput(job,root,'',job.partialOutput?'partial':'scene');if(current)candidates.push(current);
 const outputs=join(root,'delivery/outputs');if(existsSync(outputs))for(const n of readdirSync(outputs)){if(!/^(scene|graybox|partial)-[a-f0-9]{16}$/.test(n))continue;const v=inspectOutput(job,root,'delivery/outputs/'+n,n.split('-')[0] as any);if(v)candidates.push(v);}
 const iterations=join(root,'iterations');if(existsSync(iterations))for(const n of readdirSync(iterations).filter(n=>/^\d+$/.test(n))){const v=inspectOutput(job,root,'iterations/'+n,'scene');if(v)candidates.push(v);}
 const blockouts=join(root,'generation/blockout');if(existsSync(blockouts))for(const n of readdirSync(blockouts).filter(n=>/^\d+$/.test(n)).sort((a,b)=>Number(b)-Number(a))){const v=inspectOutput(job,root,'generation/blockout/'+n,'graybox');if(v)candidates.push(v);}
 // Valid assessed candidates first, then actual scene, partial, and spatial draft. Never infer quality from a graybox.
 const rank=(v:any)=>(v.kind==='scene'?30:v.kind==='partial'?20:v.layoutDraft?5:10)+(v.qualityStatus==='passed'||v.deliveryStatus==='passed'?100:0)+(v.score??0)/100;
 candidates.sort((a,b)=>rank(b)-rank(a));
 // Selection includes regression and hard-gate checks; a higher score alone cannot replace it.
 const requested=job.selectedIteration??job.visualIterations?.bestIndex;
 const hasSelection=Number.isSafeInteger(requested)&&requested>=0;
 const selected=hasSelection?candidates.find(v=>v.folder==='iterations/'+requested):null;
 let verifiedSelection=false;
 if(selected)try{
  const snapshot=read(join(root,selected.folder,'candidate.json'));
  verifiedSelection=snapshot.jobId===job.id&&snapshot.pipelineVersionId===job.pipelineVersion?.id&&snapshot.cycle?.index===requested
   &&Number.isFinite(selected.score)&&snapshot.cycle.score===selected.score
   &&snapshot.fields?.runtime?.distManifestDigest===selected.distManifestDigest
   &&digest(JSON.stringify(snapshot.fields?.quality))===digest(JSON.stringify(read(join(root,selected.folder,'quality.json'))));
 }catch{}
 let best=verifiedSelection?selected:candidates[0]??null;
 const basis=job.blockout?.repairBasis,hasBlockout=Number.isSafeInteger(basis?.round)&&basis.round>=0&&typeof basis.jobId==='string';
 let selectedBlockout=false;
 // A detailed or partial scene still takes precedence. Foreign recovery sources cannot escape this job.
 const requestedBlockout=!hasSelection&&best?.kind==='graybox'&&hasBlockout?{jobId:basis.jobId,round:basis.round}:null;
 if(requestedBlockout){const spatial=retainedGraybox(job,root,candidates,basis);if(spatial){best=spatial;selectedBlockout=true;}}
 const selection={requestedIteration:hasSelection?requested:null,servedIteration:best?.folder?.match(/^iterations\/(\d+)$/)?Number(best.folder.split('/')[1]):null,
  requestedBlockout,servedBlockout:best?.kind==='graybox'&&best.folder.match(/^generation\/blockout\/(\d+)$/)?Number(best.folder.split('/')[2]):null,
  status:verifiedSelection?'selected':hasSelection?'fallback':'available',reason:hasSelection&&!verifiedSelection?'保留候选的证据不完整；暂提供另一份已核验可运行输出，不代表重新选优':null};
 if(requestedBlockout){selection.status=selectedBlockout?'selected':'fallback';selection.reason=selectedBlockout?'已按管线选优记录提供保留灰模；空间评分 '+basis.score+'/5，不代表成品通过':'保留灰模的证据不完整或属于来源任务；暂提供本任务已核验可运行输出，不代表重新选优';}
 return {version:'output-delivery-v2',available:!!best,state:best?'available':['running','queued'].includes(job.status)?'pending':'unavailable',best,selection,execution:{status:job.status,stage:job.stage,error:job.error??null,fault:job.error?failureDisposition(job.error):null},partial:best?.partial??job.partialOutput??null,limitations:best?.layoutDraft?best.layoutDraft.limitations:best?.kind==='graybox'?'空间草稿，尚未完成详细资产和成品验收':best?.kind==='partial'?'部分资产仍使用本次已经生成的灰模；分数只代表这份草稿，未完成成品验收':best?.assessmentError?'评分证据与当前产物不匹配；保留可运行输出，评分待恢复':best?.qualityStatus==='not_assessed'?'已生成并验证运行，视觉质量尚未完成评估':best?.qualityStatus==='not_met'?'已有场景输出，当前质量未达标':null};
}
/** Freeze a real render BEFORE external judging/repair; later exceptions cannot erase it. */
export function preserveOutput(job:any,root:string,folder:string,kind:'scene'|'graybox'|'partial'){
 const checked=inspectOutput(job,root,folder,kind);if(!checked)return null;
 const assessmentFile=join(root,folder,'assessment-evidence.json');
 const identity=digest(JSON.stringify([checked.distManifestDigest,read(join(root,folder,'runtime/runtime.json')).hashes,checked.kind,existsSync(assessmentFile)?digest(readFileSync(assessmentFile)):null]));
 const target='delivery/outputs/'+checked.kind+'-'+identity.slice(0,16),dest=join(root,target);
 if(!existsSync(join(dest,'output.json'))){mkdirSync(dest,{recursive:true});for(const item of ['voxel-source-scene.json','voxelization-report.json','voxel-program.json','voxel-metrics.json','layout-draft.json','checkpoint-source.json','scene.json','render-scene.json','scene.vox',...IMAGE_FILES,'project','runtime','materials','generated-scene.json','quality.json','review.json','spec-report.json','delivery-assessment.json','assessment-evidence.json','structure.json','spatial-contacts.json','spatial-openings.json','surface-audit.json']){const p=join(root,folder,item);if(existsSync(p))cpSync(p,join(dest,item),{recursive:true,dereference:false,verbatimSymlinks:true,mode:constants.COPYFILE_FICLONE});}save(join(dest,'output.json'),{createdAt:new Date().toISOString(),source:folder,pipelineVersion:job.generatedVersion??job.pipelineVersion,kind:checked.kind,layoutDraft:checked.layoutDraft,distManifestDigest:checked.distManifestDigest,partial:checked.partial,assessmentStatus:job.status});}
 return inspectOutput(job,root,target,checked.kind);
}
export function saveDelivery(job:any,root=runDir(job.id)){const info=deliveryInfo(job,root);save(join(root,'delivery.json'),info);return info;}
