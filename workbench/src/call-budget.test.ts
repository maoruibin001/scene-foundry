import {test,expect} from 'bun:test';
import {parseCallLimit,callAllowance,budgetSnapshot} from './call-budget';
test('debug unlimited preserves accounting and serializes explicitly',()=>{
 const limit=parseCallLimit('unlimited');expect(limit).toBeNull();expect(callAllowance(limit,30000,100)).toBe(true);
 expect(JSON.parse(JSON.stringify(budgetSnapshot(limit,30)))).toEqual({used:30,max:null,remaining:null,unlimited:true,limitKind:'debug-unlimited'});
});
test('finite and malformed budgets never become unlimited by accident',()=>{
 expect(parseCallLimit(undefined)).toBe(10);expect(parseCallLimit('50')).toBe(50);expect(callAllowance(50,48,3)).toBe(false);expect(callAllowance(50,48,2)).toBe(true);
 for(const raw of ['NaN','Infinity','-1','0','1.5',''])expect(()=>parseCallLimit(raw)).toThrow();
 expect(budgetSnapshot(30,31).remaining).toBe(0);
});
