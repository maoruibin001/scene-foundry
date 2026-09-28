import {roleSettings} from './generation-policy';
import {standardJob} from './matching-level';
import {ATOMIC_QUALITY_VERSION,ATOMIC_JUDGE_PROMPT,validateCriteria} from './atomic-criteria';
import {join} from 'node:path';
import {readFileSync} from 'node:fs';
import {UPLOADS,read,digest} from './store';
import {verifiedRuntimeEvidence} from './runtime-evidence';
import {scoringGuidance} from './quality';
import {JUDGE_PROMPT} from './prompts';
import {SPEC,VISUAL_RULE_IDS} from './spec';
/** 正常验收与修正前基线采用同一请求；基线写入新任务，绝不改写源任务。 */
export function judgeRequest(job:any,plan:any,runtime:any,dir:string,signal:AbortSignal){
 if(job.policy.version===ATOMIC_QUALITY_VERSION)validateCriteria(plan);
 const imgs=(job.images??(job.image?[job.image]:[])).map((i:any)=>({path:join(UPLOADS,i.file),mime:i.mime}));
 const hard={build:true,catalog:true,...runtime.hard,frameRate:runtime.hard.frameRate&&runtime.submittedFps>=job.policy.minSubmittedFps};
 // Failed composition/media gates are findings to repair, not a reason to hide or skip real evidence.
 if(['runtime','entitiesLoaded','noErrors'].some(k=>hard[k]!==true))throw Error('缺少可安全评估的运行证据：'+JSON.stringify(hard));
 const evidence=verifiedRuntimeEvidence(read(join(dir,'project/evidence/run-report.json')),runtime,job.profile,digest(readFileSync(join(dir,'project/game/dist/forgeax-dist.json'))),job.policy.minSubmittedFps);
 const frames=runtime.images;
 for(const [i,f] of frames.entries())if(digest(readFileSync(join(dir,'runtime',f)))!==runtime.hashes[i])throw Error('运行画面摘要不符：'+f);
 for(const [i,img] of imgs.entries())if(digest(readFileSync(img.path))!==(job.images??[job.image])[i].id)throw Error('参考图片内容与冻结输入不符');
 return {modelSettings:roleSettings(job.modelSettings,'judge',job.optimizationPolicy),role:'judge',schemaContext:{qualityVersion:job.policy.version},signal,maxTokens:9500,images:[...imgs,...frames.map((f:string)=>({path:join(dir,'runtime',f),mime:'image/png'}))],system:JUDGE_PROMPT+(job.policy.version===ATOMIC_QUALITY_VERSION?'\n'+ATOMIC_JUDGE_PROMPT:'')+(standardJob(job)?'\n按给定条目、维度和门槛直接评估。每条理由尽量在60个汉字内，说明可见证据与最重要偏差，不重复复述输入；完整保留全部要求的结构化字段。':''),text:JSON.stringify({originalPrompt:job.prompt,runtimeHardChecks:hard,runtimeFailures:Object.entries(hard).filter(([,v])=>v!==true).map(([k])=>k),scoring:scoringGuidance(job.policy),verifiedRuntimeEvidence:evidence,selectedComplexity:job.generationBrief,complexityMeasurement:job.complexityReport,referenceImages:imgs.length,frozenPlan:plan,frameNames:frames,visualRules:SPEC.rules.filter(r=>VISUAL_RULE_IDS.includes(r.id)),sourceSpecification:standardJob(job)?undefined:SPEC.text,countKinds:Object.keys(job.structure.semanticCounts).filter(k=>job.structure.semanticCounts[k]>0),measuredCamera:runtime.cameraEvidence,subjectMeasurement:runtime.subjectMeasurement,geometry:job.structure.geometry,composition:runtime.composition})};
}
