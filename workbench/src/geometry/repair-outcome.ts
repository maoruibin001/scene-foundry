import {assessmentOnly} from '../assessment-kind';
import {candidateProgress,candidateEvidence} from './candidate-selection';
import {assess} from '../assessment';
import {scoreControlEvidence} from './score-controls';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {read,save,runDir,digest} from '../store';
import {comparableAssessment} from './refinement-baseline';
import {verifiedBestScore} from './verified-best-score';

/** 分数与编辑痕迹只是证据，不能自动证明画面改善或归因于模型能力。 */
export function repairOutcome(input:any){
 const {before,after,reviewBefore,reviewAfter,goals,patch,comparable,budget}=input;
 const scored=comparable&&Number.isFinite(before?.score)&&Number.isFinite(after?.score);
 const delta=scored?Math.round((after.score-before.score)*10)/10:null;
 const rawBefore=input.deliveryBefore?.rawScore??before?.diagnostic?.score;
 const rawAfter=input.deliveryAfter?.rawScore??after?.diagnostic?.score;
 const rawDelta=scored&&Number.isFinite(rawBefore)&&Number.isFinite(rawAfter)?Math.round((rawAfter-rawBefore)*100)/100:null;
 const historicalBest=input.historicalBest??null;
 const bestBefore=scored?Math.max(before.score,historicalBest?.best?.score??before.score):null;
 const gainOverBest=scored?Math.round((after.score-bestBefore!)*10)/10:null;
 const dimensions=(after?.dimensions??[]).map((d:any)=>{
  const b=before?.dimensions?.find((x:any)=>x.id===d.id);
  const rawBefore=reviewBefore?.dimensions?.find((x:any)=>x.id===d.id)?.score??null;
  const rawAfter=reviewAfter?.dimensions?.find((x:any)=>x.id===d.id)?.score??null;
  return {id:d.id,before:b?.score??null,after:d.score,pointDelta:scored&&Number.isFinite(b?.points)&&Number.isFinite(d.points)?Math.round((d.points-b.points)*100)/100:null,rawBefore,rawAfter,derived:d.id==='coverage'};
 });
 const requirements=(reviewAfter?.requirements??[]).map((r:any)=>{
  const b=reviewBefore?.requirements?.find((x:any)=>x.id===r.id);
  return {id:r.id,before:b?.verdict??'unrecorded',after:r.verdict,reasonBefore:b?.reason??null,reasonAfter:r.reason,frames:r.frames,selectedGoalIds:(goals?.goals??[]).filter((g:any)=>g.requirementIds?.includes(r.id)).map((g:any)=>g.id)};
 });
 const batches=patch?.batches??(patch?[patch]:[]);
 const editUse=batches.map((p:any,index:number)=>({batch:index+1,parts:(p.parts?.length??0)+(p.surfaceUpdates?.length??0),partLimit:budget?.parts??null,removedParts:p.removeParts?.length??0,removalLimit:budget?.removeParts??null,materials:p.materials?.length??0,instances:p.instances?.length??0,templates:p.addTemplates?.length??0,textures:p.textures?.length??0,lighting:p.lighting!=null}));
 const templateIds=[...new Set((goals?.goals??[]).flatMap((g:any)=>g.templateIds??[]))];
 const frozenCoverage=requirements.length>0&&requirements.every((r:any)=>r.before===r.after);
 const rawCoverage=dimensions.find((d:any)=>d.id==='coverage');
 const qualityEvidence=(quality:any,review:any,spec:any,deliveryAssessment:any)=>candidateEvidence({quality,review,spec,policy:input.policy,deliveryAssessment,status:deliveryAssessment?.status??quality?.status});
 const selection=candidateProgress(qualityEvidence(before,reviewBefore,input.specBefore,input.deliveryBefore),qualityEvidence(after,reviewAfter,input.specAfter,input.deliveryAfter));
 const closedFailure=scored&&selection.eligible&&selection.closed.length>0;
 const signals:any[]=[];if(!selection.eligible)signals.push({kind:'protected_dimension_regression',evidence:selection.reasons,next:'保留此前候选，定位退步项的实际几何、机位、材质变化，下一轮先修正退步。'});
 if(!scored)signals.push({kind:'comparison_unverified',evidence:'缺少同契约前后评分，禁止计算提分。',next:'先核对原图、模型、评分契约和原始产物，再比较。'});
 if(!['scene-quality-v6','scene-quality-v7'].includes(after?.policy?.version)&&scored&&frozenCoverage&&requirements.some((r:any)=>r.after==='partial'))signals.push({kind:'coverage_quantization',evidence:{unchangedVerdicts:true,rawCoverageBefore:rawCoverage?.rawBefore,rawCoverageAfter:rawCoverage?.rawAfter},next:'需求分使用完成/部分/缺失离散档位；检查具体缺项和图像，不自动补分，也不据此判定评分错误。'});
 if(templateIds.length>=budget?.templates||editUse.some((b:any)=>b.partLimit!==null&&b.parts>=b.partLimit||b.removalLimit!==null&&b.removedParts>=b.removalLimit))signals.push({kind:'edit_limit_reached',evidence:{selectedTemplates:templateIds.length,templateLimit:budget?.templates,editUse},next:'达到编辑上限只是限制信号；核对暂缓目标或校验拒绝是否阻止必要改动。确认后扩展范围或表达能力，保留运行与质量检查。'});
 const unresolved=requirements.filter((r:any)=>r.selectedGoalIds.length&&r.after!=='met');
 if(unresolved.length)signals.push({kind:'selected_requirements_unresolved',evidence:unresolved.map((r:any)=>({id:r.id,goals:r.selectedGoalIds,reason:r.reasonAfter})),next:'逐项对照修复计划、实际补丁、编译场景及新截图，区分修改不足、渲染丢失、原需求复合粒度和评审依据；不能用发生编辑代替验收完成。'});
 if(after?.hardFailures?.length)signals.push({kind:'runtime_failure',evidence:after.hardFailures,next:'先修复真实运行问题，不能将失败归为纯视觉或模型能力。'});
 if(input.executionFailure)signals.push({kind:'execution_failure',evidence:input.executionFailure,next:scored?'本轮评分已保存；后续执行中断单列，不抹去已评候选，也不自动触发重跑。':'读取此阶段的具体错误与已保存产物；先恢复可验证的执行条件，不重复生成或伪造视觉分数。'});
 if(scored&&delta!>=2&&gainOverBest!<2)signals.push({kind:'recovery_without_meaningful_new_best',evidence:{sourceScore:before.score,bestObservedBefore:bestBefore,scoreAfter:after.score,delta,gainOverBest},next:'从退步版本恢复不能代替超过历史最佳；必须对照最佳画面说明新增价值，并分析尚未获得足够提升的原因。'});
 const controls=input.scoreControls?.controls??[],matchingControls=controls.filter((c:any)=>c.matchesSource);
 const bestControl=matchingControls.length?Math.max(...matchingControls.map((c:any)=>c.repeatScore)):null;
 const gainOverControl=scored&&bestControl!==null?Math.round((after.score-bestControl)*10)/10:null;
 const allSelectedUnresolved=requirements.some((r:any)=>r.selectedGoalIds.length)&&requirements.filter((r:any)=>r.selectedGoalIds.length).every((r:any)=>r.after!=='met');
 if(controls.length)signals.push({kind:'score_repeatability',evidence:input.scoreControls,next:'相同画面的重复评分已有变化；小涨幅需结合需求完成及图像证据，不能用调整分数或挑选最高复评成绩证明改善。'});
 // The delivery policy owns progress in both automatic and cross-job repair paths.
 // Formal-score repeatability remains diagnostic evidence; it cannot override raw/basic70 progress.
 const basic=input.policy?.deliveryStandard==='basic70';
 const insufficient=basic?!selection.meaningful:!closedFailure&&(gainOverBest!<2||allSelectedUnresolved||(gainOverControl!==null&&gainOverControl<2));
 const scoreSignal=!scored?'not_comparable':basic?(selection.meaningful?'effective_gain':(rawDelta??selection.rawGain??0)<0?'regression':'insufficient_gain'):(gainOverControl!==null&&gainOverControl<2&&gainOverBest!>=2?'uncertain_gain':gainOverBest!>=2?'effective_gain':gainOverBest!<0?'regression':'insufficient_gain');
 return {version:'repair-outcome-v6',deliveryStandard:basic?'basic70':'strict',deliveryStatus:input.deliveryAfter?.status??null,selection,sourceJobId:input.sourceJobId,jobId:input.jobId,comparison:{comparable:scored,scoreBefore:before?.score??null,scoreAfter:after?.score??null,delta,rawBefore:Number.isFinite(rawBefore)?rawBefore:null,rawAfter:Number.isFinite(rawAfter)?rawAfter:null,rawDelta,bestObservedBefore:bestBefore,gainOverBest,minMeaningfulGain:2,historicalBest,bestControl,gainOverControl,scoreControls:input.scoreControls??null},scoreSignal,requiresDiagnosis:!selection.eligible||!scored||insufficient||!!after?.hardFailures?.length||!!input.executionFailure,visualImprovement:'需核对真实截图；分差不单独证明视觉改善或统计显著性',dimensions,requirements,editUse,selectedTemplates:templateIds,deferred:goals?.deferred??[],signals,
  nextAction:after?.hardFailures?.length?'先修复运行失败，不能用分数上升作为交付依据':input.executionFailure?(scored?'保留本轮已评候选；后续执行已中断，是否继续须有新的诊断依据':'先诊断执行错误并复用已保存产物恢复；本轮尚无可比较评分'):!selection.eligible?'保留此前最佳候选，针对退步项诊断后再继续':!scored?'先补齐比较证据':insufficient?'先诊断上述信号，再提出有证据的新机制；禁止只提高推理强度或重复相同局部策略':'保留有效结果；核对画面改善和退步项后，再选择剩余需求',
  boundaries:'这是确定性复盘，不修改分数、门槛或历史；信号不是根因结论。强模型应能使用已验证的引擎能力，编辑上限与压缩策略须接受实际证据检验。'};
}

