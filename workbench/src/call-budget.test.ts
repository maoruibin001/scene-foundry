import {test,expect} from 'bun:test';
import {parseCallLimit,callAllowance,budgetSnapshot,requiredCalls,acceptanceBudget} from './call-budget';
test('统一验收使用实际启动器账本，关闭或耗尽不被旧的不限额配置覆盖',()=>{
 expect(acceptanceBudget({enabled:true,maxCalls:60,attempts:[{},{}]})).toMatchObject({used:2,max:60,remaining:58,unlimited:false,limitKind:'unified-acceptance'});
 expect(acceptanceBudget({enabled:false,maxCalls:60,attempts:[]}).remaining).toBe(0);
 expect(acceptanceBudget({enabled:true,maxCalls:2,attempts:[{},{},{}]}).remaining).toBe(0);
 for(const value of [{enabled:true,maxCalls:0,attempts:[]},{enabled:true,maxCalls:Infinity,attempts:[]},{enabled:true,maxCalls:2},{}])expect(()=>acceptanceBudget(value)).toThrow();
});
test('debug unlimited preserves accounting and serializes explicitly',()=>{
 const limit=parseCallLimit('unlimited');expect(limit).toBeNull();expect(callAllowance(limit,30000,100)).toBe(true);
 expect(JSON.parse(JSON.stringify(budgetSnapshot(limit,30)))).toEqual({used:30,max:null,remaining:null,unlimited:true,limitKind:'debug-unlimited'});
});
test('finite and malformed budgets never become unlimited by accident',()=>{
 expect(parseCallLimit(undefined)).toBe(10);expect(parseCallLimit('50')).toBe(50);expect(callAllowance(50,48,3)).toBe(false);expect(callAllowance(50,48,2)).toBe(true);
 for(const raw of ['NaN','Infinity','-1','0','1.5',''])expect(()=>parseCallLimit(raw)).toThrow();
 expect(budgetSnapshot(30,31).remaining).toBe(0);
});

test('执行与自动重试均须为后续评审保留调用',()=>{
 expect(callAllowance(20,18,requiredCalls(1))).toBe(true);
 expect(callAllowance(20,19,requiredCalls(1))).toBe(false);
 expect(callAllowance(20,19,requiredCalls())).toBe(true);
 for(const v of [-1,1.5,NaN,Infinity])expect(()=>requiredCalls(v)).toThrow();
});
