// 当前生成器尚未导出发光纹理通道；消费者用已发布的同一张颜色纹理绑定到 Engine 原生通道。
// 仅窗面背景需要这项绑定，其余材质保留原始 PBR 契约。
export function bindWindowEmission(source:string){
 const anchor='baseColor: [...surface.baseColor],';
 if(!source.includes(anchor))throw Error('生成器材质模板变化，无法绑定窗面发光纹理');
 if(source.includes('window-emission-binding'))return source;
 return source.replace(anchor,`${anchor}
        // window-emission-binding
        ...(material.key.startsWith('windowview') && surface.baseColorTexture ? {
          emissiveTexture: {texture: AssetGuid.format(assetGuid(textureKeys.get(surfaceTextureKey(surface.baseColorTexture))!)),
            sampler: AssetGuid.format(assetGuid('sampler/surface-repeat'))},
        } : {}),`);
}