/** 完整复盘单独持久化，规划只增加不与已有历史重复的诊断信号。 */
export function repairOutcomeContext(r:any){return {version:r.version,deliveryStandard:r.deliveryStandard,deliveryStatus:r.deliveryStatus,comparison:{...r.comparison,historicalBest:r.comparison.historicalBest?{best:r.comparison.historicalBest.best?{jobId:r.comparison.historicalBest.best.jobId,score:r.comparison.historicalBest.best.score}:null,verifiedCount:r.comparison.historicalBest.verifiedCount}:null},scoreSignal:r.scoreSignal,selection:r.selection,requiresDiagnosis:r.requiresDiagnosis,dimensions:r.dimensions,editUse:r.editUse,
 requirementTransitions:r.requirements.map((v:any)=>({id:v.id,before:v.before,after:v.after,selectedGoalIds:v.selectedGoalIds})),
 signals:r.signals.map((s:any)=>({kind:s.kind,next:s.next})),nextAction:r.nextAction,scope:'完整原因和截图证据保留在原评审与复盘产物；此摘要不重复复制长文本，不作新评分。'};}

/** 当前复盘与历史规划共用来源验收，不把任务后来保留的候选混入原始轮次。 */
export function repairBaselineDelivery(job:any,meta:any,baselineReview:any,locate=runDir){
 if(job.policy?.deliveryStandard!=='basic70')return undefined;
 const root=locate(meta.sourceJobId),sourceDir=join(root,...(meta.sourceIteration==null?[]:['iterations',String(meta.sourceIteration)]));
 const original=read(join(root,'job.json'));
 const fields=meta.sourceIteration==null?{}:read(join(sourceDir,'candidate.json')).fields;
 const sourceJob={...original,...fields,policy:job.policy};
 const delivery=assess(sourceJob,baselineReview,sourceJob.runtime).deliveryAssessment;
 if(delivery.score!==meta.qualityBefore.score)throw Error('修复复盘基线评分与交付证据不一致');
 return delivery;
}

