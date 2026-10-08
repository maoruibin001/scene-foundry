import {test,expect} from 'bun:test';
import {FRESH_SCENE_CALLS,freshSceneReservation,otherSceneCallReserve} from './scene-call-reserve';
import {matchingPolicy} from './matching-level';
import {scoreReserve} from './score-reserve';
const make=(id:string)=>({id,executionRecoveryRoot:id,status:'running',matchingPolicy:matchingPolicy('standard'),modelCallReservation:freshSceneReservation({matchingLevel:'standard'},{})});
test('new scenes reserve generation plus score and finite recovery headroom; continuations do not allocate again',()=>{
 expect(FRESH_SCENE_CALLS).toBe(35);expect(freshSceneReservation({matchingLevel:'standard'},{})).toMatchObject({plannedCalls:27,recoveryAllowance:8});
 for(const key of ['reuseCheckpoint','recoverySourceJobId','reuseAssessmentFrom','reuseSceneFrom','reusePlanFrom'])expect(freshSceneReservation({matchingLevel:'standard'},{[key]:'prior'})).toBeNull();
 expect(freshSceneReservation({matchingLevel:'detailed'},{})).toBeNull();
});
test('two admissions need 70 calls, each consumes only its own reserve, completed jobs release remaining headroom',()=>{
 const a=make('a'),b=make('b');const jobs=[a];
 expect(FRESH_SCENE_CALLS+scoreReserve(jobs)+otherSceneCallReserve(jobs,undefined,()=>0)).toBe(70);
 jobs.push(b);const reserved=scoreReserve(jobs,'a','geometry-asset')+otherSceneCallReserve(jobs,'a',()=>12);expect(reserved).toBe(25);
 expect(scoreReserve(jobs,'a','judge')+otherSceneCallReserve(jobs,'a',()=>12)).toBe(23);
 b.status='failed';expect(otherSceneCallReserve(jobs,'a',()=>0)).toBe(0);
});
test('historical jobs retain score reserve only; duplicate continuation roots are not double charged',()=>{
 const a=make('a'),b=make('b'),copy={...b,id:'continuation'};
 expect(otherSceneCallReserve([a,b,copy],'a',()=>12)).toBe(21);
 expect(otherSceneCallReserve([a,b,copy],'continuation',()=>12)).toBe(21);
 expect(otherSceneCallReserve([{...b,modelCallReservation:null}],'a',()=>0)).toBe(0);
});
