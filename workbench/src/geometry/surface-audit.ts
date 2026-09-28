import {compileGeometryProgram} from './program';
/** 诊断真实 UV 与通道；照片固有光照和艺术表现须看图，脚本不捏造 PBR 贴图。 */
export function surfaceAudit(scene:any,textures:any={}){
 const compiled=compileGeometryProgram({...scene.program,materials:scene.program.materials.map((m:any)=>({...m,textureId:null}))}),rows:any[]=[];
 for(const mesh of compiled.meshes){
  const g=mesh.geometry,material=scene.program.materials.find((m:any)=>m.id===g.material?.id);if(!material)continue;
  const texture=textures[material.textureId],density:number[]=[],stretch:number[]=[];
  for(let n=0;n<g.indices.length;n+=3){
   const ids=g.indices.slice(n,n+3),p=ids.map((i:number)=>g.positions.slice(i*3,i*3+3)),uv=ids.map((i:number)=>g.uvs.slice(i*2,i*2+2)),a=p[1].map((v:number,k:number)=>v-p[0][k]),b=p[2].map((v:number,k:number)=>v-p[0][k]);
   const area=Math.hypot(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])/2;
   const ua=uv[1].map((v:number,k:number)=>v-uv[0][k]),ub=uv[2].map((v:number,k:number)=>v-uv[0][k]),uvArea=Math.abs(ua[0]*ub[1]-ua[1]*ub[0])/2;
   if(area<1e-12)continue;
   density.push(texture?Math.sqrt(uvArea*texture.width*texture.height/area):Math.sqrt(uvArea/area));
   const ratios=ids.map((_:any,k:number)=>{const j=(k+1)%3;return Math.hypot(uv[j][0]-uv[k][0],uv[j][1]-uv[k][1])/Math.max(1e-9,Math.hypot(...p[j].map((v:number,t:number)=>v-p[k][t])));});stretch.push(Math.max(...ratios)/Math.max(1e-9,Math.min(...ratios)));
  }
  density.sort((a,b)=>a-b);stretch.sort((a,b)=>a-b);const issues:string[]=[];
  if(texture?.metallicRoughnessTexture&&material.roughness===0)issues.push('粗糙度乘数为零，贴图变化被消除');
  if(texture&&stretch.some(n=>n>8))issues.push('部分三角面 UV 方向尺度差异超过8倍，需局部看图');
  if(texture&&density.some(n=>n<1))issues.push('存在退化 UV 或不足 1 像素/米的表面');
  rows.push({meshId:mesh.name,instanceId:mesh.entityId,materialId:material.id,textureId:material.textureId,channels:texture?['baseColor',...(texture.normalTexture?['normal']:[]),...(texture.metallicRoughnessTexture?['metallicRoughness']:[])]:[],medianDensity:density[Math.floor(density.length/2)]??null,densityUnit:texture?'pixels-per-meter':'uv-per-meter',p95Stretch:stretch[Math.floor(stretch.length*.95)]??null,issues});
 }
 const l=scene.lighting,lighting=l?{direct:l.intensity,ambient:l.ambientIntensity,localLights:(l.points??[]).length+(l.spots??[]).length,issues:[...(l.ambientIntensity>l.intensity*.8?['环境光相对直射较强，核对是否压平阴影层次']:[]),...(l.intensity===0&&!l.points?.length&&!l.spots?.length?['没有方向或局部入光，核对参考的光源方向']:[])]}:null;
 return {version:'surface-audit-v1',rows,lighting,scope:'诊断不计分、不自动放行；多通道只认实际提供并验证的纹理，照片颜色不等于去光照反射率'};
}
