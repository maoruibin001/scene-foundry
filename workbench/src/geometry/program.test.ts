import {test,expect} from 'bun:test';
import {compileGeometryProgram,validateGeometryProgram,type GeometryProgram,type Pose} from './program';
import {geometryProgramSchema,GEOMETRY_PROMPT} from './program-schema';
import {codexPrompt} from '../prompts';
const pose:Pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};
const base=():GeometryProgram=>({version:'geometry-v1',name:'通用几何验证',materials:[{id:'surface',color:[.5,.3,.1,1],roughness:.65,metallic:0,textureId:null}],templates:[{id:'unseen_object',parts:[{...pose,id:'body',material:'surface',shape:{type:'extrusion',outline:[[0,0],[3,0],[3,1],[1,1],[1,3],[0,3]],depth:.4}}]}],instances:[{...pose,id:'sample',label:'不在任何预制列表中的凹形支架',template:'unseen_object',requirementIds:['shape']}]});

test('未知类别通过数据组合导出，真实缺口不被封面填平',()=>{
 const p=base(),result=compileGeometryProgram(p),g=result.meshes[0].geometry;
 expect(result.triangles).toBe(20);expect(result.bounds).toEqual({min:[0,0,0],max:[3,3,.4]});
 let topArea=0;
 for(let i=0;i<g.indices.length;i+=3){const points=g.indices.slice(i,i+3).map((n:number)=>g.positions.slice(n*3,n*3+3));
  if(points.every((v:number[])=>Math.abs(v[2]-.4)<1e-8)){const [a,b,c]=points;topArea+=Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;expect(points.reduce((n:number,v:number[])=>n+v[0],0)/3<=1||points.reduce((n:number,v:number[])=>n+v[1],0)/3<=1).toBe(true);}
 }
 expect(topArea).toBeCloseTo(5,8);expect(result.meshes[0].entityId).toBe('sample');expect(result.meshes[0].requirementIds).toEqual(['shape']);
});
test('完整三轴变换保持非均匀缩放后的真实包络与单位法线',()=>{
 const p=base();p.templates[0].parts[0].shape={type:'box',size:[2,4,6],radius:0};p.instances[0]={...p.instances[0],position:[10,20,30],rotation:[Math.PI/2,0,Math.PI/2],scale:[2,1,.5]};
 const result=compileGeometryProgram(p),g=result.meshes[0].geometry;
 result.bounds.min.forEach((n,k)=>expect(n).toBeCloseTo([8.5,18,28][k],8));result.bounds.max.forEach((n,k)=>expect(n).toBeCloseTo([11.5,22,32][k],8));
 for(let i=0;i<g.normals.length;i+=3)expect(Math.hypot(...g.normals.slice(i,i+3))).toBeCloseTo(1,8);
});
test('任意尺寸与偏移的挤出表面只重复 uvScale 指定次数，避免米制尺寸造成二次重复',()=>{
 const p=base(),part=p.templates[0].parts[0];part.shape={type:'extrusion',outline:[[5,-2],[9,-2],[9,8],[5,8]],depth:.04};part.uvScale=[4,10];
 const g=compileGeometryProgram(p).meshes[0].geometry;
 for(let i=0;i<g.positions.length/3;i++){
  if(Math.abs(g.normals[i*3+2])<.99)continue;
  expect(g.uvs[i*2]).toBeCloseTo(g.positions[i*3]-5,8);
  expect(g.uvs[i*2+1]).toBeCloseTo(8-g.positions[i*3+1],8);
 }
 const original=[...g.uvs];part.shape.outline=part.shape.outline.map(([x,y])=>[x+20,y-10]);
 expect(compileGeometryProgram(p).meshes[0].geometry.uvs).toEqual(original);
});
test('旋转轮廓、倾斜管件和双面曲面无需新的语义种类或专用资产',()=>{
 const p=base();p.templates[0].parts=[
  {...pose,id:'vessel',material:'surface',shape:{type:'lathe',profile:[[0,0],[.4,0],[.6,.8],[.3,1.4],[0,1.4]],segments:24}},
  {...pose,id:'link',material:'surface',shape:{type:'tube',from:[0,0,1],to:[1,2,3],radius:.06,endRadius:.04,segments:12}},
  {...pose,id:'fabric',material:'surface',shape:{type:'grid',points:[[0,0,0],[1,0,.1],[0,1,.2],[1,1,0]],rows:2,columns:2,doubleSided:true}},
 ];
 const r=compileGeometryProgram(p);expect(r.meshes).toHaveLength(3);expect(r.triangles).toBeGreaterThan(100);
 for(const m of r.meshes){expect(m.geometry.positions.every(Number.isFinite)).toBe(true);expect(m.geometry.normals).toHaveLength(m.geometry.positions.length);expect(m.geometry.uvs.length/2).toBe(m.geometry.positions.length/3);}
});
test('非法轮廓、超预算、无效引用和虚构贴图在导出前拒绝',()=>{
 let p=base();p.templates[0].parts[0].shape={type:'extrusion',outline:[[0,0],[2,2],[0,2],[2,0]],depth:1};expect(()=>compileGeometryProgram(p)).toThrow('自交');
 p=base();p.instances[0].template='missing';expect(()=>compileGeometryProgram(p)).toThrow('模板');
 p=base();expect(()=>validateGeometryProgram(p,['other'])).toThrow('未知需求');
 p=base();p.materials[0].textureId='invented';expect(()=>compileGeometryProgram(p)).toThrow('贴图未绑定');
 p=base();p.templates[0].parts[0].shape={type:'lathe',profile:Array.from({length:128},(_,i)=>[1,i/128]),segments:64};p.instances=Array.from({length:16},(_,i)=>({...p.instances[0],id:'copy'+i}));expect(()=>compileGeometryProgram(p)).toThrow('三角形预算');
 p=base();p.instances[0].scale=[-1,1,1];expect(()=>compileGeometryProgram(p)).toThrow('正缩放');
});
test('局部旋转支持连续弧面，默认整圆保持历史行为',()=>{
 const p=base(),part=p.templates[0].parts[0];part.shape={type:'lathe',profile:[[1,0],[1,1]],segments:16,arc:Math.PI,start:0};
 const result=compileGeometryProgram(p);expect(result.bounds.min[1]).toBeCloseTo(0,8);expect(result.bounds.max[1]).toBeCloseTo(1,8);expect(result.triangles).toBe(32);
 part.shape.arc=null;part.shape.start=null;const full=compileGeometryProgram(p);delete part.shape.arc;delete part.shape.start;expect(compileGeometryProgram(p)).toEqual(full);
 part.shape.arc=7;expect(()=>compileGeometryProgram(p)).toThrow('局部弧度');
});
test('材质来自任务注册表，不绑定样例贴图；缺省材质保留 PBR 参数',()=>{
 const p=base();p.materials[0].textureId='verified_texture';const texture={width:1,height:1,rgba8:Buffer.from([120,130,140,255]).toString('base64'),colorSpace:'srgb' as const};
 const r=compileGeometryProgram(p,{verified_texture:texture});expect(r.meshes[0].geometry.material.surface).toEqual({baseColor:[.5,.3,.1,1],roughness:.65,metallic:0,baseColorTexture:texture});
 expect(()=>compileGeometryProgram(p,{verified_texture:{...texture,width:2}})).toThrow('像素数据');
});
test('通用模型契约为中文数据，不提供代码、引擎替换或固定物体类别入口',()=>{
 const schema=geometryProgramSchema(['shape']);expect(schema.additionalProperties).toBe(false);expect(schema.properties).not.toHaveProperty('code');expect(schema.properties).not.toHaveProperty('kind');
 const text=codexPrompt(GEOMETRY_PROMPT,'{}');expect(text).toContain('均使用中文');expect(text).toContain('当前固定版本的 ForgeaX Engine');expect(text).toContain('物体类别不受预制列表限制');expect(text).not.toContain('餐厅');
});

