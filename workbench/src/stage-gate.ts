import {createHash} from 'node:crypto';
import {DEFAULT_POLICY,dimensionsFor,HARD_CHECKS,automaticGeneration,qualityGate} from './quality';
import {assessmentHardChecks} from './assessment';
import {generationInput,referenceImageIds} from './reference-input';

export const STAGE_VERSION='single-submission-80-v1';
const sha=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const terminal=new Set(['passed','failed','cancelled','blocked','needs_review']);
const normalizedPrompt=(input:any)=>String(input.prompt??'').normalize('NFKC').replace(/\s+/g,' ').trim();
const identity=(input:any)=>({...generationInput(input),prompt:normalizedPrompt(input)});

/** 新颖性只机械排除相同描述及复用参考图；不声称已证明语义新颖性。 */
export function freezeStage(batch:any,priorInputs:any[]){
 if(!batch?.id||!batch.pipelineVersion?.id||!batch.profile?.id||!Array.isArray(batch.cases)||batch.cases.length!==10||new Set(batch.cases.map((c:any)=>c.id)).size!==10)throw Error('阶段试验需要同一冻结版本下的十个不同案例');
 const p=batch.policy;
 if(p?.version!==DEFAULT_POLICY.version||p.score!==80||p.dimensionFloor!==DEFAULT_POLICY.dimensionFloor||p.confidenceFloor!==DEFAULT_POLICY.confidenceFloor||p.maxAttempts!==1||p.minSubmittedFps!==DEFAULT_POLICY.minSubmittedFps)throw Error('阶段试验固定80分与原硬门槛，每例只允许一次提交');
 dimensionsFor(p);
 const promptSet=new Set(priorInputs.map(normalizedPrompt).filter(Boolean)),imageSet=new Set(priorInputs.flatMap(referenceImageIds));
 const inputHashes:Record<string,string>={};
 for(const c of batch.cases){
  if(typeof c.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(c.id))throw Error('阶段案例ID无效');
  const prompt=normalizedPrompt(c),images=referenceImageIds(c);if(!prompt&&!images.length)throw Error('阶段案例输入为空');
  if(prompt&&promptSet.has(prompt)||images.some(id=>imageSet.has(id)))throw Error('阶段案例已参与历史任务或与本批其他案例重复：'+c.id);
  if(prompt)promptSet.add(prompt);images.forEach(id=>imageSet.add(id));inputHashes[c.id]=sha(identity(c));
 }
 return {version:STAGE_VERSION,sampleCount:10,minimumPassed:8,maxVisualRepairs:2,pipelineVersionId:batch.pipelineVersion.id,profileId:batch.profile.id,policySha256:sha(batch.policy),manifestSha256:sha(batch.cases),inputHashes,
  noveltyScope:'创建时对照已有输入，排除完全相同的规范化描述和重复参考图；语义是否未参与调试仍需核对固定案例清单。',certifiesStableVersion:false};
}

