import {test,expect} from 'bun:test';
import {compileGeometryProgram,shapeTriangles,validateGeometryProgram,type GeometryProgram,type PrimitiveShape} from './program';
import {repairGeometryBudget} from './repair-budget';
const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]} as const;
function program(shape:any,copies=1):GeometryProgram{return {version:'geometry-v1',name:'网格实际配额',materials:[{id:'surface',color:[.4,.3,.2,1],roughness:.6,metallic:0,textureId:null}],templates:[{id:'shape',parts:[{...structuredClone(pose),id:'part',material:'surface',shape}]}],instances:Array.from({length:copies},(_,n)=>({...structuredClone(pose),id:'copy'+n,label:'实际几何',template:'shape',requirementIds:[]}))} as GeometryProgram;}
function strip(columns:number,doubleSided=false){return {type:'grid',rows:2,columns,doubleSided,points:[...Array.from({length:columns},(_,n)=>[n===columns-1?1:0,0,0]),...Array.from({length:columns},(_,n)=>[n===columns-1?1:0,1,0])]} as PrimitiveShape;}
test('退化连接不占三角形预算，原 UV、非退化面和硬上限仍保留',()=>{
 const s=strip(512),p=program(s,128),r=compileGeometryProgram(p);
 expect(validateGeometryProgram(p)).toEqual({triangles:256,parts:128});expect(r.triangles).toBe(256);
 expect(r.meshes[0].geometry.uvs).toContain(510/511);
 // 相同点数的真实曲面超过上限仍被拒绝，不因修正估算放宽 250000。
 const dense={...s,points:[...Array.from({length:512},(_,n)=>[n/511,0,0]),...Array.from({length:512},(_,n)=>[n/511,1,0])]};
 expect(()=>validateGeometryProgram(program(dense,245))).toThrow('250390/250000');
});
test('正反面使用各自真实三角化，不能把非平面前面的面积计数直接翻倍',()=>{
 const s:PrimitiveShape={type:'grid',rows:2,columns:2,doubleSided:true,points:[[0,0,0],[1,0,0],[0,1,1],[2,0,0]]};
 expect(shapeTriangles(s)).toBe(3);expect(compileGeometryProgram(program(s)).triangles).toBe(3);
});
test('面积阈值与实际编译一致，极小有效面没有被任意忽略',()=>{
 for(const height of [1.1e-11,1e-10,.001]){
  const s:PrimitiveShape={type:'grid',rows:2,columns:2,doubleSided:false,points:[[0,0,0],[1,0,0],[0,height,0],[1,height,0]]};
  expect(shapeTriangles(s)).toBe(compileGeometryProgram(program(s)).triangles);expect(shapeTriangles(s)).toBe(2);
 }
 expect(()=>shapeTriangles({...strip(2),points:[[0,0,0],[1,0,0],[0,0,0],[1,0,0]]} as PrimitiveShape)).toThrow('没有可渲染');
});
test('散布与实例倍数照常累计，不把稀疏网格当一次',()=>{
 const shape={type:'scatter',element:strip(4,true),count:20,seed:9,volume:'box',size:[3,3,3],rotationRange:[0,0,0],scaleRange:[1,1]};
 const p=program(shape,5);expect(validateGeometryProgram(p).triangles).toBe(400);expect(compileGeometryProgram(p).triangles).toBe(400);
});
test('两种修正入口的资源上下文同时给出实例展开、剩余部件、材质和三角形',()=>{
 const p=program(strip(4,true),3),b=repairGeometryBudget(p,'complex');
 expect(b).toMatchObject({currentEstimatedTriangles:12,maxEstimatedTriangles:250000,remainingEstimatedTriangles:249988,currentExpandedParts:3,maxExpandedParts:512,remainingExpandedParts:509,currentMaterials:1,maxMaterials:128,remainingMaterials:127});
 expect(b.largestGeometryConsumers[0]).toEqual({templateId:'shape',instances:3,expandedParts:3,estimatedTriangles:12});
 expect(repairGeometryBudget(p,'simple')).toMatchObject({maxExpandedParts:192,maxMaterials:32});
});
