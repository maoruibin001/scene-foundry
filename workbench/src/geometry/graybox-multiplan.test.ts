import {test,expect} from 'bun:test';
import {multiPlanRule,multiPlanSalt,shouldSpawnNextPlan,nextPlanAttempt,GRAYBOX_MULTIPLAN,GRAYBOX_MULTIPLAN_K} from './graybox-multiplan';

const mp=(attempt:number,k=3)=>({group:'g1',attempt,k});

test('策略开关',()=>{
 expect(multiPlanRule({multiPlanPolicy:GRAYBOX_MULTIPLAN})).toBe(true);
 expect(multiPlanRule({})).toBe(false);
 expect(multiPlanRule(null)).toBe(false);
});

test('每个尝试一个独立改进线程盐',()=>{
 expect(multiPlanSalt(mp(1))).toBe('g1:1');
 expect(multiPlanSalt(mp(2))).toBe('g1:2');
 expect(multiPlanSalt(null)).toBe(null);
 expect(nextPlanAttempt(mp(1))).toEqual({group:'g1',attempt:2,k:3});
});

test('只在灰模门槛卡住（stopped 且未通过）且未到上限时才续下一规划',()=>{
 // graybox stall: failed + blockout stopped + no accepted space -> spawn
 expect(shouldSpawnNextPlan({multiPlan:mp(1),status:'failed',blockout:{status:'stopped'}})).toBe(true);
 // reached cap -> no
 expect(shouldSpawnNextPlan({multiPlan:mp(3,3),status:'failed',blockout:{status:'stopped'}})).toBe(false);
 // graybox PASSED (has accepted space), failure is downstream -> no retry of the plan
 expect(shouldSpawnNextPlan({multiPlan:mp(1),status:'failed',blockout:{status:'passed',space:{}}})).toBe(false);
 // provider block (model down) -> no
 expect(shouldSpawnNextPlan({multiPlan:mp(1),status:'blocked',blockout:{status:'stopped'}})).toBe(false);
 // cancelled -> no
 expect(shouldSpawnNextPlan({multiPlan:mp(1),status:'cancelled',blockout:{status:'stopped'}})).toBe(false);
 // passed job -> no
 expect(shouldSpawnNextPlan({multiPlan:mp(1),status:'passed',blockout:{status:'passed',space:{}}})).toBe(false);
 // not a multiplan job -> no
 expect(shouldSpawnNextPlan({status:'failed',blockout:{status:'stopped'}})).toBe(false);
 expect(GRAYBOX_MULTIPLAN_K).toBe(3);
});
