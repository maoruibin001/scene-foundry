import {test,expect} from 'bun:test';
import {scoreProgress,IMPROVEMENT_LIMITS} from '../improvement-governance';
import {candidateProgress} from './candidate-selection';
import {progressLimits,PROGRESS_POLICY} from './progress-policy';

// Study 3fa76208 (2026-10-23): graybox judge 2.1, 2.4, (blocked), 2.9, 3.0, 3.0 under voxel-objective-progress-v1.
const rounds=[[-24.58,2.1],[.48,2.4],[.48,2.4,true],[95.58,2.9],[95.6,3.0],[95.6,3.0,true]] as const;
const rows=rounds.map(([score,judgeScore,requiresDiagnosis],i)=>({kind:'space',comparison:'c',metric:'voxel-objective-progress-v1',round:i,score,judgeScore,requiresDiagnosis:!!requiresDiagnosis,status:'failed'}));
const streak=(limits:any)=>rows.map((r,i)=>scoreProgress(rows.slice(0,i),r,limits.minGain,0,limits.judgeGain).noGain);

test('the recorded study graybox stopped while still rising; progress-v1 keeps it going',()=>{
 const old=streak(IMPROVEMENT_LIMITS);expect(old.at(-1)).toBe(IMPROVEMENT_LIMITS.noGain);
 const limits=progressLimits(IMPROVEMENT_LIMITS),now=streak(limits);
 // 2.9→3.0 is one rubric step, below the 0.2 judge step; the two flat rounds still count, but four are allowed.
 expect(now.at(-1)).toBeLessThan(limits.noGain);
 // A judge rise of 0.2 resets the streak although the objective score moved by 0.04.
 const rise={...rows[4],score:95.62,judgeScore:3.1};
 expect(scoreProgress(rows.slice(0,4),rise,2,0,limits.judgeGain).noGain).toBe(0);
 expect(scoreProgress(rows.slice(0,4),rise,2,0).noGain).toBe(1);
});

test('a round that passed its own delivery assessment is adopted under progress-v1 only',()=>{
 // Study c1ba845b: round 1 failed at 72.78; round 3 passed profile70 at 74.13 with spatial 3.4→3.0.
 const dims=(spatial:number)=>[{id:'spatial',score:spatial},{id:'coverage',score:4},{id:'shape',score:3.5}];
 const before={deliveryStandard:'profile70',status:'failed',deliveryStatus:'failed',score:72.78,dimensions:dims(3.4),rawDimensions:dims(3.4)};
 const after={deliveryStandard:'profile70',status:'passed',deliveryStatus:'passed',score:74.13,dimensions:dims(3),rawDimensions:dims(3),hardFailures:[]};
 expect(candidateProgress(before,after).meaningful).toBe(false);
 expect(candidateProgress(before,{...after,progressPolicy:PROGRESS_POLICY}).meaningful).toBe(true);
 // A passing basis is not replaced, and a round that did not pass gains nothing from the policy.
 expect(candidateProgress({...after,progressPolicy:PROGRESS_POLICY},{...after,score:76,progressPolicy:PROGRESS_POLICY}).meaningful).toBe(false);
 expect(candidateProgress(before,{...after,status:'failed',deliveryStatus:'failed',progressPolicy:PROGRESS_POLICY}).meaningful).toBe(false);
});