/** 在保存评分时自动生成独立审计产物，历史缺少来源时明确标记未核验。 */
export function deriveRepairOutcome(job:any,dir:string,locate=runDir){
 if(assessmentOnly(job))return null;
 const folders=[join(dir,'refinement'),...(job.iteration>0?[join(dir,'generation','iteration-'+job.iteration,'refinement')]:[]),join(dir,'generation','refinement')];
 const folder=folders.find(f=>existsSync(join(f,'source.json'))&&existsSync(join(f,'receipt.json')));
 if(!folder)return null;
 const meta=read(join(folder,'source.json')),receipt=read(join(folder,'receipt.json'));
 const sourceDir=join(locate(meta.sourceJobId),...(meta.sourceIteration==null?[]:['iterations',String(meta.sourceIteration)]));
 const current=read(join(dir,'generated-scene.json')),source=read(join(sourceDir,'generated-scene.json'));
 if(meta.sourceDigest!==digest(JSON.stringify(source))||receipt.sceneDigest!==digest(JSON.stringify(current))||receipt.sourceDigest!==meta.sourceDigest)throw Error('修复复盘来源或场景回执不一致');
 const baselineReview=existsSync(join(folder,'baseline','review.json'))?read(join(folder,'baseline','review.json')):read(join(sourceDir,'review.json'));
 const deliveryBefore=repairBaselineDelivery(job,meta,baselineReview,locate);
 const outcome=repairOutcome({scoreControls:scoreControlEvidence(job,meta.sourceDigest,undefined,locate),sourceJobId:meta.sourceJobId,jobId:job.id,before:meta.qualityBefore,after:job.quality??{hardFailures:Object.entries(job.runtime?.hard??{}).filter(([,passed])=>passed===false).map(([id])=>id)},deliveryBefore,deliveryAfter:job.deliveryAssessment,executionFailure:job.error?{stage:job.stage,error:job.error}:null,reviewBefore:baselineReview,reviewAfter:job.review,policy:job.policy,specBefore:existsSync(join(folder,'baseline','spec-report.json'))?read(join(folder,'baseline','spec-report.json')):existsSync(join(sourceDir,'spec-report.json'))?read(join(sourceDir,'spec-report.json')):null,specAfter:job.spec,goals:existsSync(join(folder,'repair-goals.json'))?read(join(folder,'repair-goals.json')):null,patch:read(join(folder,'patch.json')),budget:meta.repairBudget,historicalBest:verifiedBestScore(job,{locate}),comparable:!!meta.baselineProfile&&comparableAssessment({profile:meta.baselineProfile,plan:{acceptanceCriteria:meta.sourceCriteria??null}},{profile:job.assessmentProfile??job.profile,plan:job.plan})});
 return outcome;
}

export function saveRepairOutcome(job:any,dir:string,locate=runDir){const outcome=deriveRepairOutcome(job,dir,locate);if(outcome)save(join(dir,'repair-outcome.json'),outcome);return outcome;}
