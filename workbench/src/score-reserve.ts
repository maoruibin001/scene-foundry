/** The only active scheduler protects two assessment requests per unfinished new scene.
 * In-flight permits are conservative until their actual provider ledger entries settle.
 * This is a score reserve, not a claim to reserve the entire generation budget.
 */
import {standardJob,STANDARD_MATCHING} from './matching-level';
export function scoreReserve(jobs:any[],currentId?:string,role?:string){
 return jobs.filter(j=>standardJob(j)&&['queued','running'].includes(j.status)&&!j.quality&&!(j.id===currentId&&role==='judge')).length*STANDARD_MATCHING.assessmentCalls;
}
export function canSpendForScene(remaining:number,required:number,jobs:any[],currentId?:string,role?:string,inFlight=0){
 return remaining>=required+scoreReserve(jobs,currentId,role)+inFlight;
}
