import {add,mul,sub,cross,norm,hasTriangleArea,type V,type MeshBuilder} from './mesh';

/** A compact construction contract, independent of the subject being modeled. */
export type BezierPatch={type:'bezierPatch';controlPoints:V[];rows:number;columns:number;thickness:number};
type Vertex={point:V;normal:V;uv:number[]};
type Face=[Vertex,Vertex,Vertex];
const dot=(a:V,b:V)=>a.reduce((n,x,i)=>n+x*b[i],0);
const basis=(t:number)=>[(1-t)**3,3*t*(1-t)**2,3*t*t*(1-t),t**3];
const derivative=(t:number)=>[-3*(1-t)**2,3*(1-t)*(1-3*t),3*t*(2-3*t),3*t*t];
function assert(ok:unknown,message:string):asserts ok{if(!ok)throw Error('Bezier 曲面：'+message);}

/** Row-major controls: U follows columns, V follows rows; UVs cover the entire patch once. */
export function samplePatch(s:BezierPatch,u:number,v:number){
 const bu=basis(u),bv=basis(v),du=derivative(u),dv=derivative(v);
 const point:V=[0,0,0],tangentU:V=[0,0,0],tangentV:V=[0,0,0];
 for(let row=0;row<4;row++)for(let col=0;col<4;col++)for(let axis=0;axis<3;axis++){
  const value=s.controlPoints[row*4+col][axis];
  point[axis]+=value*bu[col]*bv[row];tangentU[axis]+=value*du[col]*bv[row];tangentV[axis]+=value*bu[col]*dv[row];
 }
 const area=cross(tangentU,tangentV);
 assert(hasTriangleArea(area),'控制点导致切线退化；保持首尾边非零宽度');
 return {point,normal:norm(area),uv:[u,v]};
}

/** One tessellation is used by both the budget validator and the actual compiler. */
export function patchFaces(s:BezierPatch):Face[]{
 assert(Array.isArray(s.controlPoints)&&s.controlPoints.length===16&&s.controlPoints.every(p=>Array.isArray(p)&&p.length===3&&p.every(n=>Number.isFinite(n)&&Math.abs(n)<=100)),'需要16个有限三维控制点，范围 -100..100');
 assert([s.rows,s.columns].every(n=>Number.isInteger(n)&&n>=2&&n<=32),'rows/columns 必须为 2..32 的整数');
 assert(Number.isFinite(s.thickness)&&s.thickness>=.001&&s.thickness<=1,'thickness 必须为 .001..1 米');
 const center=samplePatch(s,.5,.5).normal,front:Vertex[]=[],back:Vertex[]=[],faces:Face[]=[];
 for(let row=0;row<s.rows;row++)for(let col=0;col<s.columns;col++){
  const v=samplePatch(s,col/(s.columns-1),row/(s.rows-1));
  assert(dot(v.normal,center)>.05,'采样曲面折返或法线翻转；请拆成较小连续曲面');
  front.push({...v,point:add(v.point,mul(v.normal,s.thickness/2))});
  back.push({...v,point:add(v.point,mul(v.normal,-s.thickness/2)),normal:mul(v.normal,-1)});
 }
 const face=(a:Vertex,b:Vertex,c:Vertex,surface:boolean)=>{
  const area=cross(sub(b.point,a.point),sub(c.point,a.point));
  assert(hasTriangleArea(area),'出现退化三角形，请减小厚度或修正控制点');
  if(surface)assert([a,b,c].every(v=>dot(area,v.normal)>0),'厚度或分段导致表面翻转，请减小厚度或增加分段');
  const n=norm(area);faces.push(surface?[a,b,c]:[a,b,c].map(v=>({...v,normal:n})) as Face);
 };
 const quad=(vertices:Vertex[],ids:number[],surface:boolean)=>{const [a,b,c,d]=ids.map(i=>vertices[i]);face(a,b,c,surface);face(a,c,d,surface);};
 for(let row=0;row<s.rows-1;row++)for(let col=0;col<s.columns-1;col++){
  const a=row*s.columns+col,ids=[a,a+1,a+1+s.columns,a+s.columns];quad(front,ids,true);quad(back,[...ids].reverse(),true);
 }
 const boundary:number[]=[];
 for(let col=0;col<s.columns;col++)boundary.push(col);
 for(let row=1;row<s.rows;row++)boundary.push(row*s.columns+s.columns-1);
 for(let col=s.columns-2;col>=0;col--)boundary.push((s.rows-1)*s.columns+col);
 for(let row=s.rows-2;row>0;row--)boundary.push(row*s.columns);
 const lengths=boundary.map((a,i)=>Math.hypot(...sub(front[boundary[(i+1)%boundary.length]].point,front[a].point))),perimeter=lengths.reduce((a,b)=>a+b,0);
 let distance=0;
 for(let k=0;k<boundary.length;k++){
  const a=boundary[k],b=boundary[(k+1)%boundary.length],u0=distance/perimeter,u1=(distance+lengths[k])/perimeter;
  const side=[{...front[a],uv:[u0,0]},{...back[a],uv:[u0,1]},{...back[b],uv:[u1,1]},{...front[b],uv:[u1,0]}];
  quad(side,[0,1,2,3],false);distance+=lengths[k];
 }
 return faces;
}
export function drawPatch(g:MeshBuilder,material:string,s:BezierPatch){for(const face of patchFaces(s))g.triangle(material,face.map(v=>v.point),face.map(v=>v.uv),face.map(v=>v.normal));}
