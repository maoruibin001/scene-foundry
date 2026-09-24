import {basis,type Camera} from './camera-fit';
import {compileGeometryProgram,type Texture} from './program';
import type {SceneInput} from './scene-contract';

export const VISIBILITY_METHOD='opaque-geometry-visibility-v1';
export const VISIBILITY_PROMPT='若输入有geometryVisibility，最后追加的是对应机位的彩色编号几何诊断图：原图在前、actualFrameNames实际截图居中、diagnosticImages诊断图最后。数字从palette映射到真实实例和模板；visibleParts给出主要可见部件、材质与归一化范围，instanceOcclusions给出不同物体的前后遮挡，nearestPartOcclusions也包含同一物体内部层次。对照真实截图和原图，把主要差距落实到实际实例、部件与材料；不要只看包围盒猜谁挡住了谁。诊断图不包含光照和材质外观，不是新的目标图；透明表面被排除、面积只是低分辨率几何采样。正常表皮盖住底层、家具遮住地面都是合理现象，不能把遮挡量直接当成错误或自动按面积选择修改。结合参考图判断可见桌面、通道、开口和前中后景应有的关系，保留正确遮挡。';
type Point=[number,number,number];
type Mesh={name:string;entityId:string;geometry:{positions:number[];indices:number[]}};
const edge=(a:Point,b:Point,x:number,y:number)=>(b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(x-a[0]);

/** 裁剪近/远平面后光栅化，保留每像素最近两个不同部件；不把包围盒当作可见表面。 */
export function rasterVisibility(meshes:Mesh[],camera:Camera,width=320,height=180,near=.1,far=1000){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<8||height<8||width>640||height>640)throw Error('可见性诊断分辨率无效');
 const size=width*height,front=new Int32Array(size).fill(-1),back=new Int32Array(size).fill(-1),depth=new Float64Array(size).fill(Infinity),second=new Float64Array(size).fill(Infinity);
 const objectFront=new Int32Array(size).fill(-1),other=new Int32Array(size).fill(-1),objectDepth=new Float64Array(size).fill(Infinity),otherDepth=new Float64Array(size).fill(Infinity);
 const b=basis(camera),t=Math.tan(camera.fov/2),aspect=width/height;
 const clip=(input:Point[],z:number,keepGreater:boolean)=>{const result:Point[]=[];for(let i=0;i<input.length;i++){
  const a=input[i],c=input[(i+1)%input.length],inside=(p:Point)=>keepGreater?p[2]>=z:p[2]<=z,aa=inside(a),cc=inside(c);
  if(aa)result.push(a);if(aa!==cc){const f=(z-a[2])/(c[2]-a[2]);result.push([a[0]+f*(c[0]-a[0]),a[1]+f*(c[1]-a[1]),z]);}
 }return result;};
 const insert=(p:number,z:number,id:number)=>{
  const group=meshes[id].entityId,at=objectFront[p];
  if(at>=0&&meshes[at].entityId===group){if(z<objectDepth[p]){objectDepth[p]=z;objectFront[p]=id;}}
  else if(z<objectDepth[p]-1e-8){otherDepth[p]=objectDepth[p];other[p]=at;objectDepth[p]=z;objectFront[p]=id;}
  else if(z<otherDepth[p]-1e-8){otherDepth[p]=z;other[p]=id;}
  if(front[p]===id){depth[p]=Math.min(depth[p],z);return;}
  if(z<depth[p]-1e-8){second[p]=depth[p];back[p]=front[p];depth[p]=z;front[p]=id;}
  else if(z<second[p]-1e-8){second[p]=z;back[p]=id;}
 };
 for(let id=0;id<meshes.length;id++){
  const {positions,indices}=meshes[id].geometry,points:Point[]=[];
  for(let i=0;i<positions.length;i+=3){const d=positions.slice(i,i+3).map((v,k)=>v-camera.position[k]),dot=(axis:number[])=>axis.reduce((s,v,k)=>s+v*d[k],0);points.push([dot(b.right),dot(b.up),dot(b.forward)]);}
  for(let i=0;i<indices.length;i+=3){
   const input=[points[indices[i]],points[indices[i+1]],points[indices[i+2]]];
   const polygon=clip(clip(input,near,true),far,false);if(polygon.length<3)continue;
   const projected=polygon.map(([x,y,z])=>[(.5+x/(z*t*aspect*2))*width,(.5-y/(z*t*2))*height,1/z] as Point);
   for(let j=1;j<projected.length-1;j++){
    const a=projected[0],c=projected[j],d=projected[j+1],area=edge(a,c,d[0],d[1]);
    // Engine 默认背面剔除；双面网格由编译器生成反向三角形。
    if(area>=-1e-10)continue;
    const x0=Math.max(0,Math.ceil(Math.min(a[0],c[0],d[0])-.5)),x1=Math.min(width-1,Math.floor(Math.max(a[0],c[0],d[0])-.5));
    const y0=Math.max(0,Math.ceil(Math.min(a[1],c[1],d[1])-.5)),y1=Math.min(height-1,Math.floor(Math.max(a[1],c[1],d[1])-.5));
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
     const u=edge(c,d,x+.5,y+.5)/area,v=edge(d,a,x+.5,y+.5)/area,w=1-u-v;if(u< -1e-9||v< -1e-9||w< -1e-9)continue;
     insert(y*width+x,1/(u*a[2]+v*c[2]+w*d[2]),id);
    }
   }
  }
 }
 return {width,height,front,back,depth,second,objectFront,other,objectDepth,otherDepth};
}

