import {test,expect} from 'bun:test';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validTextureBundle,textureSurface,type TextureBundle} from './texture-bundle';
import {compileGeometryProgram,type GeometryProgram} from './program';
import {importTextureResource,loadTextureResource,resolveTextureReuse,textureCandidates} from './texture-library';
import {DATA} from '../store';
const pixels=(rgb:number[],colorSpace:'srgb'|'linear')=>({width:1,height:1,rgba8:Buffer.from([...rgb,255]).toString('base64'),colorSpace});
const bundle=():TextureBundle=>({...pixels([180,100,60],'srgb'),normalTexture:pixels([128,128,255],'linear'),metallicRoughnessTexture:pixels([255,190,0],'linear')});
test('成套通道必须对应同一采样面且使用线性数据，旧基础色仍可绑定',()=>{
 const b=bundle();expect(validTextureBundle(b)).toBe(true);expect(validTextureBundle(pixels([1,2,3],'srgb'))).toBe(true);
 expect(validTextureBundle({...b,normalTexture:{...b.normalTexture!,colorSpace:'srgb'}})).toBe(false);
 expect(validTextureBundle({...b,normalTexture:{...b.normalTexture!,width:2}})).toBe(false);
 expect(validTextureBundle({...b,normalTexture:{...b.normalTexture!,normalTexture:b.normalTexture} as any})).toBe(false);
 expect(validTextureBundle({...b,metallicRoughnessTexture:{...b.metallicRoughnessTexture!,rgba8:'bad'}})).toBe(false);
 expect(textureSurface(b).baseColorTexture).not.toHaveProperty('normalTexture');
});
test('真实编译器保留三通道、原几何UV与材质乘数，无光照伪造',()=>{
 const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]} as any;
 const p:GeometryProgram={version:'geometry-v1',name:'材质通道验证',materials:[{id:'m',color:[1,1,1,1],roughness:1,metallic:1,textureId:'verified'}],templates:[{id:'t',parts:[{...pose,id:'p',material:'m',uvScale:[2,3],shape:{type:'box',size:[1,1,1],radius:0}}]}],instances:[{...pose,id:'i',template:'t',label:'材质样片',requirementIds:[]}]};
 const b=bundle(),full=compileGeometryProgram(p,{verified:b}).meshes[0].geometry;
 const {normalTexture,metallicRoughnessTexture,...base}=b,plain=compileGeometryProgram(p,{verified:base}).meshes[0].geometry;
 expect(full.positions).toEqual(plain.positions);expect(full.uvs).toEqual(plain.uvs);
 expect(full.material.surface).toEqual({baseColor:[1,1,1,1],roughness:1,metallic:1,baseColorTexture:base,normalTexture,metallicRoughnessTexture});
});
test('资源复用、提取和哈希来源保留全部通道，篡改伴随贴图会拒绝',async()=>{
 const root=mkdtempSync(join(tmpdir(),'pbr-bundle-'));try{
  const ref='a'.repeat(64),b=bundle(),id=importTextureResource({label:'完整材质',description:'三通道共用同一采样面',referenceSha256:[ref],texture:b,source:{kind:'test-fixture'}},root);
  expect(textureCandidates([ref],root)[0].channels).toHaveLength(3);
  const reused=resolveTextureReuse({textures:[{id:'surface'}],textureReuse:[{textureId:'surface',assetId:id,reason:'成套复用'}]},[ref],root);
  writeFileSync(join(root,'texture-request.json'),JSON.stringify({references:[],textures:[{id:'surface',description:'验证贴图'}],reused}));
  const child=Bun.spawn([join(DATA,'reconstruction-env/bin/python'),join(import.meta.dirname,'textures.py'),root],{stdout:'pipe',stderr:'pipe'});
  const error=await new Response(child.stderr).text();expect(await child.exited,error).toBe(0);
  expect(JSON.parse(readFileSync(join(root,'texture-registry.json'),'utf8')).surface).toEqual(b);
  expect(JSON.parse(readFileSync(join(root,'texture-provenance.json'),'utf8')).textures[0].channels).toHaveLength(2);
  const path=join(root,id+'.json'),r=JSON.parse(readFileSync(path,'utf8'));r.texture.normalTexture=pixels([64,128,255],'linear');writeFileSync(path,JSON.stringify(r));
  expect(()=>loadTextureResource(id,[ref],root)).toThrow('损坏');
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('同次编译共享材质与贴图对象，不跨编译缓存失效或被修改的输入',()=>{
 const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]} as any;
 const p:GeometryProgram={version:'geometry-v1',name:'共享材质验证',materials:[{id:'m',color:[1,1,1,1],roughness:1,metallic:1,textureId:'verified'}],templates:[{id:'t',parts:Array.from({length:12},(_,i)=>({...pose,id:'p'+i,material:'m',shape:{type:'box' as const,size:[1,1,1] as [number,number,number],radius:0}}))}],instances:[{...pose,id:'i',template:'t',label:'样片',requirementIds:[]}]};
 const b=bundle(),full=compileGeometryProgram(p,{verified:b});
 expect(new Set(full.meshes.map(m=>m.geometry.material.surface))).toHaveLength(1);
 expect(new Set(full.meshes.map(m=>m.geometry.material.surface.baseColorTexture))).toHaveLength(1);
 const first=full.meshes[0].geometry.material.surface.baseColorTexture;
 b.rgba8=pixels([60,40,20],'srgb').rgba8;
 expect(compileGeometryProgram(p,{verified:b}).meshes[0].geometry.material.surface.baseColorTexture.rgba8).not.toBe(first.rgba8);
 b.normalTexture!.rgba8='invalid';expect(()=>compileGeometryProgram(p,{verified:b})).toThrow('像素数据无效');
});
