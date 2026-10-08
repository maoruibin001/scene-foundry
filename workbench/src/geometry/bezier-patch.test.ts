import {test,expect} from 'bun:test';
import {samplePatch,type BezierPatch} from './bezier-patch';
import {compileGeometryProgram,shapeTriangles,validateGeometryProgram} from './program';
import {geometryProgramSchema} from './program-schema';
import {cross,sub,type V} from './mesh';

const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};
const shape=():BezierPatch=>({type:'bezierPatch',controlPoints:Array.from({length:16},(_,i)=>{const u=i%4/3,v=Math.floor(i/4)/3;return [(u-.5)*(.12+1.8*Math.sin(v*Math.PI)),v*2-.8,Math.sin(u*Math.PI)*.14+v*v*.3] as V;}),rows:12,columns:7,thickness:.008});
const program=(s:any):any=>({version:'geometry-v1',name:'曲面验收',materials:[{id:'m',color:[.2,.5,.15,1],roughness:.5,metallic:0,textureId:null}],templates:[{id:'t',parts:[{id:'p',material:'m',...pose,shape:s}]}],instances:[{id:'i',label:'曲面',template:'t',...pose,requirementIds:[]}]});
test('实际网格封闭且朝外，前后表面法线一致，完整UV不随分段重复',()=>{
 const s=shape(),g=compileGeometryProgram(program(s)).meshes[0].geometry,edges=new Map<string,number>();let volume=0;
 const position=(i:number)=>g.positions.slice(i*3,i*3+3) as V,key=(i:number)=>position(i).map(n=>n.toFixed(7)).join(',');
 for(let j=0;j<g.indices.length;j+=3){const ids=g.indices.slice(j,j+3),[a,b,c]=ids.map(position),area=cross(sub(b,a),sub(c,a));volume+=a.reduce((n:number,x:number,k:number)=>n+x*cross(b,c)[k],0)/6;
  for(const i of ids){const normal=g.normals.slice(i*3,i*3+3);expect(Math.hypot(...normal)).toBeCloseTo(1,10);expect(area.reduce((n,x,k)=>n+x*normal[k],0)).toBeGreaterThan(0);}
  for(let k=0;k<3;k++){const edge=[key(ids[k]),key(ids[(k+1)%3])].sort().join('|');edges.set(edge,(edges.get(edge)??0)+1);}
 }
 expect([...edges.values()].every(n=>n===2)).toBe(true);expect(volume).toBeGreaterThan(0);
 expect(g.uvs.every((n:number)=>Number.isFinite(n)&&n>=0&&n<=1)).toBe(true);
 expect(g.indices.length/3).toBe(shapeTriangles(s));expect(g.positions.every(Number.isFinite)).toBe(true);
});
test('控制点保持端角，解析导数法线与邻域真实变化一致',()=>{
 const s=shape();expect(samplePatch(s,0,0).point).toEqual(s.controlPoints[0]);expect(samplePatch(s,1,1).point).toEqual(s.controlPoints[15]);
 const a=samplePatch(s,.42,.61),u=samplePatch(s,.420001,.61),v=samplePatch(s,.42,.610001),normal=cross(sub(u.point,a.point),sub(v.point,a.point)),length=Math.hypot(...normal);
 expect(normal.reduce((n,x,k)=>n+x/length*a.normal[k],0)).toBeGreaterThan(.999999);
});
test('退化首尾、非法数值与折返曲面在渲染前被拒绝',()=>{
 for(const mutate of [(s:BezierPatch)=>s.controlPoints.pop(),(s:BezierPatch)=>s.rows=33,(s:BezierPatch)=>s.thickness=0,(s:BezierPatch)=>s.controlPoints[4][0]=NaN,(s:BezierPatch)=>{for(let i=0;i<4;i++)s.controlPoints[i]=[0,0,0];},(s:BezierPatch)=>{s.controlPoints=Array.from({length:16},(_,i)=>[i%4/3,[0,1,-1,0][Math.floor(i/4)],0] as V);}]){
  const s=shape();mutate(s);expect(()=>validateGeometryProgram(program(s))).toThrow();
 }
});
test('散布与实例真实相乘，仍受250000三角形上限约束',()=>{
 const s={type:'scatter',element:shape(),count:3,seed:4,volume:'box',size:[2,2,2],rotationRange:[.1,.1,.1],scaleRange:[.8,1]};
 const p=program(s);p.instances.push({...p.instances[0],id:'j'});
 expect(compileGeometryProgram(p).triangles).toBe(shapeTriangles(s.element)*6);
 p.instances=Array.from({length:256},(_,i)=>({...p.instances[0],id:'i'+i}));expect(()=>validateGeometryProgram(p)).toThrow('预算');
});
test('工具schema公开相同曲面契约，原构造列表继续可用',()=>{
 const variants=geometryProgramSchema().properties.templates.items.properties.parts.items.properties.shape.anyOf;
 const patch=variants.find((v:any)=>v.properties.type.enum[0]==='bezierPatch');expect(patch.properties.controlPoints.minItems).toBe(16);expect(patch.required).toContain('thickness');
 expect(variants.find((v:any)=>v.properties.type.enum[0]==='scatter').properties.element.anyOf.some((v:any)=>v.properties.type.enum[0]==='bezierPatch')).toBe(true);
});
