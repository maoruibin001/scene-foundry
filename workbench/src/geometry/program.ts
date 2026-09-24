import {MeshBuilder,triangulatePolygon,norm,type V} from './mesh';
import {RANGE} from './constraints';
import {distributedPoses,type Distribution} from './distribution';

// 数据契约只描述构造操作，不枚举家具、建筑或其他物体类别。
export type PrimitiveShape =
 | {type:'box';size:V;radius:number}
 | {type:'lathe';profile:number[][];segments:number;arc?:number|null;start?:number|null}
 | {type:'extrusion';outline:number[][];depth:number}
 | {type:'tube';from:V;to:V;radius:number;endRadius:number;segments:number}
 | {type:'grid';points:V[];rows:number;columns:number;doubleSided:boolean};
export type Shape=PrimitiveShape|({type:'scatter';element:PrimitiveShape}&Distribution);
export type Pose={position:V;rotation:V;scale:V};
export type Material={id:string;color:[number,number,number,number];roughness:number;metallic:number;textureId:string|null};
export type Part=Pose&{id:string;material:string;shape:Shape;uvScale?:[number,number]};
export type GeometryProgram={
 version:'geometry-v1';name:string;materials:Material[];
 templates:{id:string;parts:Part[]}[];
 instances:(Pose&{id:string;label:string;template:string;requirementIds:string[]})[];
};
export type Texture={width:number;height:number;rgba8:string;colorSpace:'srgb'|'linear'};
export const GEOMETRY_LIMITS={templates:64,instances:256,partsPerTemplate:128,expandedParts:2048,triangles:250000,materials:128,segments:64,profilePoints:128,gridPoints:1024};
function assert(ok:unknown,message:string):asserts ok{if(!ok)throw Error(message);}
const finite=(n:unknown,min:number,max:number)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
const vector=(v:any,min=-100,max=100)=>Array.isArray(v)&&v.length===3&&v.every(n=>finite(n,min,max));
const id=(s:any)=>typeof s==='string'&&/^[a-zA-Z][a-zA-Z0-9_-]{0,55}$/.test(s);
function unique(list:any[],name:string){const ids=new Set<string>();for(const item of list){assert(id(item.id)&&!ids.has(item.id),name+' ID 无效或重复');ids.add(item.id);}return ids;}
function pose(p:Pose){assert(vector(p.position)&&vector(p.rotation,-Math.PI*2,Math.PI*2)&&vector(p.scale,.001,100),'变换必须为有限三维坐标、弧度角和正缩放');}
function outline(points:number[][]){
 assert(Array.isArray(points)&&points.length>=3&&points.length<=128&&points.every(p=>Array.isArray(p)&&p.length===2&&p.every(n=>finite(n,-100,100))),'挤出轮廓无效');
 const cross=(a:number[],b:number[],c:number[])=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
 const between=(a:number[],b:number[],p:number[])=>Math.abs(cross(a,b,p))<1e-9&&p.every((n,k)=>n>=Math.min(a[k],b[k])-1e-9&&n<=Math.max(a[k],b[k])+1e-9);
 for(let i=0;i<points.length;i++){
  const a=points[i],b=points[(i+1)%points.length];assert(Math.hypot(b[0]-a[0],b[1]-a[1])>1e-6,'轮廓含零长度边');
  for(let j=i+1;j<points.length;j++){
   if(j===i+1||(i===0&&j===points.length-1))continue;
   const c=points[j],d=points[(j+1)%points.length];
   assert(!(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0)&&![c,d].some(p=>between(a,b,p))&&![a,b].some(p=>between(c,d,p)),'轮廓自交');
  }
 }
 triangulatePolygon(points);
}
function shapeTriangles(s:Shape){
 switch(s?.type){
  case 'scatter':{
   assert(Number.isInteger(s.count)&&s.count>=1&&s.count<=RANGE.scatterMax,'散布数量无效');
   assert(Number.isInteger(s.seed)&&s.seed>=0&&s.seed<=0xffffffff,'散布种子须为32位无符号整数');
   assert(['box','ellipsoid'].includes(s.volume)&&vector(s.size,RANGE.positiveMin,RANGE.max)&&vector(s.rotationRange,0,Math.PI*2),'散布空间或旋转范围无效');
   assert(Array.isArray(s.scaleRange)&&s.scaleRange.length===2&&s.scaleRange.every(v=>finite(v,RANGE.positiveMin,RANGE.max))&&s.scaleRange[0]<=s.scaleRange[1],'散布缩放范围无效');
   assert(s.element&&['box','lathe','extrusion','tube','grid'].includes(s.element.type),'散布元素须为单个基础构造，不允许嵌套散布');
   return s.count*shapeTriangles(s.element);
  }
  case 'box':assert(vector(s.size,.001,100)&&finite(s.radius,0,Math.min(...s.size)/2),'箱体尺寸或圆角无效');return s.radius?432:12;
  case 'lathe':{
   assert((s.arc==null||finite(s.arc,.001,Math.PI*2))&&(s.start==null||finite(s.start,-Math.PI*2,Math.PI*2)),'旋转曲面的局部弧度无效');
   assert(Number.isInteger(s.segments)&&s.segments>=3&&s.segments<=GEOMETRY_LIMITS.segments,'旋转曲面分段无效');
   assert(Array.isArray(s.profile)&&s.profile.length>=2&&s.profile.length<=GEOMETRY_LIMITS.profilePoints&&s.profile.every(p=>Array.isArray(p)&&p.length===2&&finite(p[0],0,100)&&finite(p[1],-100,100)),'旋转轮廓无效');
   assert(s.profile.some(p=>p[0]>0),'旋转轮廓没有半径');return (s.profile.length-1)*s.segments*2;
  }
  case 'extrusion':outline(s.outline);assert(finite(s.depth,RANGE.positiveMin,RANGE.max),'挤出厚度无效：应为 '+RANGE.positiveMin+'..'+RANGE.max);return 4*s.outline.length-4;
  case 'tube':assert(vector(s.from)&&vector(s.to)&&Math.hypot(...s.from.map((n,k)=>n-s.to[k]))>1e-6&&finite(s.radius,.001,100)&&finite(s.endRadius,0,100)&&Number.isInteger(s.segments)&&s.segments>=3&&s.segments<=GEOMETRY_LIMITS.segments,'连接结构端点、半径或分段无效');return s.segments*4;
  case 'grid':{
   assert(Number.isInteger(s.rows)&&Number.isInteger(s.columns)&&s.rows>=2&&s.columns>=2&&s.rows*s.columns<=GEOMETRY_LIMITS.gridPoints,'曲面网格行列无效：rows 和 columns 须为不小于 2 的整数，乘积不超过 '+GEOMETRY_LIMITS.gridPoints);
   assert(Array.isArray(s.points),'曲面网格 points 须为三维坐标数组');
   assert(s.points.length===s.rows*s.columns,'曲面网格点数不符：rows='+s.rows+'、columns='+s.columns+'，应有 '+s.rows*s.columns+' 个点，实际 '+s.points.length+' 个；请保留预期拓扑并修正点数');
   const invalid=s.points.findIndex(p=>!vector(p));assert(invalid<0,'曲面网格 points['+invalid+'] 无效：须为 -100..100 内的三个有限坐标');
   assert(typeof s.doubleSided==='boolean','曲面网格 doubleSided 须为布尔值');
   return (s.rows-1)*(s.columns-1)*2*(s.doubleSided?2:1);
  }
  default:throw Error('不支持的几何构造操作');
 }
}
export function validateGeometryProgram(program:GeometryProgram,requirementIds?:string[]){
 const p=program;
 assert(p?.version==='geometry-v1'&&typeof p.name==='string'&&p.name.trim().length>0,'通用几何版本或名称无效');
 for(const [key,max] of [['materials',GEOMETRY_LIMITS.materials],['templates',GEOMETRY_LIMITS.templates],['instances',GEOMETRY_LIMITS.instances]] as const)assert(Array.isArray(p[key])&&p[key].length>0&&p[key].length<=max,key+' 数量超出契约');
 const materials=unique(p.materials,'材质'),templates=unique(p.templates,'模板');unique(p.instances,'实例');
 for(const m of p.materials)assert(Array.isArray(m.color)&&m.color.length===4&&m.color.every(n=>finite(n,0,1))&&finite(m.roughness,0,1)&&finite(m.metallic,0,1)&&(m.textureId===null||id(m.textureId)),'PBR 材质无效');
 const estimates=new Map<string,number>();
 for(const t of p.templates){
  assert(Array.isArray(t.parts)&&t.parts.length>0&&t.parts.length<=GEOMETRY_LIMITS.partsPerTemplate,'模板部件数量无效');unique(t.parts,'部件');let estimate=0;
  for(const part of t.parts){pose(part);assert(materials.has(part.material),'部件引用不存在的材质');if(part.uvScale!==undefined)assert(Array.isArray(part.uvScale)&&part.uvScale.length===2&&part.uvScale.every(n=>finite(n,.01,100)),'贴图比例无效');try{estimate+=shapeTriangles(part.shape);}catch(error){throw Error('模板 '+t.id+' / 部件 '+part.id+'：'+(error instanceof Error?error.message:String(error)));}}estimates.set(t.id,estimate);
 }
 let triangles=0,parts=0;
 for(const i of p.instances){pose(i);assert(templates.has(i.template),'实例引用不存在的模板');assert(typeof i.label==='string'&&i.label.trim().length>0,'实例缺少语义名称');assert(Array.isArray(i.requirementIds)&&new Set(i.requirementIds).size===i.requirementIds.length&&i.requirementIds.every(r=>typeof r==='string'&&(!requirementIds||requirementIds.includes(r))),'实例引用未知需求');triangles+=estimates.get(i.template)!;parts+=p.templates.find(t=>t.id===i.template)!.parts.length;}
 assert(parts<=GEOMETRY_LIMITS.expandedParts&&triangles<=GEOMETRY_LIMITS.triangles,'展开后的几何超过部件或三角形预算：展开部件 '+parts+'/'+GEOMETRY_LIMITS.expandedParts+'；估算三角形 '+triangles+'/'+GEOMETRY_LIMITS.triangles+'；散布数量和模板实例数均计入展开预算，请减少本轮新增细节，保留既有关键结构。');
 return {triangles,parts};
}
function rotate(v:V,r:V):V{
 const [a,b,c]=r,[x,y,z]=v,ya=y*Math.cos(a)-z*Math.sin(a),za=y*Math.sin(a)+z*Math.cos(a),xb=x*Math.cos(b)+za*Math.sin(b),zb=-x*Math.sin(b)+za*Math.cos(b);
 return [xb*Math.cos(c)-ya*Math.sin(c),xb*Math.sin(c)+ya*Math.cos(c),zb];
}
export function transformPoint(v:V,p:Pose):V{return rotate(v.map((n,k)=>n*p.scale[k]) as V,p.rotation).map((n,k)=>n+p.position[k]) as V;}
function transformNormal(v:V,p:Pose):V{return norm(rotate(v.map((n,k)=>n/p.scale[k]) as V,p.rotation));}
function draw(g:MeshBuilder,part:Part){
 const m=part.material,s=part.shape;
 switch(s.type){
  case 'scatter':{
   const elementBuilder=new MeshBuilder(id=>({surface:g.material(id).surface}));
   draw(elementBuilder,{...part,shape:s.element});
   const mesh=elementBuilder.meshes()[0];assert(mesh,'散布元素没有有效三角形');const geometry=mesh.geometry;
   for(const pose of distributedPoses(s))for(let n=0;n<geometry.indices.length;n+=3){
    const ids=geometry.indices.slice(n,n+3);
    g.triangle(m,ids.map((i:number)=>transformPoint(geometry.positions.slice(i*3,i*3+3) as V,pose)),ids.map((i:number)=>geometry.uvs.slice(i*2,i*2+2)),ids.map((i:number)=>transformNormal(geometry.normals.slice(i*3,i*3+3) as V,pose)));
   }
   break;
  }
  case 'box':if(s.radius)g.rounded(m,[0,0,0],s.size,s.radius);else g.box(m,[0,0,0],s.size);break;
  case 'lathe':g.lathe(m,[0,0,0],s.profile,s.segments,s.arc??Math.PI*2,s.start??0);break;
  case 'tube':g.tube(m,s.from,s.to,s.radius,s.endRadius,s.segments);break;
  case 'extrusion':{
   const area=s.outline.reduce((sum,p,i)=>{const q=s.outline[(i+1)%s.outline.length];return sum+p[0]*q[1]-p[1]*q[0];},0),points=area>0?s.outline:[...s.outline].reverse();
   const at=(i:number,z:number):V=>[...points[i],z] as V;
   // 与箱体、网格一致：uvScale 表示整个表面的重复次数，不再额外乘米制尺寸。
   const min=[0,1].map(k=>Math.min(...points.map(p=>p[k]))),extent=[0,1].map(k=>Math.max(...points.map(p=>p[k]))-min[k]);
   const uv=(i:number)=>points[i].map((n,k)=>{const value=(n-min[k])/Math.max(extent[k],1e-9);return k===1?1-value:value;});
   for(const [a,b,c] of triangulatePolygon(points)){g.triangle(m,[at(c,0),at(b,0),at(a,0)], [uv(c),uv(b),uv(a)]);g.triangle(m,[at(a,s.depth),at(b,s.depth),at(c,s.depth)],[uv(a),uv(b),uv(c)]);}
   for(let i=0;i<points.length;i++){const j=(i+1)%points.length;g.quad(m,[at(i,0),at(j,0),at(j,s.depth),at(i,s.depth)]);}break;
  }
  case 'grid':for(let row=0;row<s.rows-1;row++)for(let col=0;col<s.columns-1;col++){
   const indices=[row*s.columns+col,row*s.columns+col+1,(row+1)*s.columns+col+1,(row+1)*s.columns+col];
   const points=indices.map(i=>s.points[i]),uv=indices.map(i=>[(i%s.columns)/(s.columns-1),Math.floor(i/s.columns)/(s.rows-1)]);g.quad(m,points,uv);if(s.doubleSided)g.quad(m,[...points].reverse(),[...uv].reverse());
  }break;
 }
}
// 贴图仅从调用者验证过的注册表绑定；模型不能指定本地路径或任意 URL。
export function compileGeometryProgram(program:GeometryProgram,textures:Record<string,Texture>={}){
 const estimate=validateGeometryProgram(program);
 const materials=new Map(program.materials.map(m=>[m.id,m]));
 for(const m of program.materials)if(m.textureId){const t=textures[m.textureId];assert(t&&Number.isInteger(t.width)&&Number.isInteger(t.height)&&t.width>0&&t.height>0&&t.width<=1024&&t.height<=1024&&['srgb','linear'].includes(t.colorSpace)&&typeof t.rgba8==='string'&&atob(t.rgba8).length===t.width*t.height*4,'贴图未绑定或像素数据无效：'+m.textureId);}
 const resolve=(id:string)=>{const m=materials.get(id)!;return {surface:{baseColor:m.color,roughness:m.roughness,metallic:m.metallic,...(m.textureId?{baseColorTexture:textures[m.textureId]}:{})}};};
 const used=new Set(program.instances.map(i=>i.template));
 const library=new Map(program.templates.filter(t=>used.has(t.id)).map(t=>[t.id,t.parts.map(part=>{
  const g=new MeshBuilder(resolve);g.group=part.id;draw(g,part);const mesh=g.meshes()[0];assert(mesh&&mesh.geometry.indices.length>0,'部件没有可渲染三角形：'+part.id);
  if(part.uvScale)mesh.geometry.uvs=mesh.geometry.uvs.map((n:number,k:number)=>n*part.uvScale![k%2]);
  for(let k=0;k<mesh.geometry.positions.length;k+=3){mesh.geometry.positions.splice(k,3,...transformPoint(mesh.geometry.positions.slice(k,k+3) as V,part));mesh.geometry.normals.splice(k,3,...transformNormal(mesh.geometry.normals.slice(k,k+3) as V,part));}return mesh;
 })]));
 const meshes:any[]=[],min:V=[Infinity,Infinity,Infinity],max:V=[-Infinity,-Infinity,-Infinity];
 for(const instance of program.instances)for(const original of library.get(instance.template)!){
  const source=original.geometry,geometry={...source,positions:[...source.positions],normals:[...source.normals]};
  for(let k=0;k<geometry.positions.length;k+=3){const point=transformPoint(geometry.positions.slice(k,k+3) as V,instance);assert(point.every(n=>finite(n,-1000,1000)),'展开后的坐标超出场景范围');for(let j=0;j<3;j++){geometry.positions[k+j]=point[j];min[j]=Math.min(min[j],point[j]);max[j]=Math.max(max[j],point[j]);}geometry.normals.splice(k,3,...transformNormal(geometry.normals.slice(k,k+3) as V,instance));}
  meshes.push({name:instance.id+'__'+original.name,geometry,entityId:instance.id,requirementIds:instance.requirementIds});
 }
 assert(new Set(meshes.map(m=>m.name)).size===meshes.length,'组合后的网格 ID 冲突');
 return {meshes,bounds:{min,max},triangles:meshes.reduce((n,m)=>n+m.geometry.indices.length/3,0),estimatedTriangles:estimate.triangles,materialCount:program.materials.length};
}
