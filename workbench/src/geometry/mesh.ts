// 原生静态网格工具：米制、Z 向上；按语义组和材质合批，保留逐面 UV。
export type V = [number, number, number];
export const add=(a:V,b:V):V=>a.map((v,i)=>v+b[i]) as V;
export const sub=(a:V,b:V):V=>a.map((v,i)=>v-b[i]) as V;
export const mul=(a:V,s:number):V=>a.map(v=>v*s) as V;
export const cross=(a:V,b:V):V=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const norm=(a:V):V=>mul(a,1/(Math.hypot(...a)||1));
// 对凹轮廓做耳切三角化，保留缺口。
export function triangulatePolygon(points:number[][]):number[][]{
 const cross2=(a:number[],b:number[],c:number[])=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
 const area=points.reduce((a,p,i)=>{const q=points[(i+1)%points.length];return a+p[0]*q[1]-p[1]*q[0];},0);
 if(Math.abs(area)<1e-10)throw Error('轮廓面积为零');
 const sign=Math.sign(area),remaining=points.map((_,i)=>i),triangles:number[][]=[];
 while(remaining.length>3){let found=false;
  for(let i=0;i<remaining.length;i++){
   const a=remaining[(i+remaining.length-1)%remaining.length],b=remaining[i],c=remaining[(i+1)%remaining.length];
   if(sign*cross2(points[a],points[b],points[c])<=1e-10)continue;
   const occupied=remaining.some(k=>k!==a&&k!==b&&k!==c&&sign*cross2(points[a],points[b],points[k])>=-1e-10&&sign*cross2(points[b],points[c],points[k])>=-1e-10&&sign*cross2(points[c],points[a],points[k])>=-1e-10);
   if(occupied)continue;
   triangles.push([a,b,c]);remaining.splice(i,1);found=true;break;
  }
  if(!found)throw Error('轮廓自交或不能三角化');
 }
 triangles.push([...remaining]);return triangles;
}
export class MeshBuilder {
 groups=new Map<string,any>(); group='mesh'; origin:V=[0,0,0]; yaw=0;
 constructor(readonly materialResolver:(id:string)=>{surface:any,cell?:number}){}
 at(group:string,p:V,yaw:number,fn:()=>void){const before=[this.group,this.origin,this.yaw] as const;this.group=group;this.origin=p;this.yaw=yaw;fn();[this.group,this.origin,this.yaw]=before as any;}
 point(p:V):V{const c=Math.cos(this.yaw),s=Math.sin(this.yaw);return [p[0]*c-p[1]*s+this.origin[0],p[0]*s+p[1]*c+this.origin[1],p[2]+this.origin[2]];}
 material(name:string){return this.materialResolver(name);}
 batch(mat:string){const key=this.group+'__'+mat;let b=this.groups.get(key);if(!b){const {cell,surface}=this.material(mat);b={name:key,positions:[],normals:[],uvs:[],indices:[],cell,material:{id:mat,surface}};this.groups.set(key,b);}return b;}
 triangle(mat:string,points:V[],uv:number[][]=[[0,0],[1,0],[0,1]],ns?:V[]){const p=points.map(x=>this.point(x)),area=cross(sub(p[1],p[0]),sub(p[2],p[0]));if(Math.hypot(...area)<1e-11)return;const b=this.batch(mat),n=norm(area),base=b.positions.length/3;for(let i=0;i<3;i++){b.positions.push(...p[i]);let normal=n;if(ns){const c=Math.cos(this.yaw),s=Math.sin(this.yaw),v=ns[i];normal=[v[0]*c-v[1]*s,v[0]*s+v[1]*c,v[2]];}b.normals.push(...normal);const [u,v]=uv[i];b.uvs.push(...(b.cell===undefined?[u,v]:[(b.cell%3+.006+u*.988)/3,(Math.floor(b.cell/3)+.006+v*.988)/3]));}b.indices.push(base,base+1,base+2);}
 quad(mat:string,p:V[],uv:number[][]=[[0,1],[1,1],[1,0],[0,0]]){this.triangle(mat,[p[0],p[1],p[2]],[uv[0],uv[1],uv[2]]);this.triangle(mat,[p[0],p[2],p[3]],[uv[0],uv[2],uv[3]]);}
 box(mat:string,p:V,s:V,yaw=0){const [x,y,z]=p,[w,d,h]=s.map(v=>v/2);const v:V[]=[[-w,-d,-h],[w,-d,-h],[w,d,-h],[-w,d,-h],[-w,-d,h],[w,-d,h],[w,d,h],[-w,d,h]].map(a=>[a[0]*Math.cos(yaw)-a[1]*Math.sin(yaw)+x,a[0]*Math.sin(yaw)+a[1]*Math.cos(yaw)+y,a[2]+z] as V);for(const f of [[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]])this.quad(mat,f.map(i=>v[i]));}
 rounded(mat:string,p:V,s:V,r=.04){const half=s.map(v=>v/2),faces:[[number,number,number],number,number][]=[[[1,0,0],1,2],[[-1,0,0],2,1],[[0,1,0],2,0],[[0,-1,0],0,2],[[0,0,1],0,1],[[0,0,-1],1,0]];for(const [normal,u,v] of faces){const axis=normal.findIndex(n=>n!==0),N=6;const vertex=(i:number,j:number)=>{const q:V=[0,0,0];q[axis]=normal[axis]*half[axis];q[u]=(i/N*2-1)*half[u];q[v]=(j/N*2-1)*half[v];const inner=q.map((n,k)=>Math.max(-half[k]+r,Math.min(half[k]-r,n))) as V,n=norm(sub(q,inner));const unit=q.map((value,k)=>(value/half[k]+1)/2),uv=axis===0?[normal[0]>0?unit[1]:1-unit[1],1-unit[2]]:axis===1?[normal[1]>0?1-unit[0]:unit[0],1-unit[2]]:normal[2]>0?[unit[0],1-unit[1]]:[unit[1],1-unit[0]];return {p:add(add(inner,mul(n,r)),p),n,uv};};for(let i=0;i<N;i++)for(let j=0;j<N;j++){const a=vertex(i,j),b=vertex(i+1,j),c=vertex(i+1,j+1),d=vertex(i,j+1);for(const t of [[a,b,c],[a,c,d]])this.triangle(mat,t.map(v=>v.p),t.map(v=>v.uv),t.map(v=>v.n));}}}
 tube(mat:string,a:V,b:V,r:number,rt=r,sides=12){const axis=norm(sub(b,a)),u=norm(cross(axis,Math.abs(axis[2])<.8?[0,0,1]:[0,1,0])),v=cross(axis,u);for(let i=0;i<sides;i++){const t=i/sides*Math.PI*2,q=(i+1)/sides*Math.PI*2,na=add(mul(u,Math.cos(t)),mul(v,Math.sin(t))),nb=add(mul(u,Math.cos(q)),mul(v,Math.sin(q))),p=[add(a,mul(na,r)),add(a,mul(nb,r)),add(b,mul(nb,rt)),add(b,mul(na,rt))];this.quad(mat,p,[[i/sides,1],[(i+1)/sides,1],[(i+1)/sides,0],[i/sides,0]]);this.triangle(mat,[a,p[1],p[0]]);this.triangle(mat,[b,p[3],p[2]]);}}
 lathe(mat:string,p:V,profile:number[][],sides=36,arc=Math.PI*2,start=0){for(let j=0;j<profile.length-1;j++)for(let i=0;i<sides;i++){const a=start+i/sides*arc,b=start+(i+1)/sides*arc,[r,z]=profile[j],[rr,zz]=profile[j+1];const ps:V[]=[[r*Math.cos(a),r*Math.sin(a),z],[r*Math.cos(b),r*Math.sin(b),z],[rr*Math.cos(b),rr*Math.sin(b),zz],[rr*Math.cos(a),rr*Math.sin(a),zz]].map(q=>add(q,p));this.quad(mat,ps,[[i/sides,1-j/(profile.length-1)],[(i+1)/sides,1-j/(profile.length-1)],[(i+1)/sides,1-(j+1)/(profile.length-1)],[i/sides,1-(j+1)/(profile.length-1)]]);}}
 floor(mat:string,x0:number,y0:number,x1:number,y1:number,z:number,tile=2){for(let x=x0;x<x1-.0001;x+=tile)for(let y=y0;y<y1-.0001;y+=tile){const w=Math.min(tile,x1-x),d=Math.min(tile,y1-y);this.quad(mat,[[x,y,z],[x+w,y,z],[x+w,y+d,z],[x,y+d,z]]);}}
 panel(mat:string,x0:number,x1:number,y:number,z0:number,z1:number,tile=1.7){for(let x=x0;x<x1-.0001;x+=tile)for(let z=z0;z<z1-.0001;z+=tile){const w=Math.min(tile,x1-x),h=Math.min(tile,z1-z);this.quad(mat,[[x,y,z],[x+w,y,z],[x+w,y,z+h],[x,y,z+h]],[[0,1],[w/tile,1],[w/tile,1-h/tile],[0,1-h/tile]]);this.quad(mat,[[x,y+.045,z],[x,y+.045,z+h],[x+w,y+.045,z+h],[x+w,y+.045,z]],[[0,1],[0,1-h/tile],[w/tile,1-h/tile],[w/tile,1]]);}}
 meshes(){return [...this.groups.values()].map(({name,positions,normals,uvs,indices,material})=>({name,geometry:{kind:'mesh',positions,normals,uvs,indices,material}}));}
}
