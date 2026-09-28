import {test,expect} from 'bun:test';import {repairReflection} from './repair-reflection';
const quality={score:54,dimensions:[{id:'spatial',score:3,weight:32,points:19.2},{id:'material',score:2,weight:20,points:8}]};
const attempt=(jobId:string,extra:any={})=>({jobId,relation:'ancestor-result',scoreComparison:{comparableWithinAttempt:true,comparableToCurrentAssessment:true},selectedGoals:[{dimension:'material'}],dimensionsBefore:{material:2},dimensionsAfter:{material:2.1},actualChanges:{reason:'调参数'},...extra});
test('只有同契约连贯失败触发反思，保留原评分与最大差距',()=>{
 const q=JSON.stringify(quality),h={attempts:[attempt('new'),attempt('old')]},r=repairReflection(quality,h);
 expect(r.dimensions[0].id).toBe('spatial');expect(r.dimensions.find(d=>d.id==='material')?.stalled).toBe(true);expect(JSON.stringify(quality)).toBe(q);
 const other=repairReflection(quality,{attempts:[attempt('one'),attempt('other',{relation:'ancestor-alternative'}),attempt('contract',{scoreComparison:{comparableWithinAttempt:true,comparableToCurrentAssessment:false}})]});expect(other.verifiedAttempts).toBe(1);expect(other.dimensions.some(d=>d.stalled)).toBe(false);
});
