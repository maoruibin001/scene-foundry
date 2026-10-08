import {firstPassCallEstimate} from './matching-level';

// A conservative admission envelope, not permission to increase the task's budget.
export const FRESH_SCENE_CALLS=firstPassCallEstimate(16).plannedCalls+8;
export function freshSceneReservation(input:any,options:any){
 if(input.matchingLevel!=='standard'||['reuseSceneFrom','reuseCheckpoint','reuseAssessmentFrom','reuseFrom','reusePlanFrom','recoverySourceJobId'].some(k=>options[k]))return null;
 return {version:'scene-call-reserve-v1',calls:FRESH_SCENE_CALLS,plannedCalls:firstPassCallEstimate(16).plannedCalls,recoveryAllowance:8};
}
/** Per-call protection is shared across scenes, and follows the same execution root. */
export function otherSceneCallReserve(jobs:any[],currentId:string|undefined,spent:(job:any)=>number){
 const current=jobs.find(j=>j.id===currentId),root=current?.executionRecoveryRoot??currentId,seen=new Set<string>();let total=0;
 for(const j of jobs){
  if(!['queued','running'].includes(j.status)||j.id===currentId)continue;
  const key=j.executionRecoveryRoot??j.id;if(key===root||seen.has(key))continue;seen.add(key);
  if(j.modelCallReservation?.version!=='scene-call-reserve-v1')continue;
  const remaining=Math.max(j.quality?0:2,j.modelCallReservation.calls-Math.max(0,spent(j)));
  // scoreReserve already protects the first two calls for this scene.
  total+=Math.max(0,remaining-(j.quality?0:2));
 }
 return total;
}
