import {test,expect} from 'bun:test';
import {compactBlockoutSchema,expandBlockoutGeometry,assertBlockoutGeneration} from './blockout-contract';
import {geometryProgramSchema} from './program-schema';
import {compileGeometryProgram} from './program';
import {BLOCKOUT_MATERIALS,BLOCKOUT_TEMPLATE_PROMPT,validateBlockoutTemplate} from './blockout-assets';
import {checkpointFixture} from './checkpoint-fixture';
import {read} from '../store';
import {join} from 'node:path';
import {rmSync} from 'node:fs';

const part={id:'body',position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],shape:{type:'box',size:[1,1,1],radius:0}};
const value=(n=1)=>({templates:[{id:'subject',parts:Array.from({length:n},(_,i)=>({...part,id:'p'+i}))}]});
test('灰模小契约限制输出工作量并从真实几何契约派生，不削减详细资产能力',()=>{
 const before=geometryProgramSchema(),wire:any=compactBlockoutSchema(),parts=wire.properties.templates.items.properties.parts;
 expect(parts.maxItems).toBe(8);expect(parts.items.required).toEqual(['id','position','rotation','scale','shape']);
 expect(parts.items.properties.shape.anyOf.map(s=>s.properties.type.enum[0])).toEqual(['branchCrown','cushion','box','lathe','extrusion','tube','grid']);
 expect(parts.items.properties.shape.anyOf.find(s=>s.properties.type.enum[0]==='lathe').properties.profile.maxItems).toBe(12);
 expect(geometryProgramSchema()).toEqual(before);expect(BLOCKOUT_TEMPLATE_PROMPT).not.toContain('surfaceDetail');expect(BLOCKOUT_TEMPLATE_PROMPT).not.toContain('bezierPatch');
});
test('灰模输出补全固定无纹理字段后可由正常编译器编译，原始响应不改',()=>{
 const wire=value(),copy=structuredClone(wire),expanded=expandBlockoutGeometry(wire);
 expect(wire).toEqual(copy);expect(expanded.templates[0].parts[0]).toMatchObject({material:'blockout',uvScale:[1,1],uvProjection:null,uvTransform:null,smoothAngle:null});
 const program={version:'geometry-v1',name:'灰模',materials:BLOCKOUT_MATERIALS,templates:expanded.templates,instances:[{id:'instance',label:'主体',template:'subject',position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],requirementIds:[],surfaceOverrides:[]}]};
 expect(compileGeometryProgram(program,{}).triangles).toBe(12);
});
test('模型超量或返回细节曲面直接拒绝，不静默裁掉部件或降低空间要求',()=>{
 expect(()=>expandBlockoutGeometry(value(9))).toThrow('1–8');expect(()=>expandBlockoutGeometry(value(0))).toThrow('1–8');
 for(const shape of [{type:'bezierPatch'},{type:'scatter'},{type:'tube',segments:64},{type:'cushion',segments:12},{type:'lathe',profile:Array(13).fill([1,0])}]){
  const v=value();v.templates[0].parts[0].shape=shape as any;expect(()=>assertBlockoutGeneration(v)).toThrow();
 }
});
test('同根已有合法灰模仍按原几何契约复用，不为新生成限额改写旧资产',()=>{
 const f=checkpointFixture();try{
  const space=read(join(f.registration.generationDir,'layout.json')),brief={...space.program.templates[0],maxParts:32};
  const old={templates:[{id:brief.id,parts:Array.from({length:9},(_,i)=>({...f.geometry.template.parts[0],id:'old'+i,material:'blockout'}))}]};
  const snapshot=JSON.stringify(old);expect(validateBlockoutTemplate(old,space,brief)).toBe(old);expect(JSON.stringify(old)).toBe(snapshot);expect(()=>assertBlockoutGeneration(old)).toThrow('1–8');
 }finally{rmSync(f.root,{recursive:true,force:true})}
});

test('粗曲面契约和真实编译器共用grid，支持非旋转对称轮廓并限制81点',()=>{
 const schema:any=compactBlockoutSchema().properties.templates.items.properties.parts.items.properties.shape.anyOf.find(s=>s.properties.type.enum[0]==='grid');
 expect(schema.properties.rows.maximum).toBe(9);expect(schema.properties.columns.maximum).toBe(9);expect(schema.properties.points.maxItems).toBe(81);
 for(const fn of [(u:number,v:number)=>u*u-v*v,(u:number,v:number)=>(1-u*u)*(v+1)/2,(u:number,v:number)=>.4*Math.sin(u*2)+v*.3]){
  const shape:any={type:'grid',rows:5,columns:5,doubleSided:true,points:Array.from({length:25},(_,i)=>{const u=(i%5)/2-1,v=Math.floor(i/5)/2-1;return [u,v,fn(u,v)];})};
  const wire=value();wire.templates[0].parts[0].shape=shape;
  const expanded=expandBlockoutGeometry(wire),program:any={version:'geometry-v1',name:'粗曲面',materials:BLOCKOUT_MATERIALS,templates:expanded.templates,instances:[{id:'one',label:'主体',template:'subject',position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],requirementIds:[]}]};
  const direct=structuredClone(program);direct.templates[0].parts[0].shape=shape;
  expect(compileGeometryProgram(program,{})).toEqual(compileGeometryProgram(direct,{}));expect(compileGeometryProgram(program,{}).triangles).toBe(64);
  expect(wire.templates[0].parts[0]).not.toHaveProperty('material');
 }
});
test('无效grid在实际预览前拒绝，不静默截点、封口或修改总预算',()=>{
 const base:any={type:'grid',rows:2,columns:2,doubleSided:true,points:[[0,0,0],[1,0,0],[0,1,0],[1,1,0]]};
 for(const shape of [{...base,rows:10},{...base,columns:10},{...base,points:base.points.slice(1)},{...base,doubleSided:null},{...base,points:[[NaN,0,0],...base.points.slice(1)]},{...base,points:Array(4).fill([0,0,0])}]){
  const wire=value();wire.templates[0].parts[0].shape=shape;const before=JSON.stringify(wire);expect(()=>expandBlockoutGeometry(wire)).toThrow();expect(JSON.stringify(wire)).toBe(before);
 }
});
