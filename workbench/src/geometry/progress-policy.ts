/**
 * progress-v1, per job like the other repair policies, so recorded runs replay unchanged.
 *
 * Plateau: the improvement ledger stopped a strategy after two rounds without a 2-point gain. Under the objective graybox score
 * (voxel-objective-progress-v1: 25 per failed layout check, 5 per blocker, judge score / 5) a judge rise from 2.9 to 3.0 is +0.02, so
 * study 3fa76208 (2026-10-23; 2.1, 2.4, 2.9, 3.0, 3.0) stopped while still rising, and village e19f3b70 (2.7, 2.8, 2.8, 2.8) after two
 * flat rounds. The policy allows four rounds without gain and counts a judge rise of at least 0.2 (one rubric step is 0.1) as gain.
 *
 * Delivery: the final repair loop kept the best round only when it was a "meaningful" step over the previous best, and a round whose
 * delivery assessment passed could still be discarded for a protected-dimension drop. Study c1ba845b round 3 passed basic70 at 74.13
 * yet round 1 (72.78, failed) was delivered. Under the policy a round that passes its own delivery assessment is always adopted.
 */
export const PROGRESS_POLICY='progress-v1';
export const PROGRESS_LIMITS={noGain:4,judgeGain:.2};
export function progressRule(job:any){return job?.progressPolicy===PROGRESS_POLICY;}
/** Ledger limits for a new experiment under the policy; other limits are unchanged. */
export function progressLimits(limits:any){return {...limits,noGain:Math.max(limits.noGain,PROGRESS_LIMITS.noGain),judgeGain:PROGRESS_LIMITS.judgeGain};}
/** A round that passed its own delivery assessment is a delivery, whatever the previous best scored. */
export function passedDelivery(after:any){return after?.status==='passed'&&after.deliveryStatus==='passed'&&!after.hardFailures?.length;}
