import {reconstructionPython} from '../runtime-paths.mjs';
import {isCatalogId,loadCatalogResource} from './material-catalog';

export type ReferencePixels={referenceIndex:number;width:number;height:number};
/** 与实际贴图提取一致，使用EXIF转正后的原图尺寸。只读像素元数据。 */
export function referencePixelSizes(images:{path:string}[]):ReferencePixels[]{
 if(!images.length)return [];
 const p=Bun.spawnSync([reconstructionPython(),'-c','import json,sys; from PIL import Image,ImageOps; print(json.dumps([list(ImageOps.exif_transpose(Image.open(p)).size) for p in sys.argv[1:]]))',...images.map(i=>i.path)],{stdout:'pipe',stderr:'pipe'});
 if(p.exitCode)throw Error('无法读取参考图像素尺寸：'+new TextDecoder().decode(p.stderr).slice(-600));
 return JSON.parse(new TextDecoder().decode(p.stdout)).map(([width,height]:number[],i:number)=>({referenceIndex:i+1,width,height}));
}

/** 输出分辨率不等于源信息量；风险只供选材与预览，不打分、不拒绝已有输出。 */
export function textureSourceEvidence(scene:{textures:any[];textureReuse?:any[]},references:ReferencePixels[]){
 const reused=new Set((scene.textureReuse??[]).map(t=>t.textureId));
 return scene.textures.map(t=>{
  if(reused.has(t.id)){
   const binding=scene.textureReuse!.find(r=>r.textureId===t.id);
   if(isCatalogId(binding.assetId)){const r=loadCatalogResource(binding.assetId);return {id:t.id,sourceKind:'licensed-pbr-catalog',issues:[],assetId:r.id,source:r.source,scope:'来源为固定外部PBR素材，不是参考图裁切；quad只定位参考中的对应表面，适配性待真实画面验收'};}
   return {id:t.id,sourceKind:'verified-library',issues:[],scope:'实际复用像素不按当前裁切重新推算；通道与来源由资源库记录提供'};
  }
  const source=references.find(r=>r.referenceIndex===t.referenceIndex);
  if(!source)return {id:t.id,sourceKind:'unknown',issues:['缺少原图尺寸，不能把输出分辨率当作真实采样清晰度']};
  if(!Array.isArray(t.quad)||t.quad.length!==4||t.quad.some((p:any)=>!Array.isArray(p)||p.length!==2||p.some((v:any)=>!Number.isFinite(v)||v<0||v>1)))throw Error('纹理源证据坐标无效：'+t.id);
  const q=t.quad.map(([u,v]:number[])=>[u*(source.width-1),v*(source.height-1)]);
  const edges=q.map((p:number[],i:number)=>Math.hypot(p[0]-q[(i+1)%4][0],p[1]-q[(i+1)%4][1]));
  const minEdge=Math.min(...edges),maxUpscale=t.size/Math.max(minEdge,1e-9),issues:string[]=[];
  if(minEdge<32)issues.push('源片段至少一边不足32像素，细节信息有限');
  if(maxUpscale>4)issues.push('至少一个方向需放大超过4倍；增大输出尺寸不能恢复原图没有的细节');
  return {id:t.id,sourceKind:'reference-crop',referenceIndex:t.referenceIndex,sourcePixels:[source.width,source.height],sourceEdgePixels:edges.map(n=>+n.toFixed(2)),minimumSourceEdgePixels:+minEdge.toFixed(2),outputPixels:[t.size,t.size],maximumEdgeUpscale:+maxUpscale.toFixed(2),issues,scope:'原图四边像素采样估计；不是物理尺寸、材质评分或PBR认证。透视与遮挡仍须看图'};
 });
}

export const TEXTURE_SOURCE_GUIDANCE='referencePixelSizes 是真实原图像素尺寸。选择局部材质时估算归一化四边在原图中的像素长度，优先避免极窄条带或需要放大超过4倍的裁切；扩大输出到256/512不会增加细节。只有窄片段可用时如实记录局限，不能声称清楚，也不把扩大裁切到其他物体当作补细节。textureSourceEvidence 给出实际源采样风险，结合原图和贴图片段决定纹理尺度、几何细节与残留问题。该诊断不改变质量门槛、不推断新PBR通道，也不要求为满足像素数字重复生成。';
