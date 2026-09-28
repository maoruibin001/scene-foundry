import {crossTaskReuse} from '../reuse-mode';
import {join} from 'node:path';
import {existsSync,mkdirSync,readFileSync,readdirSync} from 'node:fs';
import {DATA,digest,read,save} from '../store';
import type {Texture} from './program';
import {validTextureBundle,textureChannels} from './texture-bundle';
export type TextureResource={id:string;label:string;description:string;referenceSha256:string[];texture:Texture;source:any};
export const TEXTURE_LIBRARY=join(DATA,'texture-library');
const validTexture=validTextureBundle;
const sameReferences=(a:string[],b:string[])=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
export function importTextureResource(input:Omit<TextureResource,'id'>,root=TEXTURE_LIBRARY){
 if(!validTexture(input.texture)||!input.label?.trim()||!input.description?.trim()||!input.referenceSha256.length||input.referenceSha256.some(s=>!/^[a-f0-9]{64}$/.test(s))||!input.source)throw Error('可复用材质缺少有效像素、描述或来源');
 const id=digest(JSON.stringify(input));mkdirSync(root,{recursive:true});save(join(root,id+'.json'),{...input,id});return id;
}
export function loadTextureResource(id:string,references:string[],root=TEXTURE_LIBRARY):TextureResource{
 if(!/^[a-f0-9]{64}$/.test(id))throw Error('资源库材质 ID 无效');const resource=read(join(root,id+'.json')),{id:stored,...input}=resource;
 if(stored!==id||digest(JSON.stringify(input))!==id||!validTexture(resource.texture)||!sameReferences(resource.referenceSha256,references))throw Error('资源库材质损坏或参考图来源不匹配');return resource;
}
export function textureCandidates(references:string[],root=TEXTURE_LIBRARY){
 if(!references.length||!existsSync(root))return [];
 return readdirSync(root).filter(f=>/^[a-f0-9]{64}\.json$/.test(f)).slice(0,512).flatMap(f=>{try{const {texture,...meta}=loadTextureResource(f.slice(0,-5),references,root);return [{...meta,width:texture.width,height:texture.height,colorSpace:texture.colorSpace,channels:textureChannels(texture),qualityAssessment:'待本次画面验收'}];}catch{return [];}}).slice(0,64);
}
export function resolveTextureReuse(scene:{textures:{id:string}[];textureReuse?:{textureId:string;assetId:string;reason:string}[]},references:string[],root=TEXTURE_LIBRARY){
 const ids=new Set<string>();return (scene.textureReuse??[]).map(binding=>{
  if(ids.has(binding.textureId)||!scene.textures.some(t=>t.id===binding.textureId)||!binding.reason?.trim())throw Error('材质复用绑定重复或无效');ids.add(binding.textureId);
  const resource=loadTextureResource(binding.assetId,references,root);return {...binding,texture:resource.texture,source:resource.source,label:resource.label,referenceSha256:resource.referenceSha256};
 });
}

export function jobTextureCandidates(job:any,references:string[],root=TEXTURE_LIBRARY){return crossTaskReuse(job)?textureCandidates(references,root):[];}
export function jobTextureReuse(job:any,scene:Parameters<typeof resolveTextureReuse>[0],references:string[],root=TEXTURE_LIBRARY){
 if(!crossTaskReuse(job)&&(scene.textureReuse??[]).length)throw Error('本次从头生成禁用跨任务材质复用，请从原始参考图重新提取纹理');
 return resolveTextureReuse(scene,references,root);
}
