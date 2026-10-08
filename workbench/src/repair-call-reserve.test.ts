import {test,expect} from 'bun:test';
import {scoreReserve,requestCallsExcludingSharedReserve} from './score-reserve';
const repair:any={id:'repair',status:'running',matchingLevel:'standard',matchingPolicy:{version:'standard-quality-v3'},refineScene:true,refinementMode:'evidence-led',stages:{}};
const need=(job:any,role:string,reserved=0,others:any[]=[])=>requestCallsExcludingSharedReserve(job,role,reserved)+scoreReserve([job,...others],job.id,role);
test('three real calls reserve refinement, spatial review and final score once, with no increase in allowance',()=>{
 expect(need(repair,'scene-refine',2)).toBe(3);
 expect(need(repair,'scene-space-judge')).toBe(2);
 expect(need({...repair,stages:{graybox:{status:'passed'}}},'judge')).toBe(1);
 // 失败重试仍是一笔真实调用，余额不足时不能吃掉后续两个评审。
 expect(need(repair,'scene-refine',2)>2).toBe(true);
});
test('another scene and larger explicit reserves remain protected',()=>{
 expect(need(repair,'scene-refine',2,[{...repair,id:'other'}])).toBe(5);
 expect(need(repair,'scene-refine',4)).toBe(5);
 const fresh={...repair,refineScene:false};expect(need(fresh,'scene-space-judge')).toBe(3);
 expect(()=>requestCallsExcludingSharedReserve(repair,'scene-refine',-1)).toThrow();
});
