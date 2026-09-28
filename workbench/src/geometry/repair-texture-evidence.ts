import {mkdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {ROOT,DATA,save,read,digest} from '../store';
import {textureChannels} from './texture-bundle';
/** 修复必须看到实际输入贴图，不能仅凭名称猜测像素内容和拉伸原因。 */
export async function repairTextureEvidence(scene:any,textures:any,folder:string,signal:AbortSignal){
 const output=join(folder,'texture-evidence');mkdirSync(output,{recursive:true});
 const selected=scene.textures.filter(t=>scene.program.materials.some(m=>m.textureId===t.id)).map(t=>({id:t.id,...textures[t.id]}));
 if(!selected.length)return {images:[],context:[]};
 save(join(output,'request.json'),{references:[],crops:[],textures:selected,contactSheet:true});
 const process=Bun.spawn([join(DATA,'reconstruction-env/bin/python'),join(ROOT,'src/geometry/asset-evidence.py'),output],{stdout:'pipe',stderr:'pipe',signal});
 const stderr=new Response(process.stderr).text();
 if(await process.exited!==0)throw Error('修复纹理证据失败：'+(await stderr).slice(-1200));
 const receipt=read(join(output,'receipt.json'));
 const context=scene.textures.filter(t=>selected.some(s=>s.id===t.id)).map(t=>({id:t.id,referenceIndex:t.referenceIndex,description:t.description,quad:t.quad,materials:scene.program.materials.filter(m=>m.textureId===t.id).map(m=>m.id),pixelSha256:receipt.images.find(i=>i.textureId===t.id).pixelSha256}));
 save(join(output,'context.json'),{method:'actual-texture-sheet-v1',context,imageSha256:digest(readFileSync(join(output,'textures.png'))),quality:'not-assessed'});
 return {images:[{path:join(output,'textures.png'),mime:'image/png'}],context};
}

/** 备选复用资源也必须展示像素；名称不能代替材质外观证据。 */
export async function repairReusableTextureEvidence(referenceSha256:string[],folder:string,signal:AbortSignal,libraryRoot?:string){
 const {textureCandidates,loadTextureResource}=await import('./texture-library');
 const resources=textureCandidates(referenceSha256,libraryRoot).slice(0,24).map(meta=>loadTextureResource(meta.id,referenceSha256,libraryRoot));
 if(!resources.length)return {images:[],context:[]};
 const output=join(folder,'reusable-texture-evidence');mkdirSync(output,{recursive:true});
 const selected=resources.map((r,i)=>({id:'asset-'+String(i+1).padStart(2,'0'),...r.texture}));
 save(join(output,'request.json'),{references:[],crops:[],textures:selected,contactSheet:true});
 const child=Bun.spawn([join(DATA,'reconstruction-env/bin/python'),join(ROOT,'src/geometry/asset-evidence.py'),output],{stdout:'pipe',stderr:'pipe',signal});
 const stderr=new Response(child.stderr).text();if(await child.exited!==0)throw Error('复用材质证据失败：'+(await stderr).slice(-1200));
 const receipt=read(join(output,'receipt.json'));
 const context=resources.map((r,i)=>({sheetId:selected[i].id,assetId:r.id,label:r.label,description:r.description,width:r.texture.width,height:r.texture.height,channels:textureChannels(r.texture),referenceSha256:r.referenceSha256,pixelSha256:receipt.images[i].pixelSha256,provenance:r.source,qualityAssessment:'未评估，仅为候选，不自动认定优于现有贴图'}));
 save(join(output,'context.json'),{method:'reusable-texture-sheet-v1',context,imageSha256:digest(readFileSync(join(output,'textures.png'))),quality:'not-assessed'});
 return {images:[{path:join(output,'textures.png'),mime:'image/png'}],context};
}
