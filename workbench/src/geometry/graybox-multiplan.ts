// graybox-multiplan-v1: reduce graybox-stage variance by generating several INDEPENDENT initial space
// plans and keeping the first that passes the graybox gate. Each attempt is a normal, fully isolated job
// (its own run dir and its own improvement thread via an improvement salt), so there are no folder or
// governance collisions — unlike looping inside generateLayout. Effective by construction: if a single
// plan passes with probability p, K attempts pass with 1-(1-p)^K (p=0.5, K=3 -> ~0.87).
export const GRAYBOX_MULTIPLAN='graybox-multiplan-v1';
export const GRAYBOX_MULTIPLAN_K=3;
/** New ordinary (non-voxel) fresh-generation jobs carry the policy; voxel/historical/reuse jobs do not. */
export function multiPlanRule(job:any){return job?.multiPlanPolicy===GRAYBOX_MULTIPLAN;}
/** The improvement-thread salt that keeps each attempt an independent governance thread. */
export function multiPlanSalt(mp:any){return mp?mp.group+':'+mp.attempt:null;}
/** Spawn the NEXT initial-plan attempt only when THIS attempt stalled at the graybox gate — i.e. the
 *  spatial gate stopped on no-gain (blockout stopped, never passed) and the job failed. Not for a pass,
 *  not for a provider block / cancellation / downstream (asset/judge) failure, and not past the cap. */
export function shouldSpawnNextPlan(job:any){
 return !!job?.multiPlan && job.multiPlan.attempt<job.multiPlan.k
  && job.status==='failed' && job.blockout?.status==='stopped' && job.blockout?.space===undefined;
}
export function nextPlanAttempt(mp:any){return {group:mp.group,attempt:mp.attempt+1,k:mp.k};}
