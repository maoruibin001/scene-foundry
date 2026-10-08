import {readFileSync,mkdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {read,save,digest} from '../store';
import {reconstructionPython} from '../runtime-paths.mjs';
import {validTextureBundle} from './texture-bundle';
/** Offline provisioning. Inputs and source files remain preserved alongside the conversion receipt. */
export async function importPbrCatalog(requestFile:string,root:string){
 const request=read(requestFile);
 if(request.license!=='CC0-1.0'||!request.label?.trim()||!request.description?.trim()||!/^https:\/\//.test(request.assetUrl??'')||!Array.isArray(request.physicalSizeMeters)||request.physicalSizeMeters.length!==2||request.physicalSizeMeters.some((x:any)=>!Number.isFinite(x)||x<=0)||Object.keys(request.files??{}).sort().join()!=='Diffuse,arm,nor_gl')throw Error('PBR来源、许可、物理尺寸或完整通道声明无效');
 for(const f of Object.values(request.files) as any[])if(!/^https:\/\//.test(f.url??'')||!/^[a-f0-9]{64}$/.test(f.sha256??'')||digest(readFileSync(f.path))!==f.sha256)throw Error('PBR文件来源或摘要不符');
 mkdirSync(root,{recursive:true});const decoded=join(root,'decoded-'+digest(JSON.stringify(request))+'.json');
 const child=Bun.spawn([reconstructionPython(),join(import.meta.dirname,'import-pbr-pixels.py'),requestFile,decoded],{stdout:'pipe',stderr:'pipe'});
 const stderr=new Response(child.stderr).text();if(await child.exited!==0)throw Error('PBR通道转换失败：'+await stderr);
 const texture=read(decoded);if(!validTextureBundle(texture))throw Error('转换后的PBR通道无效');
 const input={label:request.label,description:request.description,referenceSha256:[],texture,source:{kind:'licensed-pbr-catalog',provider:'Poly Haven',assetId:request.assetId,assetUrl:request.assetUrl,license:request.license,licenseUrl:request.licenseUrl,authors:request.authors,physicalSizeMeters:request.physicalSizeMeters,files:Object.entries(request.files).map(([channel,f]:any)=>({channel,url:f.url,sha256:f.sha256,md5:f.md5})),conversion:{size:request.size,baseColor:'sRGB',normal:'OpenGL tangent-space, linear; area downsample then renormalize',metallicRoughness:'linear ARM: R=AO (not a GI simulation), G=roughness, B=metallic',method:'verified-pbr-import-v1'},quality:'not-assessed; material suitability must be checked against the current reference and Engine output'}};
 const id=digest(JSON.stringify(input)),path=join(root,id+'.json');if(existsSync(path)&&JSON.stringify(read(path))!==JSON.stringify({...input,id}))throw Error('已有固定素材内容冲突');save(path,{...input,id});
 return {id,path,label:input.label,source:input.source};
}
if(import.meta.main)console.log(JSON.stringify(await importPbrCatalog(process.argv[2],process.argv[3])));
