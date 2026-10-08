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

test('米制投影保持长箱各面相同纹理密度，几何和法线逐项不变',()=>{
 const p=program({shape:{type:'box',size:[8,2,.4],radius:0}}),plain=compileGeometryProgram(p).meshes[0].geometry;
 p.templates[0].parts[0].uvProjection={mode:'world-box',metersPerRepeat:[.5,.5,.5],origin:[0,0,0]};
 const g=compileGeometryProgram(p).meshes[0].geometry;
 expect(g.positions).toEqual(plain.positions);expect(g.normals).toEqual(plain.normals);expect(g.indices).toEqual(plain.indices);
 for(let k=0;k<g.indices.length;k+=3)for(let j=0;j<3;j++){
  const a=g.indices[k+j],b=g.indices[k+(j+1)%3],meters=Math.hypot(...[0,1,2].map(i=>g.positions[a*3+i]-g.positions[b*3+i])),repeats=Math.hypot(...[0,1].map(i=>g.uvs[a*2+i]-g.uvs[b*2+i]));expect(repeats/meters).toBeCloseTo(2,8);
 }
 p.templates[0].parts[0].uvProjection={mode:'native'};expect(compileGeometryProgram(p).meshes[0].geometry.uvs).toEqual(plain.uvs);
});
test('相邻世界墙片共享尺度和相位，实例旋转缩放后仍按最终米数映射',()=>{
 const p=program({shape:{type:'box',size:[2,.1,3],radius:0},uvProjection:{mode:'world-box',metersPerRepeat:[.5,.5,.5],origin:[.1,.2,.3]}});
 p.instances.push({...p.instances[0],id:'two',position:[2,0,0]});const [a,b]=compileGeometryProgram(p).meshes.map(x=>x.geometry);
 const seam=(g:any)=>g.indices.filter(i=>Math.abs(g.positions[i*3]-1)<1e-8&&g.normals[i*3+1]>.99).map(i=>({z:g.positions[i*3+2],uv:g.uvs.slice(i*2,i*2+2)})).sort((x,y)=>x.z-y.z);
 expect(seam(a).length).toBeGreaterThan(0);for(const v of seam(a))expect(seam(b).find(x=>x.z===v.z)?.uv).toEqual(v.uv);
 p.instances[0].rotation=[0,0,Math.PI/2];p.instances[0].scale=[3,2,.5];p.instances[0].position=[4,7,2];
 p.instances[0].surfaceOverrides=[{sourceMaterialId:'mat',targetMaterialId:'mat',uvScale:[2,2],uvTransform:{offset:[.25,-.5],rotation:0,flipU:false,flipV:false}}];
 const g=compileGeometryProgram(p).meshes[0].geometry;
 for(let k=0;k<g.indices.length;k+=3){const a=g.indices[k],b=g.indices[k+1],meters=Math.hypot(...[0,1,2].map(i=>g.positions[a*3+i]-g.positions[b*3+i])),repeats=Math.hypot(...[0,1].map(i=>g.uvs[a*2+i]-g.uvs[b*2+i]));expect(repeats/meters).toBeCloseTo(4,7);}
});
test('米制投影参数严格验证，不能接受零周期或未知投影，历史记录不变',()=>{
 const p=program({shape:{type:'box',size:[1,1,1],radius:0}}),part=p.templates[0].parts[0];
 for(const v of [{mode:'world-box',metersPerRepeat:[0,1,1],origin:[0,0,0]},{mode:'world-box',metersPerRepeat:[1,1,1],origin:[0,NaN,0]},{mode:'screen'},{mode:'native',metersPerRepeat:[1,1,1]}]){part.uvProjection=v;expect(()=>compileGeometryProgram(p)).toThrow('投影');}
});
