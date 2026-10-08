import {test,expect} from 'bun:test';
import {detailedSurface,validateSurfaceDetail,surfaceDetailSize,type SurfaceDetail} from './surface-detail';
import {editableSceneContext} from './evidence-refinement';
const detail:SurfaceDetail={seed:39,frequency:9,colorVariation:.35,roughnessVariation:.2,normalStrength:.12,wearCoverage:0,wearColor:[.2,.1,.03],wearRoughness:.5,wearMetallic:0};
const material={color:[.3,.1,.03,1] as [number,number,number,number],roughness:.5,metallic:0,surfaceDetail:detail};
const image=(p:any)=>detailedSurface({...material,surfaceDetail:{...detail,pattern:p}}).baseColorTexture;
function differences(t:any){const b=Buffer.from(t.rgba8,'base64'),w=t.width;let u=0,v=0;for(let y=0;y<t.height-1;y++)for(let x=0;x<w-1;x++){const k=(y*w+x)*4;u+=Math.abs(b[k]-b[k+4]);v+=Math.abs(b[k]-b[k+w*4]);}return {u,v};}
test('显式木纹产生可验证的方向性，换方向会改变像素而非只改描述',()=>{
 const u=differences(image({kind:'wood-grain',direction:'u',warp:0})),v=differences(image({kind:'wood-grain',direction:'v',warp:0}));
 expect(u.v/u.u).toBeGreaterThan(5);expect(v.u/v.v).toBeGreaterThan(5);
});
test('两类纹理全部通道确定且无缝，原数据不变',()=>{
 for(const kind of ['wood-grain','stone-veins'] as const){
  const m={...material,surfaceDetail:{...detail,pattern:{kind,direction:'v' as const,warp:.6}}},saved=JSON.stringify(m),s=detailedSurface(m);
  expect(s).toEqual(detailedSurface(m));expect(JSON.stringify(m)).toBe(saved);expect(s.baseColorTexture.width).toBe(512);
  for(const t of [s.baseColorTexture,s.normalTexture,s.metallicRoughnessTexture]){const b=Buffer.from(t.rgba8,'base64'),w=t.width,h=t.height;
   expect(b.subarray(0,w*4)).toEqual(b.subarray((h-1)*w*4,h*w*4));
   for(let y=0;y<h;y++)expect(b.subarray(y*w*4,y*w*4+4)).toEqual(b.subarray((y*w+w-1)*4,(y*w+w)*4));
  }
 }
 expect(image({kind:'wood-grain',direction:'u',warp:.6}).rgba8).not.toBe(image({kind:'stone-veins',direction:'u',warp:.6}).rgba8);
});
test('没有声明图案时保持历史输出；照片大小不被偷偷改写',()=>{
 expect(detailedSurface(material)).toEqual(detailedSurface({...material,surfaceDetail:{...detail,pattern:null}}));expect(surfaceDetailSize(detail)).toBe(256);
 const t:any={width:2,height:2,rgba8:Buffer.alloc(16,255).toString('base64'),colorSpace:'srgb'};
 expect(detailedSurface({...material,surfaceDetail:{...detail,pattern:{kind:'wood-grain',direction:'v',warp:.3}}},t).baseColorTexture.width).toBe(2);
});
test('未知图案及无效参数在编译前拒绝',()=>{
 for(const p of [{kind:'wood-grain',direction:'x',warp:.2},{kind:'wood-grain',direction:'u',warp:2},{kind:'wood-grain',direction:'u',warp:NaN},{kind:'noise',direction:'u',warp:.2},{kind:'wood-grain',direction:'u',warp:.2,hidden:true}])expect(()=>validateSurfaceDetail({...detail,pattern:p as any})).toThrow('图案');
});
test('整体修正同样压缩密集几何，保留精确检索身份与全部机位材料',()=>{
 const part={id:'dense',shape:{type:'extrude',depth:1,profile:Array.from({length:4000},(_,n)=>[n/17,n/23])}},scene:any={assumptions:[],cameras:[{name:'参考'},{name:'背面检查'}],program:{materials:[material],instances:[],templates:[{id:'shelf',parts:[part]}]}},saved=JSON.stringify(scene),out=editableSceneContext(scene),p=out.program.templates[0].parts[0];
 expect(p.shape.profileOmitted).toBe(true);expect(p.sourcePartSha256).toHaveLength(64);expect(p.geometryReadRequired).toBe(true);expect(out.cameras).toEqual(scene.cameras);expect(out.program.materials).toEqual(scene.program.materials);expect(JSON.stringify(scene)).toBe(saved);expect(JSON.stringify(out).length).toBeLessThan(saved.length/10);
});
