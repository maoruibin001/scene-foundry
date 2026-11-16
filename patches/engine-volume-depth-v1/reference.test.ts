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

test('dense fallback jobs preserve every optical result across odd extents, thin objects and a subsequent zero-job frame',()=>{
 for(const [w,h]of [[33,23],[1,1],[16,16]]){
  const depths=Float64Array.from({length:w*h},(_,i)=>(i%w===11||i===0)?12:90),optics=(x:number,y:number,d:number)=>fog(x,y,d)+x*.0001+y*.0002;
  const inline=adaptiveResolve(w,h,depths,optics),dense=adaptiveResolve(w,h,depths,optics,true);
  expect([...dense.result]).toEqual([...inline.result]);expect(new Set(dense.jobs).size).toBe(dense.fullPixels);expect(dense.jobs.every(n=>n>=0&&n<w*h)).toBe(true);
  const next=adaptiveResolve(w,h,new Float64Array(w*h).fill(20),fog,true);expect(next.jobs).toHaveLength(0);expect(next.fullPixels).toBe(0);
 }
});