function faceUvAt(geometry:any,point:number[],normal:number[]){
 for(let n=0;n<geometry.indices.length;n+=3){
  const ids=geometry.indices.slice(n,n+3),at=(id:number,field:string,size:number)=>geometry[field].slice(id*size,id*size+size);
  if(!ids.every((id:number)=>at(id,'normals',3).every((v:number,k:number)=>Math.abs(v-normal[k])<1e-7)))continue;
  const [a,b,c]=ids.map((id:number)=>at(id,'positions',3)),axis=normal.findIndex(v=>Math.abs(v)>.9),axes=[0,1,2].filter(k=>k!==axis),[x,y]=axes;
  const ux=b[x]-a[x],uy=b[y]-a[y],vx=c[x]-a[x],vy=c[y]-a[y],px=point[x]-a[x],py=point[y]-a[y],denom=ux*vy-uy*vx;
  const u=(px*vy-py*vx)/denom,v=(ux*py-uy*px)/denom,[ta,tb,tc]=ids.map((id:number)=>at(id,'uvs',2));
  return ta.map((value:number,k:number)=>value+u*(tb[k]-value)+v*(tc[k]-value));
 }
 throw Error('没有对应的平面');
}
test('仅添加圆角不会旋转或镜像任一面的标签方向',()=>{
 const p=base();p.templates[0].parts[0].shape={type:'box',size:[2,4,6],radius:0};const box=compileGeometryProgram(p).meshes[0].geometry;p.templates[0].parts[0].shape.radius=.05;const rounded=compileGeometryProgram(p).meshes[0].geometry;
 const checked=new Set<string>();
 for(let i=0;i<rounded.positions.length/3;i++){
  const normal=rounded.normals.slice(i*3,i*3+3);if(normal.filter((n:number)=>Math.abs(n)>.999999).length!==1||normal.some((n:number)=>Math.abs(n)>1e-7&&Math.abs(n)<.999999))continue;
  const expected=faceUvAt(box,rounded.positions.slice(i*3,i*3+3),normal);expected.forEach((value:number,k:number)=>expect(rounded.uvs[i*2+k]).toBeCloseTo(value,6));checked.add(normal.map((v:number)=>Math.round(v)).join(','));
 }
 expect(checked.size).toBe(6);
});
test('矩形挤出正端面与同尺寸箱体正端面的图片上下方向一致',()=>{
 const p=base();p.templates[0].parts[0].shape={type:'box',size:[2,4,.2],radius:0};p.templates[0].parts[0].position=[0,0,.1];const box=compileGeometryProgram(p).meshes[0].geometry;
 p.templates[0].parts[0].shape={type:'extrusion',outline:[[-1,-2],[1,-2],[1,2],[-1,2]],depth:.2};p.templates[0].parts[0].position=[0,0,0];const extrusion=compileGeometryProgram(p).meshes[0].geometry;
 for(let i=0;i<extrusion.positions.length/3;i++)if(extrusion.normals[i*3+2]>.99){const expected=faceUvAt(box,extrusion.positions.slice(i*3,i*3+3),[0,0,1]);expected.forEach((value:number,k:number)=>expect(extrusion.uvs[i*2+k]).toBeCloseTo(value,6));}
});

test('散布超额说明提供整个场景的展开数字，包含模板复用倍数且不放宽上限',()=>{
 const p=base();p.templates[0].parts[0].shape={type:'scatter',element:{type:'box',size:[.1,.1,.1],radius:0},count:2000,seed:1,volume:'box',size:[3,3,3],rotationRange:[0,0,0],scaleRange:[1,1]};
 p.instances=Array.from({length:10},(_,i)=>({...p.instances[0],id:'replica'+i}));expect(validateGeometryProgram(p)).toEqual({triangles:240000,parts:10});
 p.instances.push({...p.instances[0],id:'over'});expect(()=>validateGeometryProgram(p)).toThrow('展开部件 11/2048；估算三角形 264000/250000');
});
