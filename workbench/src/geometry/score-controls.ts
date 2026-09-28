import {readFileSync,existsSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {DATA,read,digest,runDir} from '../store';
import {comparableAssessment} from './refinement-baseline';
import {assess} from '../assessment';
const hash=(path:string)=>digest(readFileSync(path));
const assert=(ok:any,message:string)=>{if(!ok)throw Error('评分对照：'+message)};
const refs=(j:any)=>JSON.stringify((j.images??[]).map((i:any)=>i.id));
/** 对照是原画面的一次重复观测，只登记证据位置，不覆盖生成成绩。 */
export function verifyScoreControl(record:any,locate=runDir){
 const dir=locate(record.sourceJobId),job=read(join(dir,'job.json')),folder=record.folder;
 for(const [file,sha] of Object.entries(record.files))assert(hash(join(folder,file))===sha,'对照产物变化');
 assert(hash(join(dir,'quality.json'))===record.qualitySha256,'原评分变化');
 assert(hash(join(dir,'generated-scene.json'))===record.sceneFileSha256,'原场景变化');
 const input=read(join(folder,'judge-input-receipt.json')),receipt=read(join(folder,'judge-receipt.json')),review=read(join(folder,'review.json'));
 const profile=job.assessmentProfile??job.profile;
 assert(receipt.role==='judge'&&receipt.stopReason==='completed','评审没有完成');
 assert(receipt.cliModel===profile.judgeModel&&receipt.cliReasoningEffort===profile.reasoningEffort,'模型或深度不匹配');
 assert(receipt.executionRoute?.configurationSha256===profile.executionRoute?.configurationSha256,'路由不匹配');
 const expected=[...(job.images??[]).map((i:any)=>i.id),...(job.runtime?.hashes??[])];
 assert(JSON.stringify(input.images.map((i:any)=>i.sha256))===JSON.stringify(expected),'输入画面不一致');
 for(const image of input.images)assert(hash(image.path)===image.sha256,'画面文件发生变化');
 const quality=assess(job,review,job.runtime).quality;
 const result=read(join(folder,'result.json'));
 assert(result.sourceId===job.id&&result.originalScore===job.quality.score&&result.repeatScore===quality.score,'评分重算不一致');
 return {sourceJobId:job.id,profile,referenceIds:refs(job),planSha256:digest(JSON.stringify(job.plan)),sceneDigest:digest(JSON.stringify(read(join(dir,'generated-scene.json')))),originalScore:job.quality.score,repeatScore:quality.score,observedDifference:Math.round((quality.score-job.quality.score)*10)/10,folder,receiptId:receipt.id};
}
export function registerScoreControl(sourceJobId:string,folder:string){
 const dir=runDir(sourceJobId),files=Object.fromEntries(['judge-input-receipt.json','judge-receipt.json','review.json','result.json'].map(f=>[f,hash(join(folder,f))]));
 const record={version:'score-control-v1',sourceJobId,folder,files,qualitySha256:hash(join(dir,'quality.json')),sceneFileSha256:hash(join(dir,'generated-scene.json'))};
 verifyScoreControl(record);const root=join(DATA,'score-controls');mkdirSync(root,{recursive:true});
 const path=join(root,digest(JSON.stringify(record))+'.json');if(!existsSync(path))writeFileSync(path,JSON.stringify(record,null,2)+'\n',{flag:'wx'});return path;
}
export function scoreControlEvidence(job:any,sourceDigest?:string,root=join(DATA,'score-controls'),locate=runDir){
 const controls:any[]=[],excluded:any[]=[];
 for(const name of existsSync(root)?readdirSync(root).filter(n=>n.endsWith('.json')):[]){
  try{const c=verifyScoreControl(read(join(root,name)),locate);
   if(c.referenceIds!==refs(job)||c.planSha256!==digest(JSON.stringify(job.plan))||!comparableAssessment({profile:c.profile,plan:job.plan},job)||c.profile.engineSha!==job.profile?.engineSha)continue;
   const {profile,referenceIds,planSha256,...brief}=c;controls.push({...brief,matchesSource:c.sceneDigest===sourceDigest});
  }catch(error){excluded.push({file:name,error:String(error)});}
 }
 return {version:'score-control-evidence-v1',controls,excluded,scope:'对照仅反映已观察的一次或多次评分波动，不是统计置信区间，不替换历史成绩；仅同一来源场景的对照可直接比较。'};
}
