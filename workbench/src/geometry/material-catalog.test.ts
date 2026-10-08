import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {catalogCandidates,loadCatalogResource} from './material-catalog';
import {jobTextureCandidates,jobTextureReuse} from './texture-library';
import {textureSourceEvidence} from './texture-source';
import {repairReusableTextureEvidence} from './repair-texture-evidence';
import {digest,save,read} from '../store';
import {assertProductionReady} from '../runtime-preflight';
import {importPbrCatalog} from './import-pbr-catalog';
import {reconstructionPython} from '../runtime-paths.mjs';

test('固定目录独立于本图来源，fresh仅允许这些明确登记的外部素材，仍拒绝历史缓存',()=>{
 const candidates=jobTextureCandidates({reuseMode:'fresh'},['a'.repeat(64)]);
 expect(candidates.length).toBe(2);expect(candidates.every(c=>c.source.kind==='licensed-pbr-catalog'&&c.referenceSha256.length===0)).toBe(true);
 const scene={textures:[{id:'wood'}],textureReuse:[{textureId:'wood',assetId:candidates[0].id,reason:'对应原图桌面，需真实预览确认'}]};
 const resolved=jobTextureReuse({reuseMode:'fresh'},scene,['b'.repeat(64)]);
 expect(resolved[0].texture.normalTexture?.colorSpace).toBe('linear');expect(resolved[0].texture.metallicRoughnessTexture?.colorSpace).toBe('linear');
 expect(()=>jobTextureReuse({reuseMode:'fresh'},{...scene,textureReuse:[{...scene.textureReuse[0],assetId:'f'.repeat(64)}]},['a'.repeat(64)])).toThrow('禁用');
 expect(textureSourceEvidence(scene,[{referenceIndex:1,width:10,height:10}])[0]).toMatchObject({sourceKind:'licensed-pbr-catalog',assetId:candidates[0].id});
});

test('目录拒绝损坏像素、未经固定的ID和伪造通道证明',()=>{
 const root=mkdtempSync(join(tmpdir(),'pbr-verify-')),original=loadCatalogResource(catalogCandidates()[0].id),id=original.id;
 try{
  save(join(root,id+'.json'),original);expect(loadCatalogResource(id,root,[id]).id).toBe(id);
  expect(()=>loadCatalogResource(id,root,[])).toThrow('未登记');
  const corrupt=structuredClone(original);corrupt.texture.rgba8='AAAA';save(join(root,id+'.json'),corrupt);expect(()=>loadCatalogResource(id,root,[id])).toThrow('摘要不符');
  const {id:_,...bad}=structuredClone(original);bad.source.files[1].channel='Diffuse';const badId=digest(JSON.stringify(bad));save(join(root,badId+'.json'),{...bad,id:badId});
  expect(()=>loadCatalogResource(badId,root,[badId])).toThrow('通道摘要不符');
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('缺失固定素材在制作前阻断，不消耗模型调用',()=>{
 let calls=0;const root=mkdtempSync(join(tmpdir(),'pbr-missing-'));
 try{expect(()=>{assertProductionReady(()=>({node:{}} as any),()=>{},()=>({} as any),()=>catalogCandidates(root));calls++;}).toThrow();expect(calls).toBe(0);}finally{rmSync(root,{recursive:true,force:true});}
});

test('材质接触表携带真实像素、每通道来源和外部许可，文本不塞密集像素',async()=>{
 const root=mkdtempSync(join(tmpdir(),'pbr-sheet-'));
 try{
  const [selected]=catalogCandidates();const evidence=await repairReusableTextureEvidence(['a'.repeat(64)],root,AbortSignal.timeout(15000),undefined,[selected.id]);
  expect(evidence.context).toHaveLength(1);expect(evidence.context[0].channels).toEqual(['baseColorTexture','normalTexture','metallicRoughnessTexture']);
  expect(evidence.context[0].provenance.license).toBe('CC0-1.0');expect(evidence.context[0].provenance.files).toHaveLength(3);expect(readFileSync(evidence.images[0].path).length).toBeGreaterThan(1000);
  expect(JSON.stringify(evidence.context)).not.toContain('rgba8');expect(evidence.context[0].referenceSha256).toEqual([]);
 }finally{rmSync(root,{recursive:true,force:true});}
});

async function fixture(root:string){
 const p=Bun.spawnSync([reconstructionPython(),'-c','from PIL import Image; import sys; from pathlib import Path; p=Path(sys.argv[1]); [(Image.new("RGB",(512,512),c).save(p/(n+".png"))) for n,c in [("Diffuse",(130,65,30)),("nor_gl",(150,125,220)),("arm",(210,88,0))]]',root]);
 if(p.exitCode)throw Error(new TextDecoder().decode(p.stderr));
 const request={assetId:'fixture',assetUrl:'https://polyhaven.com/a/fixture',license:'CC0-1.0',licenseUrl:'https://polyhaven.com/license',label:'fixture',description:'synthetic aligned channels',physicalSizeMeters:[1.5,1.5],size:256,files:Object.fromEntries(['Diffuse','nor_gl','arm'].map(name=>{const path=join(root,name+'.png');return [name,{path,url:'https://example.com/'+name+'.png',sha256:digest(readFileSync(path))}]}))};
 const path=join(root,'input.json');save(path,request);return {path,request};
}

test('真实转换保持颜色与ARM通道，法线线性归一，不从颜色杜撰凹凸',async()=>{
 const root=mkdtempSync(join(tmpdir(),'pbr-import-'));
 try{
  const f=await fixture(root),result=await importPbrCatalog(f.path,join(root,'out')),r=loadCatalogResource(result.id,join(root,'out'),[result.id]);
  expect([...Buffer.from(r.texture.rgba8,'base64').subarray(0,4)]).toEqual([130,65,30,255]);
  expect([...Buffer.from(r.texture.metallicRoughnessTexture.rgba8,'base64').subarray(0,4)]).toEqual([210,88,0,255]);
  const n=[...Buffer.from(r.texture.normalTexture.rgba8,'base64').subarray(0,3)].map(v=>v/127.5-1);expect(Math.hypot(...n)).toBeCloseTo(1,2);
  expect(r.texture.width).toBe(256);expect(r.source.files[0].sha256).toBe(f.request.files.Diffuse.sha256);
  expect((await importPbrCatalog(f.path,join(root,'out'))).id).toBe(result.id);
  f.request.files.arm.sha256='a'.repeat(64);save(f.path,f.request);await expect(importPbrCatalog(f.path,join(root,'bad'))).rejects.toThrow('摘要不符');
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('转换拒绝缺通道、不对齐源和假放大',async()=>{
 const root=mkdtempSync(join(tmpdir(),'pbr-invalid-'));
 try{
  const f=await fixture(root);f.request.size=1024;save(f.path,f.request);await expect(importPbrCatalog(f.path,join(root,'out'))).rejects.toThrow('no upscaling');
  f.request.size=256;const p=Bun.spawnSync([reconstructionPython(),'-c','from PIL import Image; import sys; Image.new("RGB",(256,256),(210,88,0)).save(sys.argv[1])',f.request.files.arm.path]);expect(p.exitCode).toBe(0);f.request.files.arm.sha256=digest(readFileSync(f.request.files.arm.path));save(f.path,f.request);
  await expect(importPbrCatalog(f.path,join(root,'out'))).rejects.toThrow('aligned');
  delete (f.request.files as any).arm;save(f.path,f.request);await expect(importPbrCatalog(f.path,join(root,'out'))).rejects.toThrow('完整通道');
 }finally{rmSync(root,{recursive:true,force:true});}
});
