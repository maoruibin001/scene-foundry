import {test,expect} from 'bun:test';
import {distributedPoses,type Distribution} from './distribution';
import {compileGeometryProgram,validateGeometryProgram,type GeometryProgram} from './program';
import {geometryProgramSchema} from './program-schema';

const distribution:Distribution={count:128,seed:0,volume:'ellipsoid',size:[4,6,8],rotationRange:[.6,.4,Math.PI],scaleRange:[.7,1.2]};
const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]} as const;
function fixture():GeometryProgram{return structuredClone({version:'geometry-v1',name:'成组细节',materials:[{id:'surface',color:[.35,.55,.2,1],roughness:.8,metallic:0,textureId:null}],templates:[{id:'cluster',parts:[{...pose,id:'elements',material:'surface',uvScale:[2,3],shape:{type:'scatter',...distribution,element:{type:'grid',rows:2,columns:2,doubleSided:true,points:[[-.1,-.07,0],[.1,-.07,.03],[-.1,.07,.03],[.1,.07,0]]}}}]}],instances:[{...pose,id:'item',label:'三维细节组',template:'cluster',requirementIds:['R1']}]}) as GeometryProgram;}

test('固定种子可复现，椭球内均匀体积分布不会退化成一张平面',()=>{
 const a=[...distributedPoses(distribution)],b=[...distributedPoses(distribution)];expect(a).toEqual(b);
 expect([...distributedPoses({...distribution,seed:1})]).not.toEqual(a);
 for(const p of a){expect(p.position.reduce((n,v,k)=>n+(v/(distribution.size[k]/2))**2,0)).toBeLessThanOrEqual(1+1e-12);expect(p.scale[0]).toBeGreaterThanOrEqual(.7);expect(p.scale[0]).toBeLessThanOrEqual(1.2);}
 for(let k=0;k<3;k++)expect(Math.max(...a.map(p=>p.position[k]))-Math.min(...a.map(p=>p.position[k]))).toBeGreaterThan(distribution.size[k]*.7);
 const box=[...distributedPoses({...distribution,volume:'box'})];expect(box.every(p=>p.position.every((v,k)=>Math.abs(v)<=distribution.size[k]/2))).toBe(true);
});

test('散布编译为真实网格，计入所有三角形，保留局部UV与最终非均匀变换后的法线',()=>{
 const p=fixture();p.templates[0].parts[0].scale=[2,1,.5];p.instances[0].rotation=[.2,.3,.4];
 const result=compileGeometryProgram(p),again=compileGeometryProgram(p),g=result.meshes[0].geometry;
 expect(result).toEqual(again);expect(result.triangles).toBe(128*4);expect(result.estimatedTriangles).toBe(128*4);expect(result.meshes).toHaveLength(1);
 expect(g.positions.length).toBe(result.triangles*9);expect(g.uvs).toHaveLength(result.triangles*6);
 expect(g.uvs.slice(0,24)).toEqual(g.uvs.slice(24,48));expect(Math.max(...g.uvs.filter((_:number,i:number)=>i%2===0))).toBe(2);expect(Math.max(...g.uvs.filter((_:number,i:number)=>i%2===1))).toBe(3);
 let maxNormalError=0;for(let i=0;i<g.normals.length;i+=3)maxNormalError=Math.max(maxNormalError,Math.abs(Math.hypot(...g.normals.slice(i,i+3))-1));
 expect(maxNormalError).toBeLessThan(1e-10);expect(g.positions.every(Number.isFinite)).toBe(true);
});

test('数量、种子、尺度、递归嵌套及全场景预算在展开前拒绝',()=>{
 for(const change of [
  (s:any)=>s.count=2049,(s:any)=>s.count=0,(s:any)=>s.seed=-1,(s:any)=>s.seed=4294967296,
  (s:any)=>s.scaleRange=[2,1],(s:any)=>s.scaleRange=[0,1],(s:any)=>s.rotationRange=[0,NaN,0],
  (s:any)=>s.element={...structuredClone(s)},
 ]){const p=fixture();change(p.templates[0].parts[0].shape);expect(()=>compileGeometryProgram(p)).toThrow();}
 const p=fixture(),s=p.templates[0].parts[0].shape as any;s.count=2048;s.element={type:'box',size:[1,1,1],radius:.1};
 expect(()=>validateGeometryProgram(p)).toThrow('三角形预算');
 const union=geometryProgramSchema().properties.templates.items.properties.parts.items.properties.shape.anyOf;
 const scatter=union.find(s=>s.properties.type.enum[0]==='scatter')!;expect(scatter.properties.element.anyOf).toHaveLength(5);
 expect(scatter.additionalProperties).toBe(false);expect(scatter.properties.count.maximum).toBe(2048);
});
