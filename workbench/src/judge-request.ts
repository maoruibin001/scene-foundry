import {join} from 'node:path';
import {readFileSync} from 'node:fs';
import {UPLOADS,read,digest} from './store';
import {verifiedRuntimeEvidence} from './runtime-evidence';
import {scoringGuidance} from './quality';
import {JUDGE_PROMPT} from './prompts';
import {SPEC,VISUAL_RULE_IDS} from './spec';
/** 正常验收与修正前基线采用同一请求；基线写入新任务，绝不改写源任务。 */
export function judgeRequest(job:any,plan:any,runtime:any,dir:string,signal:AbortSignal){
 const imgs=(job.images??(job.image?[job.image]:[])).map((i:any)=>({path:join(UPLOADS,i.file),mime:i.mime}));
 const hard={build:true,catalog:true,...runtime.hard,frameRate:runtime.hard.frameRate&&runtime.submittedFps>=job.policy.minSubmittedFps};
 if(Object.values(hard).some(x=>x!==true))throw Error('运行硬门槛未通过：'+JSON.stringify(hard));
 const evidence=verifiedRuntimeEvidence(read(join(dir,'project/evidence/run-report.json')),runtime,job.profile,digest(readFileSync(join(dir,'project/game/dist/forgeax-dist.json'))),job.policy.minSubmittedFps);
 const frames=runtime.images;
 for(const [i,f] of frames.entries())if(digest(readFileSync(join(dir,'runtime',f)))!==runtime.hashes[i])throw Error('运行画面摘要不符：'+f);
 for(const [i,img] of imgs.entries())if(digest(readFileSync(img.path))!==(job.images??[job.image])[i].id)throw Error('参考图片内容与冻结输入不符');
 return {modelSettings:job.modelSettings,role:'judge',signal,maxTokens:9500,images:[...imgs,...frames.map((f:string)=>({path:join(dir,'runtime',f),mime:'image/png'}))],system:JUDGE_PROMPT,text:JSON.stringify({originalPrompt:job.prompt,scoring:scoringGuidance(job.policy),verifiedRuntimeEvidence:evidence,selectedComplexity:job.generationBrief,complexityMeasurement:job.complexityReport,referenceImages:imgs.length,frozenPlan:plan,frameNames:frames,visualRules:SPEC.rules.filter(r=>VISUAL_RULE_IDS.includes(r.id)),sourceSpecification:SPEC.text,countKinds:Object.keys(job.structure.semanticCounts).filter(k=>job.structure.semanticCounts[k]>0),measuredCamera:runtime.cameraEvidence,subjectMeasurement:runtime.subjectMeasurement,geometry:job.structure.geometry,composition:runtime.composition})};
}
