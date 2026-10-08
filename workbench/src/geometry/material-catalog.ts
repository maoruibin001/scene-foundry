import {join} from 'node:path';
import {DATA,read,digest} from '../store';
import {validTextureBundle,textureChannels} from './texture-bundle';
import pins from './material-catalog-manifest.json';

export const MATERIAL_CATALOG=join(DATA,'material-catalog');
/** Catalog pixels are source-pinned resources, never a previous scene/model cache. */
export function loadCatalogResource(id:string,root=MATERIAL_CATALOG,allowed:readonly string[]=pins.ids){
 if(!/^[a-f0-9]{64}$/.test(id)||!allowed.includes(id))throw Error('固定材质目录 ID 未登记');
 const resource=read(join(root,id+'.json')),{id:stored,...input}=resource;
 if(stored!==id||digest(JSON.stringify(input))!==id||!validTextureBundle(input.texture)||input.texture.colorSpace!=='srgb'||!input.texture.normalTexture||!input.texture.metallicRoughnessTexture||input.referenceSha256?.length!==0||input.source?.kind!=='licensed-pbr-catalog'||input.source?.license!=='CC0-1.0'||!Array.isArray(input.source.files)||input.source.files.map((f:any)=>f.channel).sort().join()!=='Diffuse,arm,nor_gl'||input.source.files.some((f:any)=>!/^https:\/\//.test(f.url??'')||!/^[a-f0-9]{64}$/.test(f.sha256??'')))throw Error('固定材质目录像素、来源或通道摘要不符');
 return resource;
}
export function catalogCandidates(root=MATERIAL_CATALOG,allowed:readonly string[]=pins.ids){
 return allowed.map(id=>{const {texture,...meta}=loadCatalogResource(id,root,allowed);return {...meta,width:texture.width,height:texture.height,colorSpace:texture.colorSpace,channels:textureChannels(texture),qualityAssessment:'外部素材，仅为表面候选；适配性由本次原图、实际预览与独立验收决定'};});
}
export const isCatalogId=(id:string)=>pins.ids.includes(id);
export const CATALOG_GUIDANCE='候选 source.kind=licensed-pbr-catalog 来自固定的外部CC0材质目录（Poly Haven），不是本图裁切，也不是历史场景缓存。可以通过现有textureReuse绑定成套颜色/法线/粗糙度通道；textures.quad仅标注原图里对应的物体表面，不会再次裁图。source.physicalSizeMeters记录素材覆盖的真实尺寸；据实际物体尺寸、纹理方向和预览选择UV，不能按名称盲用或把贴图放到不相干表面。颜色贴图是sRGB，法线与ARM是线性，ARM中G为粗糙度、B为金属度；roughness/metallic是乘数，成套图通常用1，非金属图B为0。保留照片原纹理；只有不适配或源信息不足的表面才替换。素材与本图颜色不同可克制调整color，但不能以全局调色替代本体细节。程序surfaceDetail=null可保留成套原通道；不要覆盖已验证法线。外部素材不证明原物体的真实用材，不新增几何/GI/透射。';
