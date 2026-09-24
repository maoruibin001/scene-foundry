import {test,expect} from 'bun:test';
import {MeshBuilder} from './native/mesh';
import {atlasSurfaces} from './native/prepare';
import {addTableLitter,addFallenCup} from './native/table-litter';
import {clothPoint} from './native/cloth';
import {TABLE_SURFACE} from './native/tabletop';
test('桌面碎屑贴合布面且避开净距区；侧倒杯有内壁并落在声明的支撑范围',()=>{
 const contacts=[[-.475,-.725,.14,-.575]],g=new MeshBuilder([]);
 addTableLitter(g,1.1,1.76,{tableContactAreas:contacts,tableLitterKeepClear:contacts});
 let count=0,minGap=Infinity;
 for(const m of g.meshes())for(let i=0;i<m.geometry.positions.length;i+=3){
  const [x,y,z]=m.geometry.positions.slice(i,i+3);count++;
  expect(Math.abs(x)<.55&&Math.abs(y)<.88).toBe(true);
  const b=contacts[0];expect(x>b[0]&&x<b[2]&&y>b[1]&&y<b[3]).toBe(false);
  minGap=Math.min(minGap,z-clothPoint(.5+x/1.74,.5+y/2.32,1.1,1.76,contacts)[2]);
 }
 expect(count).toBeGreaterThan(1000);expect(minGap).toBeGreaterThan(.0019);
 const cup=new MeshBuilder([]);addFallenCup(cup,[.24,-.30]);const points=cup.meshes().flatMap(m=>m.geometry.positions);
 let cupMin=Infinity;for(let i=0;i<points.length;i+=3){expect(Math.abs(points[i]-.24)).toBeLessThan(.12);expect(Math.abs(points[i+1]+.30)).toBeLessThan(.15);cupMin=Math.min(cupMin,points[i+2]);}
 expect(cupMin).toBeCloseTo(TABLE_SURFACE+.002,8);expect(cup.meshes().some(m=>m.name.endsWith('__paper'))).toBe(true);
});
test('原生闭合圆头和圆角不会导出零法线或退化三角形',()=>{const b=new MeshBuilder([]);b.at('probe',[1,2,3],.6,()=>{b.lathe('metal',[0,0,0],[[0,0],[1,1],[0,2]]);b.rounded('metal',[2,0,1],[1,1,1],.1);b.tube('metal',[0,0,0],[0,2,1],.1);});for(const mesh of b.meshes()){const g=mesh.geometry;expect(g.positions.length).toBe(g.normals.length);expect(g.uvs.length/2).toBe(g.positions.length/3);expect(g.positions.every(Number.isFinite)).toBe(true);for(let i=0;i<g.normals.length;i+=3)expect(Math.hypot(...g.normals.slice(i,i+3))).toBeCloseTo(1,6);for(let i=0;i<g.indices.length;i+=3){const p=g.indices.slice(i,i+3).map(n=>g.positions.slice(n*3,n*3+3));const a=p[1].map((v,k)=>v-p[0][k]),c=p[2].map((v,k)=>v-p[0][k]);expect(Math.hypot(a[1]*c[2]-a[2]*c[1],a[2]*c[0]-a[0]*c[2],a[0]*c[1]-a[1]*c[0])).toBeGreaterThan(1e-11);}}});
test('九宫格上传分区完整保留全部原始像素',()=>{const pixels=Buffer.from(Array.from({length:6*6*4},(_,i)=>i%256)),tiles=atlasSurfaces({width:6,height:6,rgba8:pixels.toString('base64'),colorSpace:'srgb'});const restored=Buffer.alloc(pixels.length);for(const [i,t] of tiles.entries()){const bytes=Buffer.from(t.rgba8,'base64');for(let row=0;row<2;row++)bytes.copy(restored,((Math.floor(i/3)*2+row)*6+i%3*2)*4,row*8,(row+1)*8);}expect(restored.equals(pixels)).toBe(true);expect(tiles).toHaveLength(9);});

