import {test,expect} from 'bun:test';
import {detailedSurface,validateSurfaceDetail,type SurfaceDetail,type MasonryPattern} from './surface-detail';
const pattern:MasonryPattern={kind:'masonry',columns:2,rows:4,jointWidth:.012,jointContrast:.3,stagger:true};
const detail:SurfaceDetail={seed:41,frequency:12,colorVariation:.15,roughnessVariation:.15,normalStrength:.04,wearCoverage:0,wearColor:[.2,.2,.2],wearRoughness:.7,wearMetallic:0,pattern};
const material={color:[.3,.2,.12,1] as [number,number,number,number],roughness:.6,metallic:0,surfaceDetail:detail};
test('砌块分缝具有真实色差与法线，错缝周期全部通道无缝且确定',()=>{
 const before=JSON.stringify(material),a=detailedSurface(material),b=detailedSurface(material);expect(a).toEqual(b);expect(JSON.stringify(material)).toBe(before);
 for(const t of [a.baseColorTexture,a.normalTexture,a.metallicRoughnessTexture]){
  const pixels=Buffer.from(t.rgba8,'base64'),w=t.width,h=t.height;
  expect(pixels.subarray(0,w*4)).toEqual(pixels.subarray((h-1)*w*4));
  for(let y=0;y<h;y++)expect(pixels.subarray(y*w*4,y*w*4+4)).toEqual(pixels.subarray((y*w+w-1)*4,(y*w+w)*4));
 }
 const c=Buffer.from(a.baseColorTexture.rgba8,'base64'),n=Buffer.from(a.normalTexture.rgba8,'base64'),w=a.baseColorTexture.width;
 const red=(u:number,v:number)=>c[(Math.round(v*(w-1))*w+Math.round(u*(w-1)))*4];
 expect(red(.25,.125)-red(.5,.125)).toBeGreaterThan(15);
 expect(red(.5,.375)-red(.25,.375)).toBeGreaterThan(15);
 expect(new Set(Array.from(n).filter((_,i)=>i%4===0)).size).toBeGreaterThan(4);
});
test('周期块数、缝宽、未声明参数及非有限值必须在编译前拒绝',()=>{
 for(const change of [{rows:3},{columns:0},{columns:1.5},{rows:17},{jointWidth:NaN},{jointWidth:.08},{jointContrast:1},{stagger:1},{arbitrary:true}])expect(()=>validateSurfaceDetail({...detail,pattern:{...pattern,...change} as any})).toThrow('图案');
 expect(()=>validateSurfaceDetail({...detail,pattern:{...pattern,rows:3,stagger:false}})).not.toThrow();
});
test('源照片像素与通道不被覆盖，砌缝能力不伪造照片来源',()=>{
 const source:any={width:16,height:16,rgba8:Buffer.alloc(16*16*4,192).toString('base64'),colorSpace:'srgb'};
 const before=JSON.stringify(source),out=detailedSurface(material,source);
 expect(JSON.stringify(source)).toBe(before);expect(out.baseColorTexture.width).toBe(16);expect(out.baseColorTexture.rgba8).not.toBe(source.rgba8);
 expect(out.normalTexture.colorSpace).toBe('linear');expect(out.metallicRoughnessTexture.colorSpace).toBe('linear');
});
