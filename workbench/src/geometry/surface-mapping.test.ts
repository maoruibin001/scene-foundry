import {test,expect} from 'bun:test';
import {compileGeometryProgram} from './program';
import {mapSurfaceUvs} from './surface-mapping';
const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};
const program=(part:any):any=>({version:'geometry-v1',name:'曲面契约',materials:[{id:'mat',color:[1,1,1,1],roughness:.5,metallic:0,textureId:null}],templates:[{id:'unit',parts:[{...pose,id:'surface',material:'mat',...part}]}],instances:[{...pose,id:'one',label:'曲面',template:'unit',requirementIds:[]}]});
test('UV翻转旋转偏移不改变网格；实例重复数覆盖从原始UV计算',()=>{
 const p=program({uvScale:[2,3],uvTransform:{offset:[.25,-.5],rotation:Math.PI/2,flipU:true,flipV:false},shape:{type:'grid',rows:2,columns:2,points:[[0,0,0],[1,0,0],[0,1,0],[1,1,0]],doubleSided:false}});
 const before=JSON.stringify(p),g=compileGeometryProgram(p).meshes[0].geometry;
 expect(g.uvs.slice(0,2)[0]).toBeCloseTo(2.25);expect(g.uvs.slice(0,2)[1]).toBeCloseTo(2.5);expect(JSON.stringify(p)).toBe(before);
 const original=structuredClone(p);delete original.templates[0].parts[0].uvTransform;delete original.templates[0].parts[0].uvScale;
 const plain=compileGeometryProgram(original).meshes[0].geometry;expect(g.positions).toEqual(plain.positions);expect(g.normals).toEqual(plain.normals);
 p.instances[0].surfaceOverrides=[{sourceMaterialId:'mat',targetMaterialId:'mat',uvScale:[4,5]}];const overridden=compileGeometryProgram(p).meshes[0].geometry;
 expect(overridden.uvs[0]).toBeCloseTo(4.25);expect(overridden.uvs[1]).toBeCloseTo(4.5);expect(overridden.positions).toEqual(plain.positions);
});
test('旋转体平滑消除细分接缝的法线断层，UV seam与实际位置保持',()=>{
 const p=program({smoothAngle:0,shape:{type:'lathe',profile:[[1,0],[1,1]],segments:16}}),plain=compileGeometryProgram(p).meshes[0].geometry;
 p.templates[0].parts[0].smoothAngle=45;const smooth=compileGeometryProgram(p).meshes[0].geometry;
 expect(smooth.positions).toEqual(plain.positions);expect(smooth.indices).toEqual(plain.indices);expect(smooth.uvs).toEqual(plain.uvs);
 for(let i=0;i<smooth.positions.length;i+=3){expect(smooth.normals[i]).toBeCloseTo(smooth.positions[i],6);expect(smooth.normals[i+1]).toBeCloseTo(smooth.positions[i+1],6);expect(smooth.normals[i+2]).toBeCloseTo(0,6)}
 expect(smooth.normals).not.toEqual(plain.normals);
 delete p.templates[0].parts[0].smoothAngle;expect(compileGeometryProgram(p).meshes[0].geometry.normals).toEqual(smooth.normals);
});
test('平滑不会消除箱体硬边或令双面布料法线互相抵消',()=>{
 const box=program({shape:{type:'box',size:[1,1,1],radius:0}}),plain=compileGeometryProgram(box).meshes[0].geometry;
 box.templates[0].parts[0].smoothAngle=45;expect(compileGeometryProgram(box).meshes[0].geometry.normals).toEqual(plain.normals);
 const grid=program({smoothAngle:60,shape:{type:'grid',rows:2,columns:2,points:[[0,0,0],[1,0,0],[0,1,0],[1,1,0]],doubleSided:true}}),g=compileGeometryProgram(grid).meshes[0].geometry;
 expect(g.normals.filter((_,i)=>i%3===2)).toEqual([1,1,1,1,1,1,-1,-1,-1,-1,-1,-1]);
});
test('非法UV与法线参数在导出前拒绝；历史省略配置保持原映射',()=>{
 const p=program({shape:{type:'box',size:[1,1,1],radius:0}});
 for(const bad of [{offset:[0,NaN],rotation:0,flipU:false,flipV:false},{offset:[0,0],rotation:Infinity,flipU:false,flipV:false},{offset:[0,0],rotation:0,flipU:1,flipV:false}]){p.templates[0].parts[0].uvTransform=bad;expect(()=>compileGeometryProgram(p)).toThrow('UV 变换无效');}
 delete p.templates[0].parts[0].uvTransform;p.templates[0].parts[0].smoothAngle=181;expect(()=>compileGeometryProgram(p)).toThrow('平滑角度');
 expect(mapSurfaceUvs([0,0,1,1],[2,3])).toEqual([0,0,2,3]);
});
