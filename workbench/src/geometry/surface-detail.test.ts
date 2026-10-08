import {test,expect} from 'bun:test';
import {detailedSurface,validateSurfaceDetail,type SurfaceDetail} from './surface-detail';
import {compileGeometryProgram} from './program';
import {geometryProgramSchema} from './program-schema';
import {surfaceAudit} from './surface-audit';
import {surfaceSchema,SURFACE_PROMPT} from './layout-stages';
const detail:SurfaceDetail={seed:123,frequency:8,colorVariation:.15,roughnessVariation:.2,normalStrength:.1,wearCoverage:.08,wearColor:[.09,.075,.06],wearRoughness:.6,wearMetallic:.7};
const m:any={id:'material',color:[.4,.2,.1,.65],roughness:.4,metallic:.8,textureId:null,surfaceDetail:detail};
const bytes=(t:any)=>Buffer.from(t.rgba8,'base64');
const channel=(t:any,n:number)=>[...bytes(t)].filter((_,i)=>i%4===n);
test('显式表面生成确定、可重复、无缝且不改源数据；换种子真实改变图案',()=>{
 const before=JSON.stringify(m),a=detailedSurface(m),b=detailedSurface(m);expect(a).toEqual(b);expect(JSON.stringify(m)).toBe(before);
 expect(detailedSurface({...m,surfaceDetail:{...detail,seed:124}}).normalTexture.rgba8).not.toBe(a.normalTexture.rgba8);
 for(const t of [a.baseColorTexture,a.normalTexture,a.metallicRoughnessTexture]){
  const b=bytes(t),w=t.width,h=t.height;
  for(let y=0;y<h;y++)expect(b.subarray(y*w*4,y*w*4+4)).toEqual(b.subarray((y*w+w-1)*4,(y*w+w)*4));
  expect(b.subarray(0,w*4)).toEqual(b.subarray((h-1)*w*4,h*w*4));
 }
 expect(new Set(channel(a.normalTexture,0)).size).toBeGreaterThan(4);expect(new Set(channel(a.metallicRoughnessTexture,1)).size).toBeGreaterThan(4);
});
test('颜色只在线性空间组合，PBR通道线性且不二次乘系数，原alpha保留',()=>{
 const source:any={width:1,height:1,rgba8:Buffer.from([128,128,128,73]).toString('base64'),colorSpace:'srgb',normalTexture:{width:1,height:1,rgba8:Buffer.from([128,128,255,255]).toString('base64'),colorSpace:'linear'},metallicRoughnessTexture:{width:1,height:1,rgba8:Buffer.from([255,128,64,255]).toString('base64'),colorSpace:'linear'}};
 const s=detailedSurface({...m,surfaceDetail:{...detail,colorVariation:0,roughnessVariation:0,normalStrength:0,wearCoverage:0}},source);
 expect(s.baseColor).toEqual([1,1,1,.65]);expect(s.roughness).toBe(1);expect(s.metallic).toBe(1);
 expect(s.baseColorTexture.colorSpace).toBe('srgb');expect(s.normalTexture.colorSpace).toBe('linear');expect(s.metallicRoughnessTexture.colorSpace).toBe('linear');
 expect([...bytes(s.metallicRoughnessTexture)]).toEqual([255,51,51,255]);expect(bytes(s.baseColorTexture)[3]).toBe(73);
 const linear=((128/255+.055)/1.055)**2.4,expected=(1.055*(linear*.4)**(1/2.4)-.055)*255;
 expect(bytes(s.baseColorTexture)[0]).toBe(Math.round(expected));expect(bytes(s.normalTexture)).toEqual(bytes(source.normalTexture));
});
test('无照片材质也能表达反光变化，零扰动保持原物理系数',()=>{
 const s=detailedSurface({...m,surfaceDetail:{...detail,colorVariation:0,roughnessVariation:0,normalStrength:0,wearCoverage:0}});
 expect(new Set(channel(s.metallicRoughnessTexture,1))).toEqual(new Set([102]));expect(new Set(channel(s.metallicRoughnessTexture,2))).toEqual(new Set([204]));
 expect(new Set(channel(s.normalTexture,0))).toEqual(new Set([128]));expect(new Set(channel(s.normalTexture,2))).toEqual(new Set([255]));
});
test('非法或缺字段声明在导出前拒绝，不凭空接受未知表面功能',()=>{
 for(const change of [{seed:1.2},{frequency:0},{wearCoverage:.8},{normalStrength:NaN},{wearColor:[1,0]},{unknown:true},{frequency:33}])expect(()=>validateSurfaceDetail({...detail,...change} as any)).toThrow('表面');
 for(const bad of [false,[],{seed:1},'detail'])expect(()=>validateSurfaceDetail(bad as any)).toThrow('表面');
 expect(()=>validateSurfaceDetail(null)).not.toThrow();expect(()=>validateSurfaceDetail(undefined)).not.toThrow();
 expect(geometryProgramSchema().properties.materials.items.properties.surfaceDetail).toBeDefined();
 expect(surfaceSchema().properties.materials.items.properties.surfaceDetail).toEqual(geometryProgramSchema().properties.materials.items.properties.surfaceDetail);expect(SURFACE_PROMPT).toContain('surfaceDetail');
});
test('真实编译只改变表面，几何UV实例和旧材质路径完全保留，审计分开记录来源',()=>{
 const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},program:any={version:'geometry-v1',name:'表面测试',materials:[{...m,surfaceDetail:null}],templates:[{id:'unit',parts:[{...pose,id:'part',material:'material',shape:{type:'box',size:[1,1,1],radius:0}}]}],instances:[{...pose,id:'one',label:'组合体',template:'unit',requirementIds:[]}]};
 const old=compileGeometryProgram(program).meshes[0];program.materials[0].surfaceDetail=detail;const next=compileGeometryProgram(program).meshes[0];
 expect(next.entityId).toBe(old.entityId);for(const key of ['positions','normals','indices','uvs'])expect((next.geometry as any)[key]).toEqual((old.geometry as any)[key]);
 expect(old.geometry.material.surface).toEqual({baseColor:m.color,roughness:.4,metallic:.8});expect(next.geometry.material.surface.normalTexture).toBeDefined();
 const audit=surfaceAudit({program});expect(audit.rows[0].channels).toEqual([]);expect(audit.rows[0].generatedChannels).toHaveLength(3);expect(audit.rows[0].channelSource).toBe('explicit-procedural-declaration-not-measured');
});