/** 阶段门与正式认证分离；一个case始终占一个分母，不能用新提交取代失败提交。 */
export function stageGate(batch:any,jobs:any[]){
 const stage=batch.stageValidation;if(!stage)return null;
 const errors:string[]=[];
 if(stage.version!==STAGE_VERSION||stage.sampleCount!==10||stage.minimumPassed!==8||stage.maxVisualRepairs!==2||stage.certifiesStableVersion!==false||batch.cases?.length!==10||new Set(batch.cases.map((c:any)=>c.id)).size!==10)errors.push('阶段契约或案例数量不符');
 if(stage.pipelineVersionId!==batch.pipelineVersion?.id||stage.profileId!==batch.profile?.id||stage.policySha256!==sha(batch.policy)||stage.manifestSha256!==sha(batch.cases))errors.push('冻结版本、评审配置、政策或案例清单被改变');
 try{if(batch.policy.score!==80||batch.policy.maxAttempts!==1)throw Error();dimensionsFor(batch.policy);}catch{errors.push('阶段评分政策无效');}
 const cases=(batch.cases??[]).map((c:any)=>{
  const all=jobs.filter(j=>j.batchId===batch.id&&j.caseId===c.id),original=all.filter(j=>automaticGeneration(j)&&!j.recoverySourceJobId&&!j.reuseAssessmentFrom&&(!j.retryRoot||j.retryRoot===j.id));
  const reasons:string[]=[];
  if(stage.inputHashes?.[c.id]!==sha(identity(c)))reasons.push('冻结输入不匹配');
  if(original.length>1||all.some(j=>(j.attempt??1)>1))reasons.push('存在重复提交或重试，不能计为一次提交成功');
  const j=original[0];
  if(!j)return {id:c.id,jobId:null,status:'pending',passed:false,firstPass:false,terminal:false,reasons,excluded:all.length};
  if(j.attempt!==1||sha(identity(j))!==stage.inputHashes?.[c.id]||j.pipelineVersion?.id!==stage.pipelineVersionId||j.profile?.id!==stage.profileId||j.assessmentProfile&&j.assessmentProfile.id!==stage.profileId||sha(j.policy)!==stage.policySha256)reasons.push('原始提交身份、输入、版本、政策或评审配置不符');
  if(j.iterationPolicy?.version!=='bounded-visual-v1'||j.iterationPolicy.maxVisualRepairs!==2)reasons.push('未使用首稿加最多两轮自动修正');
  let firstPass=false,passed=false;
  if(j.status==='passed'){
   const v=j.visualIterations,cycles=v?.cycles;
   if(v?.status!=='completed'||v.maxRepairs!==2||!Array.isArray(cycles)||cycles.length<1||cycles.length>3||cycles.some((x:any,i:number)=>x.index!==i||!Number.isFinite(x.score)||!Number.isFinite(x.startedAt)||!Number.isFinite(x.endedAt)||x.endedAt<x.startedAt)||!Number.isInteger(v.bestIndex)||v.bestIndex<0||v.bestIndex>=cycles.length)reasons.push('缺少完整且有耗时的有限迭代记录');
   else{
    const best=cycles[v.bestIndex],first=cycles[0];firstPass=first.status==='passed';
    if(j.selectedIteration!==v.bestIndex||best.status!=='passed'||best.score!==j.quality?.score||j.firstDraft?.index!==0||j.firstDraft.status!==first.status||j.firstDraft.score!==first.score||j.firstDraft.startedAt!==first.startedAt||j.firstDraft.endedAt!==first.endedAt)reasons.push('首稿、最佳候选与交付成绩不一致');
   }
   if(j.quality?.status!=='passed'||j.quality.score<80||j.spec?.status!=='passed'||HARD_CHECKS.some(k=>assessmentHardChecks(j,j.runtime??{})[k]!==true)||j.quality.criticalMissing?.length||j.realizationStatus&&j.realizationStatus!=='passed')reasons.push('质量、关键需求、运行或制作规范硬门槛未通过');
   if(j.quality?.policy?.version!==batch.policy.version||j.quality?.policy?.score!==80||j.quality?.policy?.dimensionFloor!==batch.policy.dimensionFloor)reasons.push('实际评分门槛与阶段政策不符');
   try{dimensionsFor(j.quality.policy);const actual=qualityGate(j.plan,j.review,assessmentHardChecks(j,j.runtime),batch.policy);if(actual.status!=='passed'||actual.score!==j.quality.score)throw Error();}catch{reasons.push('需求、分项与真实评审不能重现通过成绩');}
   passed=reasons.length===0;
  }
  return {id:c.id,jobId:j.id,status:j.status,score:Number.isFinite(j.quality?.score)?j.quality.score:null,passed,firstPass:passed&&firstPass,terminal:terminal.has(j.status),reasons,excluded:all.length-original.length};
 });
 const complete=cases.length===10&&cases.every((c:any)=>c.terminal),passed=cases.filter((c:any)=>c.passed).length,invalid=errors.length>0||cases.some((c:any)=>c.reasons.length>0);
 return {version:STAGE_VERSION,status:invalid?'invalid':!complete?'in_progress':passed>=8?'passed':'failed',sampleCount:10,submitted:cases.filter((c:any)=>c.jobId).length,passed,rate:passed/10,firstPass:cases.filter((c:any)=>c.firstPass).length,complete,cases,errors,minimumPassed:8,maxVisualRepairs:2,certifiesStableVersion:false};
}
