import {test,expect} from 'bun:test';
import {validationLimitReached,validationBoundaryHint,validationRoundText} from '../public/validation-boundary.js';
test('explicit unlimited null quota keeps new-input UI open and preserves truthful counts',()=>{
 const boundary={unlimited:true,maxRounds:null,remainingRounds:null,usedRounds:4,generationMode:'qualified'};
 expect(validationLimitReached(boundary)).toBe(false);
 expect(validationBoundaryHint(boundary)).toContain('累计已登记 4 轮');
 expect(validationBoundaryHint(boundary)).toContain('连续无改善停止');
 expect(validationBoundaryHint(boundary)).not.toContain('null');
 expect(validationRoundText({unlimited:true,index:4,maxRounds:null})).toContain('不设总次数上限');
});
test('finite and historical bounds retain their original limit meaning',()=>{
 expect(validationLimitReached({maxRounds:3,remainingRounds:0})).toBe(true);
 expect(validationLimitReached({maxRounds:3,remainingRounds:1})).toBe(false);
 expect(validationLimitReached(null)).toBe(false);
 expect(validationBoundaryHint({maxRounds:3,remainingRounds:0,usedRounds:3,generationMode:'bounded'})).toContain('剩余 0 轮');
 expect(validationRoundText({index:3,maxRounds:3})).toContain('第 3 / 3 轮');
});
