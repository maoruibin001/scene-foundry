/** 同一采样面、同一 UV 的材质通道必须成套复用，不能把颜色照片当作法线。 */
export type TexturePixels={width:number;height:number;rgba8:string;colorSpace:'srgb'|'linear'};
export type TextureBundle=TexturePixels&{normalTexture?:TexturePixels;metallicRoughnessTexture?:TexturePixels};
export const MATERIAL_CHANNELS=['normalTexture','metallicRoughnessTexture'] as const;
const pixelsValid=(t:any)=>{
 if(!t||!Number.isInteger(t.width)||!Number.isInteger(t.height)||t.width<=0||t.height<=0||t.width>1024||t.height>1024||!['srgb','linear'].includes(t.colorSpace)||typeof t.rgba8!=='string')return false;
 const bytes=t.width*t.height*4;if(t.rgba8.length!==Math.ceil(bytes/3)*4)return false;
 const decoded=Buffer.from(t.rgba8,'base64');return decoded.length===bytes&&decoded.toString('base64')===t.rgba8;
};
export function validTextureBundle(t:TextureBundle){
 if(!pixelsValid(t))return false;
 return MATERIAL_CHANNELS.every(channel=>{
  const map=t[channel];return map===undefined||(pixelsValid(map)&&map.colorSpace==='linear'&&map.width===t.width&&map.height===t.height&&MATERIAL_CHANNELS.every(key=>!(key in map)));
 });
}
export function textureChannels(t:TextureBundle){return ['baseColorTexture',...MATERIAL_CHANNELS.filter(key=>t[key]!==undefined)];}
export function textureSurface(t:TextureBundle){
 if(!validTextureBundle(t))throw Error('材质贴图通道像素、颜色空间或对齐关系无效');
 const {width,height,rgba8,colorSpace}=t;
 return {baseColorTexture:{width,height,rgba8,colorSpace},...Object.fromEntries(MATERIAL_CHANNELS.filter(key=>t[key]!==undefined).map(key=>[key,t[key]]))};
}
