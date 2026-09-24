import {join} from 'node:path';
import {mkdirSync} from 'node:fs';
import {callValidated} from '../contracts';
import {judgeRequest} from '../judge-request';
import {assess} from '../assessment';
import {event,save,saveJob} from '../store';
export function sameAssessmentSettings(source:any,target:any){
 const a=source.assessmentProfile??source.profile,b=target.profile;
 const key=(p:any)=>JSON.stringify([p?.provider,p?.judgeModel,p?.reasoningEffort,p?.executionRoute?.configurationSha256??null,p?.specSha256,p?.policy]);
 return key(a)===key(b);
}
export function comparableAssessment(source:any,target:any){
 const a=source.assessmentProfile??source.profile,b=target.profile;
 return sameAssessmentSettings(source,target)&&(a?.assessmentProtocolSha256??null)===(b?.assessmentProtocolSha256??null);
}
export async function refinementBaseline(job:any,sourceJob:any,sourceDir:string,folder:string,signal:AbortSignal){
 if(comparableAssessment(sourceJob,job))return {review:sourceJob.review,quality:sourceJob.quality,reassessed:false};
 event(job,'refinement-baseline','评审模型、证据契约或配置已变化：先以本次配置评估原画面，保存独立基线，原成绩保持不变');
 const dir=join(folder,'baseline');mkdirSync(dir,{recursive:true});
 const fixed={...sourceJob,modelSettings:job.modelSettings,profile:job.profile,policy:job.policy};
 const response=await callValidated(judgeRequest(fixed,sourceJob.plan,sourceJob.runtime,sourceDir,signal),dir,v=>{assess(fixed,v,sourceJob.runtime);return v;});
 const result=assess(fixed,response.value,sourceJob.runtime);
 save(join(dir,'review.json'),response.value);save(join(dir,'quality.json'),result.quality);save(join(dir,'spec-report.json'),result.spec);
 const baseline={sourceJobId:sourceJob.id,sourceVersion:sourceJob.pipelineVersion,originalScore:sourceJob.quality.score,score:result.quality.score,status:result.status,profile:job.profile,frameHashes:sourceJob.runtime.hashes,modelReceipt:response.receipt};
 save(join(dir,'baseline.json'),baseline);job.refinementBaseline=baseline;saveJob(job);
 return {review:response.value,quality:result.quality,reassessed:true};
}
