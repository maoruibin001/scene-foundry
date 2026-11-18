import {createHash} from 'node:crypto';
import {readFileSync,realpathSync,statSync} from 'node:fs';
import {isAbsolute,relative,resolve} from 'node:path';
import type {MeshAsset} from '@forgeax/engine/types';

/** Operator-admitted local source library; uploaded specs cannot choose a root. */
export type SourceMeshRef={metadata:string;binary:string;metadataSha256:string;binarySha256:string;slots:Record<string,string>};
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
export function sourceMeshErrors(s:SourceMeshRef):string[]{
 if(!s||typeof s!=='object')return ['sourceMesh must be an object'];
 const errors:string[]=[];
 for(const k of ['metadata','binary'] as const)if(typeof s[k]!=='string'||!s[k]||s[k].length>400||isAbsolute(s[k])||s[k].split(/[\\/]/).some(p=>p==='..'||p===''))errors.push('sourceMesh.'+k+' must be a relative library path');
 for(const k of ['metadataSha256','binarySha256'] as const)if(!/^[a-f0-9]{64}$/.test(s[k]))errors.push('sourceMesh.'+k+' must be SHA256');
 if(!s.slots||typeof s.slots!=='object'||Array.isArray(s.slots)||!Object.keys(s.slots).length||Object.keys(s.slots).length>96)errors.push('sourceMesh.slots required');
 return errors;
}
function admitted(root:string,path:string){
 const base=realpathSync(root),target=realpathSync(resolve(base,path)),rel=relative(base,target);
 if(rel==='..'||rel.startsWith('../')||isAbsolute(rel)||!statSync(target).isFile())throw Error('SOURCE_MESH_OUTSIDE_LIBRARY');
 return target;
}
/** Reads the existing ForgeAX baked MeshAsset format without changing vertex bytes.
 * Unknown layouts, changed inputs and out-of-range indices fail; never proxy silently. */
export function loadSourceMesh(s:SourceMeshRef,root=process.env.PIPELINE_SOURCE_ASSET_ROOT):MeshAsset{
 const errors=sourceMeshErrors(s);if(errors.length)throw Error(errors.join('; '));
 if(!root)throw Error('SOURCE_MESH_LIBRARY_NOT_CONFIGURED');
 const metaPath=admitted(root,s.metadata),binPath=admitted(root,s.binary);
 if(statSync(metaPath).size>8*1024*1024||statSync(binPath).size>256*1024*1024)throw Error('SOURCE_MESH_SIZE_LIMIT');
 const mb=readFileSync(metaPath),bb=readFileSync(binPath);
 if(sha(mb)!==s.metadataSha256||sha(bb)!==s.binarySha256)throw Error('SOURCE_MESH_HASH_MISMATCH');
 const m=JSON.parse(mb.toString('utf8'));
 if(!m.layout||!m.rest||m.rest.kind!=='mesh')throw Error('SOURCE_MESH_FORMAT');
 const types:Record<string,any>={Float32Array,Uint32Array,Uint16Array,Uint8Array};
 const ab=bb.buffer.slice(bb.byteOffset,bb.byteOffset+bb.byteLength);
 const out:any={kind:'mesh',attributes:{},submeshes:structuredClone(m.rest.submeshes??[]),materialSlots:structuredClone(m.rest.materialSlots??[])};
 for(const [key,l] of Object.entries(m.layout) as [string,any][]){
  if(!['vertices','indices','aabb'].includes(key)&&!/^attributes\.(position|normal|tangent|uv|uv[0-3]|color|joints|weights)$/.test(key))throw Error('SOURCE_MESH_UNKNOWN_LAYOUT:'+key);
  const T=types[l.type];
  if(!T||!Number.isSafeInteger(l.offset)||!Number.isSafeInteger(l.length)||l.offset<0||l.length<0||l.offset%T.BYTES_PER_ELEMENT||l.offset+l.length*T.BYTES_PER_ELEMENT>ab.byteLength)throw Error('SOURCE_MESH_INVALID_SLICE');
  const v=new T(ab,l.offset,l.length);if(key.startsWith('attributes.'))out.attributes[key.slice(11)]=v;else out[key]=v;
 }
 const pos=out.attributes.position,indices=out.indices;
 if(!(pos instanceof Float32Array)||!pos.length||pos.length%3||!(indices instanceof Uint16Array||indices instanceof Uint32Array)||indices.length%3||!out.aabb||out.aabb.length!==6)throw Error('SOURCE_MESH_INVALID_GEOMETRY');
 for(const n of pos)if(!Number.isFinite(n))throw Error('SOURCE_MESH_NONFINITE');
 for(const n of indices)if(n>=pos.length/3)throw Error('SOURCE_MESH_INDEX_RANGE');
 for(const n of out.aabb)if(!Number.isFinite(n))throw Error('SOURCE_MESH_INVALID_AABB');
 for(const slot of out.materialSlots){if(!s.slots[slot.slotName])throw Error('SOURCE_MESH_MATERIAL_UNBOUND:'+slot.slotName);delete slot.material;}
 const slotCount=out.materialSlots.length;
 for(const sub of out.submeshes){if(sub.topology!=='triangle-list'||!Number.isSafeInteger(sub.indexOffset)||!Number.isSafeInteger(sub.indexCount)||sub.indexOffset<0||sub.indexCount<0||sub.indexOffset+sub.indexCount>indices.length||!Number.isSafeInteger(sub.materialSlot)||sub.materialSlot<0||sub.materialSlot>=slotCount)throw Error('SOURCE_MESH_INVALID_SUBMESH');}
 return out;
}
