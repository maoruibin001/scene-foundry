import {test,expect} from 'bun:test';
import {solveIR,validateIR} from './scene-ir';
import {supportTop} from './spatial';
const entity=(id:string,kind:string,position:number[],size:number[],required=false)=>({id,label:id,kind,role:kind==='ground'?'ground':required?'subject':'context',position,size,color:'#668855',accent:'#889955',rotation:0,requirementIds:required?['r1']:[]});
test('two props on one support retain distinct offsets and rest on the actual platform deck',()=>{
 const ir={name:'supported props',entities:[entity('ground','ground',[0,0,-1],[24,24,1]),entity('deck','platform',[5,0,0],[6,6,3],true),entity('a','crate',[3.8,0,5],[1,1,1]),entity('b','crate',[6.2,0,5],[1,1,1])],relations:[{type:'on',subjects:['a','b'],target:'deck'}]};
 const result=solveIR(ir);expect(result.structure.passed).toBe(true);expect(result.ir.entities[2].position).toEqual([3.8,0,1.26]);expect(result.ir.entities[3].position).toEqual([6.2,0,1.26]);expect(supportTop(ir.entities[1])).toBe(1.26);expect(solveIR(result.ir).ir).toEqual(result.ir);
});
test('small optional overhang is corrected without enlarging the floor or moving requested subjects',()=>{
 const ir={name:'edge',entities:[entity('ground','ground',[0,0,-1],[24,24,1]),entity('subject','lighthouse',[0,0,0],[3,3,8],true),entity('tree','tree',[11.1,0,0],[2.6,2.6,4])],relations:[]};
 const result=solveIR(ir);expect(result.structure.passed).toBe(true);expect(result.ir.entities[0]).toEqual(ir.entities[0]);expect(result.ir.entities[1]).toEqual(ir.entities[1]);expect(result.ir.entities[2].position[0]).toBeLessThan(11.1);expect(solveIR(result.ir).ir).toEqual(result.ir);
 const required=structuredClone(ir);required.entities[2].requirementIds=['r1'];expect(solveIR(required).structure.passed).toBe(false);
});
import complex from './fixtures/p0-complex-offsets.json';
import sharedSupport from './fixtures/p0-shared-support.json';
test('real failed complex output resolves without an AI patch or dropping any entities',()=>{
 const s=solveIR(complex);expect(s.structure.passed).toBe(true);expect(s.ir.entities.length).toBe(complex.entities.length);const again=solveIR(s.ir);for(let i=0;i<s.ir.entities.length;i++)for(let axis=0;axis<3;axis++)expect(again.ir.entities[i].position[axis]).toBeCloseTo(s.ir.entities[i].position[axis],9);
});
test('around and left/right relationships on a shared support move children without moving their common anchor',()=>{
 const s=solveIR(sharedSupport);expect(s.structure.passed).toBe(false);expect(s.structure.checks.filter((c:any)=>['around','leftOf','rightOf'].includes(c.type)).every((c:any)=>c.passed)).toBe(true);
 expect(s.ir.entities.find((e:any)=>e.id==='platform_01').position.slice(0,2)).toEqual([0,0]);expect(s.ir.entities.find((e:any)=>e.id==='tree_planter_01').position.slice(0,2)).toEqual([0,0]);const again=solveIR(s.ir);for(let i=0;i<s.ir.entities.length;i++)for(let axis=0;axis<3;axis++)expect(again.ir.entities[i].position[axis]).toBeCloseTo(s.ir.entities[i].position[axis],9);
});