/** 仅诊断不透明几何；不会产生质量得分、失败门槛或删除建议。 */
export function sceneVisibility(source:SceneInput,textures:Record<string,Texture>={}){
 const compiled=compileGeometryProgram({...source.program,materials:source.program.materials.map(m=>({...m,textureId:null}))});
 const excluded=source.program.materials.filter(m=>{
  if(m.color[3]<.95)return true;if(!m.textureId)return false;const texture=textures[m.textureId];if(!texture)return true;
  const bytes=Buffer.from(texture.rgba8,'base64');for(let i=3;i<bytes.length;i+=4)if(bytes[i]<255)return true;return false;
 }).map(m=>m.id);
 const allMeta=source.program.instances.flatMap(instance=>source.program.templates.find(t=>t.id===instance.template)!.parts.map(part=>({instanceId:instance.id,label:instance.label,templateId:instance.template,partId:part.id,materialId:part.material,textureId:source.program.materials.find(m=>m.id===part.material)!.textureId})));
 if(allMeta.length!==compiled.meshes.length||allMeta.some((m,i)=>compiled.meshes[i].name!==m.instanceId+'__'+m.partId+'__'+m.materialId))throw Error('编译网格顺序与可见性身份不一致');
 const kept=allMeta.map((m,i)=>({m,mesh:compiled.meshes[i]})).filter(x=>!excluded.includes(x.m.materialId));
 const meshes=kept.map(x=>x.mesh),metadata=kept.map(x=>x.m),palette=source.program.instances.map((i,n)=>({number:n+1,instanceId:i.id,label:i.label,templateId:i.template}));
 const views=source.cameras.map(camera=>{
  const raster=rasterVisibility(meshes,camera),count=raster.width*raster.height;
  const stats=new Map<number,{pixels:number;sumX:number;sumY:number;rect:number[]}>(),pairs=new Map<string,number>(),objectPairs=new Map<string,number>();
  for(let p=0;p<count;p++){
   const id=raster.front[p];if(id<0)continue;const x=p%raster.width,y=Math.floor(p/raster.width),s=stats.get(id)??{pixels:0,sumX:0,sumY:0,rect:[x,y,x+1,y+1]};
   s.pixels++;s.sumX+=x+.5;s.sumY+=y+.5;s.rect=[Math.min(s.rect[0],x),Math.min(s.rect[1],y),Math.max(s.rect[2],x+1),Math.max(s.rect[3],y+1)];stats.set(id,s);
   const behind=raster.back[p];if(behind>=0&&raster.second[p]-raster.depth[p]>.01){const key=id+':'+behind;pairs.set(key,(pairs.get(key)??0)+1);}
   const other=raster.other[p];if(other>=0&&raster.otherDepth[p]-raster.objectDepth[p]>.01){const key=raster.objectFront[p]+':'+other;objectPairs.set(key,(objectPairs.get(key)??0)+1);}
  }
  const rect=(r:number[])=>r.map((v,k)=>+(v/(k%2?raster.height:raster.width)).toFixed(4));
  const parts=[...stats].map(([id,s])=>({...metadata[id],pixels:s.pixels,frameFraction:+(s.pixels/count).toFixed(5),rect:rect(s.rect)})).sort((a,b)=>b.pixels-a.pixels);
  const instances=palette.map(item=>{
   const visible=parts.filter(p=>p.instanceId===item.instanceId),pixels=visible.reduce((n,p)=>n+p.pixels,0);
   return {...item,pixels,frameFraction:+(pixels/count).toFixed(5),visibleParts:visible.slice(0,6)};
  }).filter(i=>i.pixels>0).sort((a,b)=>b.pixels-a.pixels);
  const summarize=(counts:Map<string,number>)=>[...counts].sort((a,b)=>b[1]-a[1]).slice(0,24).map(([key,pixels])=>{const [a,b]=key.split(':').map(Number);return {front:metadata[a],behind:metadata[b],pixels,frameFraction:+(pixels/count).toFixed(5)};});
  const occlusions=summarize(pairs),instanceOcclusions=summarize(objectPairs);
  const labels=Uint16Array.from(raster.front,id=>id<0?0:palette.find(p=>p.instanceId===metadata[id].instanceId)!.number);
  return {cameraName:camera.name,referenceIndex:camera.referenceIndex,width:raster.width,height:raster.height,parts,instances,occlusions,instanceOcclusions,labelsBase64:Buffer.from(labels.buffer).toString('base64')};
 });
 return {method:VISIBILITY_METHOD,source:'实际编译网格与冻结相机；不是 Engine 截图分割',limitations:'320×180 像素中心采样，近面0.1米，远面1000米，按背面剔除；分别统计最近不同部件和最近不同实例的两层深度。透明材质、含透明像素或缺失像素的纹理不参与遮挡；不模拟光照、纹理颜色、后处理或更深层可见性。共面交界的部件身份可能歧义，小面积或相互重叠的编号可能省略。面积仅辅助定位，不能判定错误、删除物体或代替质量评分。',excludedMaterials:excluded,palette,views};
}

export function visibilityContext(report:ReturnType<typeof sceneVisibility>){
 const identity=(m:{instanceId:string;partId:string})=>[report.palette.find(p=>p.instanceId===m.instanceId)!.number,m.partId];
 const pairs=(list:ReturnType<typeof sceneVisibility>['views'][number]['occlusions'])=>list.map(p=>({front:identity(p.front),behind:identity(p.behind),frameFraction:p.frameFraction}));
 return {...report,views:report.views.map(v=>({cameraName:v.cameraName,referenceIndex:v.referenceIndex,width:v.width,height:v.height,
  instances:v.instances.map(i=>({number:i.number,frameFraction:i.frameFraction,visibleParts:i.frameFraction<.008?[]:i.visibleParts.slice(0,3).map(p=>({partId:p.partId,materialId:p.materialId,frameFraction:p.frameFraction,rect:p.rect}))})),
  nearestPartOcclusions:pairs(v.occlusions.slice(0,6)),instanceOcclusions:pairs(v.instanceOcclusions.slice(0,12)),
 }))};
}
