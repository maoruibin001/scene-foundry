import {existsSync,mkdirSync,readFileSync,writeFileSync,cpSync,rmSync,constants} from 'node:fs';
import {join} from 'node:path';
import type {CycleResult} from './iteration-policy';
const FILES=['spatial-openings.json','generated-scene.json','recipe.json','structure.json','complexity.json','materials','project','quality.json','review.json','spec-report.json','runtime','judge-receipt.json','judge-response.txt','judge-prompt.json','judge-input-receipt.json','judge-execution.json','judge-attempts.json'];
const FIELDS=['sceneProgram','bounds','objectCount','entityCount','complexityReport','structure','runtime','quality','review','spec','countContradictions','status','visualRefinement','repairGoals'];
function folder(dir:string,index:number){if(!Number.isInteger(index)||index<0||index>2)throw Error('轮次索引无效');return join(dir,'iterations',String(index));}
const copy=(from:string,to:string)=>cpSync(from,to,{recursive:true,dereference:false,verbatimSymlinks:true,mode:constants.COPYFILE_FICLONE});
/** 每轮拥有独立的产物与评分，归档只创建一次。 */
export function snapshotIteration(dir:string,job:any,cycle:CycleResult){
 const dest=folder(dir,cycle.index);if(existsSync(join(dest,'candidate.json')))throw Error('已完成轮次不能覆盖');mkdirSync(dest,{recursive:true});
 const files=FILES.filter(f=>existsSync(join(dir,f)));for(const f of files)copy(join(dir,f),join(dest,f));
 const fields=Object.fromEntries(FIELDS.filter(k=>job[k]!==undefined).map(k=>[k,job[k]]));
 writeFileSync(join(dest,'candidate.json'),JSON.stringify({jobId:job.id,pipelineVersionId:job.pipelineVersion.id,cycle,files,fields},null,2));
}
/** 仅恢复本任务固定产物路径；总耗时、调用历史、轮次与首稿成绩不回滚。 */
export function restoreIteration(dir:string,job:any,index:number){
 const src=folder(dir,index),saved=JSON.parse(readFileSync(join(src,'candidate.json'),'utf8'));
 if(saved.jobId!==job.id||saved.pipelineVersionId!==job.pipelineVersion.id||!Array.isArray(saved.files)||saved.files.some((f:string)=>!FILES.includes(f)||!existsSync(join(src,f))))throw Error('最佳轮次来源或产物无效');
 for(const f of FILES){const p=join(dir,f);if(existsSync(p))rmSync(p,{recursive:true,force:true});if(saved.files.includes(f))copy(join(src,f),p);}
 for(const k of FIELDS){if(Object.hasOwn(saved.fields,k))job[k]=saved.fields[k];else delete job[k];}
 job.selectedIteration=index;job.previewUrl=null;return saved.cycle;
}
