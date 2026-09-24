// 程序化微表面来自材料类型的几何模型，不从颜色亮暗臆测凹凸。
// 只提供织纹、细木纹和细小表面起伏；不声称恢复了参考图特定的磨损位置。
type Texture={width:number;height:number;rgba8:string;colorSpace:'linear'};
const cache=new Map<string,{normalTexture:Texture;metallicRoughnessTexture:Texture}>();
const TAU=Math.PI*2;
const periodic=(u:number,v:number)=>Math.sin(TAU*(3*u+2*v))*.5+Math.sin(TAU*(11*u-7*v))*.3+Math.sin(TAU*(29*u+17*v))*.2;
export function microSurface(kind:string){
 const key=kind==='roofWood'?'wood':kind;
 if(!['wood','leather','cloth','plaster','brick','carpet'].includes(key))return undefined;
 if(cache.has(key))return cache.get(key)!;
 const size=128,height=(u:number,v:number)=>{
  if(key==='cloth'){const warp=Math.cos(TAU*24*u),weft=Math.cos(TAU*24*v),over=Math.sin(TAU*12*u)*Math.sin(TAU*12*v);return .0015*(warp+weft+.45*over);}
  if(key==='wood')return .0007*Math.sin(TAU*43*u+.45*Math.sin(TAU*v))+.00025*periodic(u,v);
  if(key==='leather')return .00065*periodic(u,v)+.0002*Math.sin(TAU*47*u)*Math.sin(TAU*37*v);
  return (key==='carpet'?.0012:.0009)*periodic(u,v);
 };
 const normals=Buffer.alloc(size*size*4),roughness=Buffer.alloc(size*size*4),e=1/size,metres=key==='cloth'?.65:key==='wood'?1.6:1.8;
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const u=x/size,v=y/size,dx=(height(u+e,v)-height(u-e,v))/(2*e*metres),dy=(height(u,v+e)-height(u,v-e))/(2*e*metres),length=Math.hypot(dx,dy,1),at=(y*size+x)*4;
  for(const [i,n] of [-dx/length,-dy/length,1/length].entries())normals[at+i]=Math.round((n*.5+.5)*255);normals[at+3]=255;
  const noise=periodic(u,v),r=key==='cloth'?.94+noise*.04:key==='leather'?.64+noise*.17:key==='wood'?.79+noise*.11:.92+noise*.05;
  roughness.set([255,Math.round(Math.max(.35,Math.min(1,r))*255),0,255],at);
 }
 const texture=(b:Buffer):Texture=>({width:size,height:size,rgba8:b.toString('base64'),colorSpace:'linear'});
 const result={normalTexture:texture(normals),metallicRoughnessTexture:texture(roughness)};cache.set(key,result);return result;
}
