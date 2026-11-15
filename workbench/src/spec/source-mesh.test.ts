import {test,expect} from 'bun:test';
import {mkdtempSync,writeFileSync,rmSync,symlinkSync,mkdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';
import {sourceMeshErrors,loadSourceMesh} from './source-mesh';
import {sampleSpec} from './fixtures';import {sceneSpecErrors} from './schema';
import {planSpecExport,planSpecExportParallel,writeSpecPack,getCachedMeshAsset} from './export-pack';
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
function fixture(){const root=mkdtempSync(join(tmpdir(),'source-mesh-')),buf=Buffer.alloc(128);new Float32Array(buf.buffer,buf.byteOffset,9).set([0,0,0,1,0,0,0,1,0]);new Uint16Array(buf.buffer,buf.byteOffset+36,3).set([0,1,2]);new Float32Array(buf.buffer,buf.byteOffset+44,6).set([0,0,0,1,1,0]);
 const meta={rest:{kind:'mesh',materialSlots:[{slotName:'Material_0'}],submeshes:[{topology:'triangle-list',indexOffset:0,indexCount:3,vertexCount:3,materialSlot:0}]},layout:{'attributes.position':{type:'Float32Array',offset:0,length:9},indices:{type:'Uint16Array',offset:36,length:3},aabb:{type:'Float32Array',offset:44,length:6}}};
 const mb=Buffer.from(JSON.stringify(meta));writeFileSync(join(root,'m.json'),mb);writeFileSync(join(root,'m.bin'),buf);return {root,buf,meta,ref:{metadata:'m.json',binary:'m.bin',metadataSha256:sha(mb),binarySha256:sha(buf),slots:{Material_0:'steel'}}};}
test('adopts unchanged position/index bytes, rejects tampering and library escapes',()=>{const f=fixture();try{
 const m=loadSourceMesh(f.ref,f.root);expect(Array.from(m.indices!)).toEqual([0,1,2]);expect(Array.from(m.attributes!.position as Float32Array)).toEqual([0,0,0,1,0,0,0,1,0]);
 expect(()=>loadSourceMesh({...f.ref,binarySha256:'0'.repeat(64)},f.root)).toThrow('HASH_MISMATCH');
 expect(sourceMeshErrors({...f.ref,binary:'../m.bin'}).join()).toContain('relative');
 const other=mkdtempSync(join(tmpdir(),'outside-mesh-'));try{writeFileSync(join(other,'outside'),f.buf);symlinkSync(join(other,'outside'),join(f.root,'escape.bin'));expect(()=>loadSourceMesh({...f.ref,binary:'escape.bin'},f.root)).toThrow('OUTSIDE_LIBRARY');}finally{rmSync(other,{recursive:true});}
 }finally{rmSync(f.root,{recursive:true});}});
test('rejects invalid slices, indices and unbound material slots rather than proxies',()=>{const f=fixture();try{
 expect(()=>loadSourceMesh({...f.ref,slots:{wrong:'steel'}},f.root)).toThrow('MATERIAL_UNBOUND');
 f.meta.layout.indices.offset=127;const b=Buffer.from(JSON.stringify(f.meta));writeFileSync(join(f.root,'m.json'),b);
 expect(()=>loadSourceMesh({...f.ref,metadataSha256:sha(b)},f.root)).toThrow('INVALID_SLICE');
 }finally{rmSync(f.root,{recursive:true});}});
test('normal sequential/parallel spec export both import sources and emit mandatory cooked bytes',async()=>{const f=fixture(),old=process.env.PIPELINE_SOURCE_ASSET_ROOT,cook=process.env.SPEC_PRECOOK_MESHES;process.env.PIPELINE_SOURCE_ASSET_ROOT=f.root;process.env.SPEC_PRECOOK_MESHES='0';try{
 const s=sampleSpec();const material=s.materials[0].id;f.ref.slots.Material_0=material;s.objects=[{...s.objects[0],sourceMesh:f.ref,params:{}}];s.families=s.families.filter(v=>v.id===s.objects[0].family);s.families[0].generator=null;s.acceptance=[];
 expect(sceneSpecErrors(s)).toEqual([]);
 for(const p of [planSpecExport(s),await planSpecExportParallel(s,{concurrency:1,precookSurfaces:false})]){expect(p.report.errors).toEqual([]);expect(p.report.proxies).toHaveLength(0);expect(p.meshes[0].generator).toBe('GEN-SOURCE-MESH-01');expect(p.triangles).toBe(1);expect(getCachedMeshAsset(p.meshes[0])?.indices?.length).toBe(3);
 const dir=join(f.root,'out'+p.entities.length);mkdirSync(dir,{recursive:true});writeSpecPack(s,p,dir,{packageId:'019fb7ce-0000-7000-8000-000000000000',sourceKey:'source-scene',name:'source'});expect(readFileSync(join(dir,'cooked-stamp.ts'),'utf8')).toContain('export default');}
 }finally{if(old===undefined)delete process.env.PIPELINE_SOURCE_ASSET_ROOT;else process.env.PIPELINE_SOURCE_ASSET_ROOT=old;if(cook===undefined)delete process.env.SPEC_PRECOOK_MESHES;else process.env.SPEC_PRECOOK_MESHES=cook;rmSync(f.root,{recursive:true});}});
