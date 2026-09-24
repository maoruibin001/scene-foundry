// 同一街机的材质图集。矩形只作无损上传分区，原图与中文生成提示词独立存档。
export const ARCADE_MATERIALS={
 imageSha256:'e3c646ecd24aa8f5663f363ae4ee5f8dd0db94d925dd6f3211b2176d94d990e6',
 surfaceSha256:'943de5d9fa5946b09911219fe90688403e2ab17d3722d8fe1810f62d59509221',
 regions:[
  {name:'arcade',index:7,rect:[6,6,482,1018]},
  {name:'arcadeMarquee',index:11,rect:[502,6,1528,254]},
  {name:'arcadePanel',index:12,rect:[502,274,1528,498]},
  {name:'arcadeFront',index:13,rect:[502,521,1007,1018]},
  {name:'cabinetPaint',index:14,rect:[1027,521,1528,1018]},
 ]
} as const;
export function arcadeSurfaces(source:any){
 if(source.width!==1536||source.height!==1024)throw Error('街机图集尺寸不符');
 const bytes=Buffer.from(source.rgba8,'base64');
 if(bytes.length!==source.width*source.height*4)throw Error('街机图集像素不完整');
 return ARCADE_MATERIALS.regions.map(({name,index,rect:[x0,y0,x1,y1]})=>{
  const width=x1-x0,height=y1-y0,out=Buffer.alloc(width*height*4);
  for(let y=0;y<height;y++)bytes.copy(out,y*width*4,((y+y0)*source.width+x0)*4,((y+y0)*source.width+x1)*4);
  return {name,index,texture:{width,height,rgba8:out.toString('base64'),colorSpace:source.colorSpace}};
 });
}
