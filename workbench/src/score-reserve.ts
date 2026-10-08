/** The only active scheduler protects two assessment requests per unfinished new scene.
 * In-flight permits are conservative until their actual provider ledger entries settle.
 * This is a score reserve, not a claim to reserve the entire generation budget.
 */
import {standardJob,STANDARD_MATCHING} from './matching-level';
export function assessmentCallsRemaining(job:any,role?:string){
 if(!standardJob(job)||!['queued','running'].includes(job.status)||job.quality||role==='judge')return 0;
 // 合并诊断修复明确需要：一轮空间检查、一次完整评分。正在发出的评审由请求本身计数。
 if(job.refineScene&&job.refinementMode==='evidence-led')return role==='scene-space-judge'||job.stages?.graybox?.status==='passed'?1:2;
 return STANDARD_MATCHING.assessmentCalls;
}
export function scoreReserve(jobs:any[],currentId?:string,role?:string){
 return jobs.reduce((total,j)=>total+assessmentCallsRemaining(j,j.id===currentId?role:undefined),0);
}
/** 显式预留和当前任务的阶段预留保护同一组后续调用，取并集，其他任务的预留保持独立。 */
export function requestCallsExcludingSharedReserve(job:any,role:string,explicitReserved=0){
 if(!Number.isSafeInteger(explicitReserved)||explicitReserved<0)throw Error('保留调用数必须为非负整数');
 return 1+Math.max(0,explicitReserved-assessmentCallsRemaining(job,role));
}
export function canSpendForScene(remaining:number,required:number,jobs:any[],currentId?:string,role?:string,inFlight=0){
 return remaining>=required+scoreReserve(jobs,currentId,role)+inFlight;
}
