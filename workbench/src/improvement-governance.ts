import {candidateProgress} from './geometry/candidate-selection';
import {reserveOptimizationCall} from './optimization-rounds';
import {mkdirSync,existsSync} from 'node:fs';
import {join,resolve,relative} from 'node:path';
import {DATA,read,save,digest,listJobs} from './store';
export const IMPROVEMENT_LIMITS={repairs:2,calls:100,noGain:2,minGain:2};
/** 比较键代表相同评审契约；实验名称只用于审计，不能隔离质量历史。 */
export function qualityComparison(job:any){return digest(JSON.stringify([job.policy,job.modelSettings,job.profile.assessmentProtocolSha256]));}
/** Historical scope comes only from the immutable assessment receipt, never the latest mutable job. */
export function storedAssessmentScope(r:any){
 if(!/^[a-f0-9-]{36}$/.test(r.jobId??'')||!/^[a-f0-9-]{36}$/.test(r.assessmentId??''))return null;
 const p=join(DATA,'runs',r.jobId,'score-history',r.assessmentId,'assessment.json');if(!existsSync(p))return null;
 const a=read(p);return a.immutable===true&&a.id===r.assessmentId&&a.jobId===r.jobId&&a.score===r.score&&['scene','partial'].includes(a.assessmentScope)?a.assessmentScope:null;
}
const resultScope=(r:any)=>r.assessmentScope??r.evidence?.assessmentScope??'legacy-unknown';
export function scoreProgress(results:any[],current:any,minGain:number,streakStart=0){
 if(!Number.isInteger(streakStart)||streakStart<0||streakStart>results.length)throw Error('策略结果边界无效');
 const family=(r:any)=>r.comparison?.startsWith('scene-quality-')?'final':r.metric??r.kind;
 const same=(r:any)=>r.comparison===current.comparison&&family(r)===family(current)&&resultScope(r)===resultScope(current)&&Number.isFinite(r.score);
 const indexed=results.map((row,index)=>({...row,resultIndex:index})).filter(same),rows=indexed;
 if(current.evidence&&rows.some((r:any)=>r.evidence)){
  const detailed=rows.filter((r:any)=>r.evidence);let selected=detailed[0],noGain=0;
  for(const row of detailed.slice(1)){const p=candidateProgress(selected.evidence,row.evidence);if(p.meaningful&&!row.requiresDiagnosis){selected=row;noGain=0;}else if(row.resultIndex>=streakStart)noGain++;}
  const progress=candidateProgress(selected.evidence,current.evidence),meaningful=progress.meaningful&&!current.requiresDiagnosis;
  noGain=meaningful?0:noGain+1;
  const previousBest=Math.max(...rows.map((r:any)=>r.score));const numericBest=Math.max(previousBest,current.score);
  return {comparable:rows.length,previousBest,bestScore:numericBest,bestJobId:current.score>previousBest?current.jobId:rows.find((r:any)=>r.score===previousBest)?.jobId,selectedJobId:meaningful?current.jobId:selected.jobId,noGain,delta:Math.round((current.score-previousBest)*100)/100,improved:meaningful,selection:progress};
 }
 let best=-Infinity,noGain=0,bestJobId:string|null=null;
 for(const r of rows){if(best!==-Infinity&&r.resultIndex>=streakStart)noGain=r.score-best>=minGain&&!r.requiresDiagnosis?0:noGain+1;if(r.score>best){best=r.score;bestJobId=r.jobId??null;}}
 const previousBest=Number.isFinite(best)?best:null;
 if(!Number.isFinite(current.score))return {comparable:rows.length,previousBest,bestScore:previousBest,bestJobId,noGain,delta:null,improved:false};
 if(previousBest!==null)noGain=current.score-previousBest>=minGain&&!current.requiresDiagnosis?0:noGain+1;
 const improved=previousBest===null||current.score>previousBest;
 return {comparable:rows.length,previousBest,bestScore:improved?current.score:previousBest,bestJobId:improved?current.jobId??null:bestJobId,noGain,delta:previousBest===null?null:Math.round((current.score-previousBest)*100)/100,improved};
}
/** New mechanism boundaries affect only the stop streak, never historical selection or budgets. */
export function strategyResultBoundary(v:any){
 const revision=v.strategyRevisions?.at(-1),index=revision?.resultCount;
 if(index===undefined)return 0; // Legacy records are preserved, not retroactively rewritten.
 if(!Number.isInteger(index)||index<0||index>v.results.length)throw Error('策略结果边界无效');
 return index;
}
export class ImprovementLedger {
 constructor(readonly root:string,readonly resolveScope:(r:any)=>string|null=storedAssessmentScope){mkdirSync(root,{recursive:true});}
 scopedResults(rows:any[]){return rows.map(r=>{const scope=r.assessmentScope??r.evidence?.assessmentScope??this.resolveScope(r);return scope?{...r,assessmentScope:scope}:r;});}
 /** Correct a proven draft/scene comparison error without deleting history or granting calls/repairs. */
 reconcileScopeProgress(v:any){
  const rows=this.scopedResults(v.results),last=rows.at(-1);
  if(!last||!rows.some((r,i)=>r.assessmentScope!==v.results[i].assessmentScope)||!last.assessmentScope)return;
  const key=digest(JSON.stringify(rows.map(r=>[r.jobId,r.assessmentId,r.assessmentScope])));
  if(v.scopeCorrections?.some((r:any)=>r.key===key))return;
  const before={noGain:v.noGain,progress:v.progress,stopped:v.stopped??null,diagnosis:v.diagnosis??null};
  const boundary=strategyResultBoundary(v),progress=scoreProgress(rows.slice(0,-1),last,v.limits.minGain,Math.min(boundary,rows.length-1));
  if(boundary>=rows.length)progress.noGain=0;
  v.noGain=progress.noGain;v.progress=progress;
  if(progress.noGain<v.limits.noGain&&typeof v.stopped==='string'&&v.stopped.startsWith('同一评审契约连续两轮')){delete v.stopped;delete v.diagnosis;}
  (v.scopeCorrections??=[]).push({key,at:Date.now(),reason:'草稿与完整成品按不可变评估凭据分开比较；原始评分、修复次数和实际调用不变',before,after:{noGain:v.noGain,progress,stopped:v.stopped??null},receipts:rows.filter(r=>r.assessmentScope).map(r=>({jobId:r.jobId,assessmentId:r.assessmentId,scope:r.assessmentScope}))});
  save(this.path(v.id),v);
 }
 inputKey(input:any){return digest(JSON.stringify([String(input.prompt??'').trim().replace(/\s+/g,' '),(input.images??[]).map((i:any)=>i.id),...(input.sceneKind==='voxel'?['voxel']:[])]));}
 key(input:any){const key=this.inputKey(input);return input.reuseMode==='fresh'&&input.generationMode==='first-pass'&&input.baselineId?digest(JSON.stringify([key,'fresh-first-pass',input.baselineId])):key;}
 path(id:string){if(!/^[a-f0-9]{64}$/.test(id))throw Error('实验标识无效');return join(this.root,id+'.json');}
 get(id:string){return read(this.path(id));}
 enter(input:any,jobId:string,historical:any[]=[],source?:any,mode='generation'){const id=source?.improvementId??this.key(input),p=this.path(id),v=existsSync(p)?read(p):{id,createdAt:Date.now(),strategy:'image-first-graybox-v1',limits:input.generationMode==='qualified'?{...IMPROVEMENT_LIMITS,repairs:null,calls:null}:IMPROVEMENT_LIMITS,repairs:0,calls:0,noGain:0,jobs:[],results:[],history:historical.map(j=>({id:j.id,score:j.quality?.score??null,status:j.status,pipelineVersion:j.pipelineVersion?.label})),scope:this.key(input)!==this.inputKey(input)?'用户确认的从头首轮验证；绑定参考基准，同基准和技术恢复不重置；历史案例独立保留，全局调用仍累计': '历史运行保留审计；新机制从首次启用起统一累计，换模型、版本或新任务不重置',inputKey:this.inputKey(input),firstPassBaseline:this.key(input)!==this.inputKey(input)?input.baselineId:null};
  this.reconcileScopeProgress(v);this.allowed(v,mode==='assessment');if(mode!=='assessment'&&v.jobs.length&&(!source||(mode==='generation'&&Number.isFinite(source.quality?.score))))this.repair(v,'重新生成','相同输入新建任务计入同一实验，不重新获得首轮预算');v.jobs.push(jobId);save(p,v);return id;
 }
 allowed(v:any,assessmentOnly=false){if(v.stopped&&!assessmentOnly)throw Error('IMPROVEMENT_STOPPED：'+v.stopped);if(v.limits.calls!==null&&v.calls>=v.limits.calls)this.stop(v,'累计模型调用已达上限，需诊断机制与基础条件');}
 markStopped(id:string,reason:string,details:any={}){const v=this.get(id);v.stopped=reason;v.diagnosis={at:Date.now(),reason,...details};save(this.path(id),v);return v;}
 stop(v:any,reason:string):never {v.stopped=reason;v.diagnosis={at:Date.now(),reason,questions:['参考基准是否一致、可观察？','空间规划与实际相机是否一致？','几何表达或运行能力是否成为瓶颈？','评分是否有对应画面证据？'],next:'保存最小失败证据，提出可验证的新机制和回归样例，在已授权目标内修复策略后继续；不自动换模型、放宽阈值或原样重跑'};save(this.path(v.id),v);throw Error('IMPROVEMENT_STOPPED：'+reason);}
 repair(v:any,phase:string,hypothesis:string,reservationKey?:string){this.allowed(v);if(!hypothesis?.trim())throw Error('修正必须有明确差距与可验证假设');if(v.limits.repairs!==null&&v.repairs>=v.limits.repairs)this.stop(v,`灰模与成品已共用 ${v.limits.repairs} 次修正额度`);v.repairs++;(v.actions??=[]).push({phase,hypothesis,at:Date.now(),...(reservationKey?{reservationKey}:{})});save(this.path(v.id),v);}
 reserveRepair(id:string,phase:string,hypothesis:string){this.repair(this.get(id),phase,hypothesis);}
 /** The diagnosed first patch is one logical quality repair across technical continuations. */
 reserveStrategyRepair(id:string,phase:string,hypothesis:string,revisionId:string){
  const v=this.get(id);this.allowed(v);const revision=v.strategyRevisions?.find(r=>r.id===revisionId);
  if(!revision||v.strategy!==revisionId||revision.reason!==hypothesis)throw Error('IMPROVEMENT_STOPPED：局部修正必须沿用当前已确认机制与原假设，不能借恢复重新预留');
  const key=phase+'/'+revisionId,prior=v.actions?.find((a,index)=>a.reservationKey===key||(Number.isInteger(revision.before?.repairs)&&v.actions.length===v.repairs&&index>=revision.before.repairs&&a.phase===phase&&a.hypothesis===hypothesis&&a.at>=revision.at));
  if(prior)return {reused:true,reservedAt:prior.at,reservationKey:key};
  this.repair(v,phase,hypothesis,key);return {reused:false,reservationKey:key};
 }
 reviseStrategy(id:string,change:{id:string;reason:string;pipelineVersion:any;additionalRepairs:number}){
  const v=this.get(id);if(v.strategyRevisions?.some((r:any)=>r.id===change.id))return v;
  if(!change.reason?.trim()||!change.id||!Number.isInteger(change.additionalRepairs)||change.additionalRepairs<0||change.additionalRepairs>2)throw Error('新策略必须明确说明机制变化和有限追加修复次数');
  if(v.limits.calls!==null&&v.calls>=v.limits.calls)throw Error('累计调用已达上限，策略更新不能重置调用预算');
  const before={limits:{...v.limits},repairs:v.repairs,calls:v.calls,noGain:v.noGain,stopped:v.stopped??null,diagnosis:v.diagnosis??null};
  v.limits={...v.limits,repairs:v.limits.repairs===null?null:v.limits.repairs+change.additionalRepairs};v.noGain=0;delete v.stopped;delete v.diagnosis;
  (v.strategyRevisions??=[]).push({...change,at:Date.now(),resultCount:v.results.length,before,after:{limits:{...v.limits},repairs:v.repairs,calls:v.calls,noGain:0}});v.strategy=change.id;save(this.path(id),v);return v;
 }
 call(id:string,role:string,assessmentOnly=false){const v=this.get(id);this.allowed(v,assessmentOnly);v.calls++;(v.requests??=[]).push({role,at:Date.now()});save(this.path(id),v);}
 result(id:string,r:any){const auditPath=typeof r.jobId==='string'&&/^[a-f0-9-]{36}$/.test(r.jobId)?join(DATA,'runs',r.jobId,'repair-outcome.json'):null;if(auditPath&&existsSync(auditPath)){const audit=read(auditPath);if(['repair-outcome-v3','repair-outcome-v5'].includes(audit.version)&&audit.comparison.scoreAfter===r.score)r={...r,requiresDiagnosis:audit.requiresDiagnosis,scoreSignal:audit.scoreSignal};}const v=this.get(id),progress=scoreProgress(this.scopedResults(v.results),this.scopedResults([r])[0],v.limits.minGain,strategyResultBoundary(v));v.noGain=progress.noGain;v.progress=progress;v.results.push({...r,progress,at:Date.now()});if(r.status!=='passed'&&v.noGain>=v.limits.noGain){v.stopped='同一评审契约连续两轮未有效超过历史最佳，停止当前策略';v.diagnosis={at:Date.now(),reason:v.stopped,progress,next:'保留历史最佳和退步证据；先复核空间、表达能力和评分证据，再提交可验证的新机制实验'};}save(this.path(id),v);return v;}
 remaining(id:string){const v=this.get(id);return v.stopped?0:v.limits.repairs===null?Infinity:Math.max(0,v.limits.repairs-v.repairs);}
}
export const improvement=new ImprovementLedger(join(DATA,'improvement'));
export function reserveModelCall(dir:string,role:string){const rel=relative(join(DATA,'runs'),resolve(dir)),id=rel.split('/')[0];if(!rel.startsWith('..')&&/^[a-f0-9-]{36}$/.test(id)){const p=join(DATA,'runs',id,'job.json');if(existsSync(p)){const j=read(p);reserveOptimizationCall(j,role);if(j.improvementId)improvement.call(j.improvementId,role,['plan','judge'].includes(role)&&!!j.reuseAssessmentFrom);}}}
