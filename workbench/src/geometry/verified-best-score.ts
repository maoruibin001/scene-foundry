import {existsSync,readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {digest,listJobs,read,runDir} from '../store';
import {qualityGate} from '../quality';
import {comparableAssessment} from './refinement-baseline';
import {assessmentOnly} from '../assessment-kind';

const same=(a:any,b:any)=>JSON.stringify(a)===JSON.stringify(b);
const terminal=new Set(['passed','failed','needs_review','cancelled','blocked']);
/** 只比较本轮开始前完成且可重算、可核对画面的同条件记录，复评也有资格成为基线。
 * 不要求修改回执：重新录制同一场景是有效评分观测，但不是新的生成改善。 */
export function verifiedBestScore(job:any,options:{jobs?:any[];locate?:(id:string)=>string}={}){
 const locate=options.locate??runDir,cutoff=Number(job.startedAt??Date.parse(job.createdAt)),profile=job.assessmentProfile??job.profile;
 const results:any[]=[],excluded:any[]=[];
 const required=['provider','judgeModel','reasoningEffort','assessmentProtocolSha256','specSha256','engineSha','generatorSha'];
 if(!Number.isFinite(cutoff)||required.some(k=>!profile?.[k])||!profile.executionRoute?.configurationSha256)return {version:'verified-best-score-v1',best:null,verifiedCount:0,excluded:[{reason:'当前任务比较契约不完整'}]};
 for(const candidate of options.jobs??listJobs()){
  const cp=candidate.assessmentProfile??candidate.profile;
  if(candidate.id===job.id||candidate.prompt!==job.prompt||candidate.complexity!==job.complexity||!same(candidate.images?.map((i:any)=>i.id),job.images?.map((i:any)=>i.id))||!same(candidate.policy,job.policy)||!same(candidate.plan?.requirements,job.plan?.requirements)||!same(candidate.plan?.acceptanceCriteria,job.plan?.acceptanceCriteria)||required.some(k=>!cp?.[k])||cp.engineSha!==profile.engineSha||cp.generatorSha!==profile.generatorSha||!comparableAssessment(candidate,{profile,plan:job.plan}))continue;
  const root=locate(candidate.id),iterationDir=join(root,'iterations');
  const rounds:(number|null)[]=[...(terminal.has(candidate.status)?[null]:[]),...(existsSync(iterationDir)?readdirSync(iterationDir).filter(n=>/^\d+$/.test(n)&&existsSync(join(iterationDir,n,'candidate.json'))).map(Number):[])];
  for(const round of rounds){
   const dir=round===null?root:join(iterationDir,String(round));
   try{
    const snapshot=round===null?null:read(join(dir,'candidate.json')),endedAt=Number(snapshot?.cycle.endedAt??candidate.endedAt);
    if(!Number.isFinite(endedAt)||endedAt>cutoff)continue;
    const auditFile=join(dir,'repair-outcome.json');if(!assessmentOnly(candidate)&&existsSync(auditFile)&&read(auditFile).selection?.eligible===false)throw Error('关键维度退步，未获得候选替换资格');
    const quality=read(join(dir,'quality.json')),review=read(join(dir,'review.json')),runtime=read(join(dir,'runtime/runtime.json'));
    const stored=snapshot?.fields.quality??candidate.quality;
    if(!same(quality,stored)||!Number.isFinite(quality.score)||!Array.isArray(quality.hardFailures)||quality.hardFailures.length)throw Error('评分缺失、运行失败或保存记录不一致');
    if(snapshot&&(snapshot.jobId!==candidate.id||snapshot.pipelineVersionId!==candidate.pipelineVersion?.id||snapshot.cycle.index!==round))throw Error('轮次快照身份不一致');
    const recalculated=qualityGate(candidate.plan,review,{},candidate.policy);
    if(recalculated.score!==quality.score||!same(recalculated.dimensions,quality.dimensions))throw Error('原评审不能重算已保存分数');
    if(!Array.isArray(runtime.images)||!runtime.images.length||runtime.images.length!==runtime.hashes?.length)throw Error('缺少真实画面证据');
    if(runtime.images.some((f:any,i:number)=>typeof f!=='string'||!/^[-\w]+\.png$/.test(f)||digest(readFileSync(join(dir,'runtime',f)))!==runtime.hashes[i]))throw Error('实际画面摘要不一致');
    const frames=new Set(runtime.images);
    if([...review.requirements,...review.dimensions,...(review.criteria??[])].some((r:any)=>r.frames.some((f:string)=>!frames.has(f))))throw Error('原评审引用了不存在的画面');
    // 轮次快照允许复用同一任务保存的调用回执，但必须与冻结评审配置一致。
    const receipt=read(join(existsSync(join(dir,'judge-receipt.json'))?dir:root,'judge-receipt.json'));
    if(receipt.stopReason!=='completed'||receipt.cliModel!==cp.judgeModel||receipt.cliReasoningEffort!==cp.reasoningEffort||receipt.executionRoute?.configurationSha256!==cp.executionRoute?.configurationSha256)throw Error('评审调用与模型路由不一致');
    results.push({jobId:candidate.id,iteration:round,score:quality.score,endedAt,pipelineVersion:candidate.pipelineVersion,qualitySha256:digest(readFileSync(join(dir,'quality.json'))),frameHashes:runtime.hashes,sceneDigest:digest(JSON.stringify(read(join(dir,'generated-scene.json')))),validationKind:candidate.validationKind??'generation'});
   }catch(error){excluded.push({jobId:candidate.id,iteration:round,reason:String(error)});}
  }
 }
 results.sort((a,b)=>b.score-a.score||a.endedAt-b.endedAt);
 return {version:'verified-best-score-v1',best:results[0]??null,verifiedCount:results.length,excluded,scope:'同输入、需求、评分模型与契约及引擎版本；本轮开始前的真实画面与评分重算已核验。历史最佳是已观测成绩，不是统计显著性或自动首次生成证明。'};
}
