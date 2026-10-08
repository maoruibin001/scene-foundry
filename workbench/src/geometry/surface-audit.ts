import {compileGeometryProgram} from './program';
import {surfaceDetailSize} from './surface-detail';
type Sample={value:number;area:number};
function percentile(samples:Sample[],q:number){
 if(!samples.length)return null;
 const sorted=[...samples].sort((a,b)=>a.value-b.value),target=sorted.reduce((n,s)=>n+s.area,0)*q;let sum=0;
 for(const s of sorted){sum+=s.area;if(sum>=target)return s.value;}
 return sorted.at(-1)!.value;
}
/** 诊断真实 UV 与通道；照片固有光照和艺术表现须看图，脚本不捏造 PBR 贴图。 */
export function surfaceAudit(scene:any,textures:any={}){
 const compiled=compileGeometryProgram({...scene.program,materials:scene.program.materials.map((m:any)=>({...m,textureId:null,surfaceDetail:null}))}),rows:any[]=[];
 for(const mesh of compiled.meshes){
  const g=mesh.geometry,material=scene.program.materials.find((m:any)=>m.id===g.material?.id);if(!material)continue;
  const texture=textures[material.textureId],size=texture?[texture.width,texture.height]:material.surfaceDetail?[surfaceDetailSize(material.surfaceDetail),surfaceDetailSize(material.surfaceDetail)]:null;
  const density:Sample[]=[],stretch:Sample[]=[];let degenerateUvTriangles=0;
  for(let n=0;n<g.indices.length;n+=3){
   const ids=g.indices.slice(n,n+3),p=ids.map((i:number)=>g.positions.slice(i*3,i*3+3)),uv=ids.map((i:number)=>g.uvs.slice(i*2,i*2+2)),a=p[1].map((v:number,k:number)=>v-p[0][k]),b=p[2].map((v:number,k:number)=>v-p[0][k]);
   const crossLength=Math.hypot(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]),area=crossLength/2;if(area<1e-12)continue;
   const ua=uv[1].map((v:number,k:number)=>(v-uv[0][k])*(size?.[k]??1)),ub=uv[2].map((v:number,k:number)=>(v-uv[0][k])*(size?.[k]??1));
   // 正交切平面到实际纹理像素的 Jacobian；不能用单位 UV 的三条边比值近似。
   const ax=Math.hypot(...a),bx=a.reduce((sum:number,v:number,k:number)=>sum+v*b[k],0)/ax,by=crossLength/ax;
   const u=ua[0]/ax,v=ua[1]/ax,w=(ub[0]-u*bx)/by,z=(ub[1]-v*bx)/by,det=u*z-v*w;
   const trace=u*u+v*v+w*w+z*z,maxEigen=(trace+Math.sqrt(Math.max(0,trace*trace-4*det*det)))/2;
   const max=Math.sqrt(maxEigen),min=max>0?Math.abs(det)/max:0;
   if(min<1e-9)degenerateUvTriangles++;
   density.push({value:Math.sqrt(Math.abs(det)),area});stretch.push({value:max>0?max/Math.max(min,1e-9):1e12,area});
  }
  const issues:string[]=[],p95Stretch=percentile(stretch,.95),medianDensity=percentile(density,.5);
  if(texture?.metallicRoughnessTexture&&material.roughness===0&&!material.surfaceDetail)issues.push('粗糙度乘数为零，贴图变化被消除');
  if(size&&p95Stretch!==null&&p95Stretch>8)issues.push('实际贴图在表面两个方向的尺度差异超过8倍，需局部看图');
  if(size&&(degenerateUvTriangles>0||density.some(n=>n.value<1)))issues.push('存在退化 UV 或不足 1 像素/米的表面');
  rows.push({meshId:mesh.name,instanceId:mesh.entityId,materialId:material.id,textureId:material.textureId,textureSize:size,generatedChannels:material.surfaceDetail?['baseColor','normal','metallicRoughness']:[],channelSource:material.surfaceDetail?'explicit-procedural-declaration-not-measured':texture?'verified-texture':'uniform',channels:texture?['baseColor',...(texture.normalTexture?['normal']:[]),...(texture.metallicRoughnessTexture?['metallicRoughness']:[])]:[],medianDensity,densityUnit:size?'pixels-per-meter':'uv-per-meter',p95Stretch,degenerateUvTriangles,issues});
 }
 const l=scene.lighting,lighting=l?{direct:l.intensity,ambient:l.ambientIntensity,localLights:(l.points??[]).length+(l.spots??[]).length,issues:[...(l.ambientIntensity>l.intensity*.8?['环境光相对直射较强，核对是否压平阴影层次']:[]),...(l.intensity===0&&!l.points?.length&&!l.spots?.length?['没有方向或局部入光，核对参考的光源方向']:[])]}:null;
 return {version:'surface-audit-v2',rows,lighting,scope:'诊断不计分、不自动放行；按真实像素比例和世界尺寸计算，分位数以三角形面积加权；声明不是渲染成功证据，照片颜色不等于去光照反射率'};
}