test('凹轮廓三角化不会填平缺口，正反绕序均保持实际面积',async()=>{
 const {triangulatePolygon}=await import('./native/mesh');
 for(const p of [[[0,0],[3,0],[3,1],[1,1],[1,3],[0,3]],[[0,3],[1,3],[1,1],[3,1],[3,0],[0,0]]]){
  const tri=triangulatePolygon(p);const area=tri.reduce((sum,[i,j,k])=>{const a=p[i],b=p[j],c=p[k];return sum+Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;},0);expect(area).toBeCloseTo(5,8);expect(tri).toHaveLength(4);
  for(const t of tri){const center=[0,1].map(k=>t.reduce((s,i)=>s+p[i][k],0)/3);expect(center[0]<=1||center[1]<=1).toBe(true);}
 }
});
test('实际桌布顶点始终高于木面，承重区域保持支撑高度，垂边确实低于桌面',async()=>{
 const {nativeAsset}=await import('./native/asset-library');const {clothPoint}=await import('./native/cloth');const {TABLE_SURFACE}=await import('./native/tabletop');
 const mesh=nativeAsset('booth_set',[],{tableContactAreas:[[-.2,-.2,.2,.2]]}).meshes.find(m=>m.name.endsWith('__cloth'))!.geometry;
 let interior=0,drape=0,min=Infinity;
 for(let i=0;i<mesh.positions.length;i+=3){const [x,y,z]=mesh.positions.slice(i,i+3);if(Math.abs(x)<=.55&&Math.abs(y)<=.88){interior++;min=Math.min(min,z);}else if(z<.80)drape++;}
 expect(interior).toBeGreaterThan(100);expect(min).toBeGreaterThan(.85+.015);expect(drape).toBeGreaterThan(100);expect(clothPoint(.5,.5,1.1,1.76,[[-.2,-.2,.2,.2]])[2]).toBeCloseTo(TABLE_SURFACE,8);
 expect(mesh.positions.every(Number.isFinite)).toBe(true);expect(mesh.normals.every(Number.isFinite)).toBe(true);
});
test('微表面以线性法线和粗糙度进入真实材质，法线有限且非金属通道正确',async()=>{
 const {microSurface}=await import('./native/micro-surface');const builder=new MeshBuilder([]);
 for(const name of ['cloth','wood','leather','plaster','brick','carpet']){const maps=microSurface(name)!;expect(maps.normalTexture.colorSpace).toBe('linear');expect(maps.metallicRoughnessTexture.colorSpace).toBe('linear');const n=Buffer.from(maps.normalTexture.rgba8,'base64'),r=Buffer.from(maps.metallicRoughnessTexture.rgba8,'base64');let largestError=0;for(let i=0;i<n.length;i+=4){const xyz=[n[i],n[i+1],n[i+2]].map(v=>v/255*2-1);largestError=Math.max(largestError,Math.abs(Math.hypot(...xyz)-1));if(r[i+2]!==0||r[i+3]!==255)throw Error('非金属贴图通道无效');}expect(largestError).toBeLessThan(.01);expect(builder.material(name).surface.normalTexture).toBe(maps.normalTexture);expect(builder.material(name).surface.roughness).toBe(1);}
});
test('倾倒圆桌保持完整法线，接地且包络与实际几何一致',async()=>{
 const {nativeAsset}=await import('./native/asset-library');const asset=nativeAsset('fallen_table',[]);const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(const m of asset.meshes)for(let i=0;i<m.geometry.positions.length;i+=3)for(let k=0;k<3;k++){min[k]=Math.min(min[k],m.geometry.positions[i+k]);max[k]=Math.max(max[k],m.geometry.positions[i+k]);}expect(min[2]).toBeCloseTo(0,8);for(let i=0;i<3;i++)expect(max[i]-min[i]).toBeCloseTo(asset.base[i],8);expect(asset.base[2]).toBeGreaterThan(.9);
});
