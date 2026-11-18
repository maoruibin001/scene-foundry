import {expect,test} from 'bun:test';import {adaptiveResolve} from './reference';
const fog=(_x:number,_y:number,d:number)=>1-Math.exp(-.007*d);
for(const [label,shape]of [
 ['diagonal',(x:number,y:number)=>x-y<3?12:90],
 ['one-pixel rod',(x:number,y:number)=>x===11?12:90],
 ['single-pixel foreground',(x:number,y:number)=>x===11&&y===13?12:90],
 ['border tile',(x:number,y:number)=>x>=30&&y>=18?12:90],
] as const)test(label+' clips each discontinuity pixel to its own depth without vacuum or background fill',()=>{
 const w=33,h=23,depths=Float64Array.from({length:w*h},(_,n)=>shape(n%w,Math.floor(n/w))),r=adaptiveResolve(w,h,depths,fog);
 expect(r.fullPixels).toBeGreaterThan(0);expect(Math.max(...r.result.map((v,n)=>Math.abs(v-fog(n%w,Math.floor(n/w),depths[n]))))).toBeLessThan(1e-12);
});
test('constant optical transport at one depth preserves energy with fewer ray evaluations',()=>{
 const w=32,h=24,depths=new Float64Array(w*h).fill(30),shade=(x:number,y:number,d:number)=>fog(x,y,d),r=adaptiveResolve(w,h,depths,shade);
 expect(r.fullPixels).toBe(0);expect(r.integrations).toBe(w*h/64);expect(Math.max(...r.result.map((v,n)=>Math.abs(v-shade(n%w,Math.floor(n/w),30))))).toBeLessThan(1e-12);
});
test('invalid depth is rejected instead of inventing optical transport',()=>{expect(()=>adaptiveResolve(1,1,new Float64Array([NaN]),fog)).toThrow();});
