import {type MeshBuilder,type V} from './mesh';
export type CurvedShape=
 | {type:'cushion';size:V;roundness:number;seamDepth:number;segments:number}
 | {type:'cloth';size:[number,number];rows:number;columns:number;foldAmplitude:number;foldCount:number;edgeDrop:number;thickness:number;seed:number}
 | {type:'shell';profile:number[][];segments:number;thickness:number;arc:number;start:number;edgeRoughness:number;seed:number};
const check=(v:any,m:string)=>{if(!v)throw Error('参数曲面：'+m);};
const number=(n:any,min:number,max:number)=>Number.isFinite(n)&&n>=min&&n<=max;
const int=(n:any,min:number,max:number)=>Number.isInteger(n)&&number(n,min,max);
export function curvedTriangles(s:CurvedShape){
 if(s.type==='cushion'){
  check(s.size?.length===3&&s.size.every(n=>number(n,.001,100))&&number(s.roundness,2,8)&&number(s.seamDepth,0,.2)&&int(s.segments,4,24),'软包尺寸或分段无效');return 12*s.segments*s.segments;
 }
 if(s.type==='cloth'){
  check(s.size?.length===2&&s.size.every(n=>number(n,.001,100))&&int(s.rows,3,32)&&int(s.columns,3,32)&&number(s.foldAmplitude,0,1)&&int(s.foldCount,1,12)&&number(s.edgeDrop,0,10)&&number(s.thickness,.001,.1)&&int(s.seed,0,0xffffffff),'布面参数无效');return 4*(s.rows-1)*(s.columns-1)+4*(s.rows+s.columns-2);
 }
 check(int(s.segments,4,64)&&number(s.thickness,.001,1)&&number(s.arc,.05,Math.PI*2)&&number(s.start,-Math.PI*2,Math.PI*2)&&number(s.edgeRoughness,0,.2)&&int(s.seed,0,0xffffffff),'壳体参数无效');
 check(Array.isArray(s.profile)&&s.profile.length>=2&&s.profile.length<=64&&s.profile.every(p=>p?.length===2&&number(p[0],s.thickness*1.01,100)&&number(p[1],-100,100)),'壳体轮廓无效或厚度超过半径');
 check(s.profile.slice(1).every((p,i)=>p[1]>s.profile[i][1]),'壳体轮廓高度必须递增，避免折返自交');
 return 4*(s.profile.length-1)*s.segments+4*s.segments+(s.arc<Math.PI*2-1e-6?4*(s.profile.length-1):0);
}
export function drawCurved(g:MeshBuilder,m:string,s:CurvedShape){
 curvedTriangles(s);
 if(s.type==='cushion'){
  const faces:[[number,number,number],number,number][]=[[[1,0,0],1,2],[[-1,0,0],2,1],[[0,1,0],2,0],[[0,-1,0],0,2],[[0,0,1],0,1],[[0,0,-1],1,0]],n=s.segments;
  for(const [normal,u,v] of faces){const axis=normal.findIndex(x=>x!==0),point=(i:number,j:number):V=>{const q:V=[0,0,0];q[axis]=normal[axis];q[u]=2*i/n-1;q[v]=2*j/n-1;const divisor=Math.pow(q.reduce((a,x)=>a+Math.abs(x)**s.roundness,0),1/s.roundness);const seam=1-s.seamDepth*Math.exp(-Math.pow(q[2]/.12,2));return q.map((x,k)=>x/divisor*s.size[k]/2*(k===2?1:seam)) as V;};
   for(let i=0;i<n;i++)for(let j=0;j<n;j++)g.quad(m,[point(i,j),point(i+1,j),point(i+1,j+1),point(i,j+1)],[[i/n,j/n],[(i+1)/n,j/n],[(i+1)/n,(j+1)/n],[i/n,(j+1)/n]]);
  }return;
 }
 if(s.type==='cloth'){
  const phase=(s.seed%997)/997*Math.PI*2,point=(r:number,c:number,bottom=false):V=>{const u=c/(s.columns-1),v=r/(s.rows-1),edge=Math.max(Math.abs(u*2-1),Math.abs(v*2-1)),drop=s.edgeDrop*Math.max(0,(edge-.72)/.28)**2;
   const wave=s.foldAmplitude*(.7*Math.sin(u*s.foldCount*Math.PI*2+phase+v*1.7)+.3*Math.sin(v*(s.foldCount+.7)*Math.PI*2+phase))*Math.pow(edge,.6);
   return [(u-.5)*s.size[0],(v-.5)*s.size[1],wave-drop-(bottom?s.thickness:0)];};
  for(let r=0;r<s.rows-1;r++)for(let c=0;c<s.columns-1;c++){const rc=[[r,c],[r,c+1],[r+1,c+1],[r+1,c]],uv=rc.map(([a,b])=>[b/(s.columns-1),a/(s.rows-1)]);g.quad(m,rc.map(([a,b])=>point(a,b)),uv);g.quad(m,rc.map(([a,b])=>point(a,b,true)).reverse(),[...uv].reverse());}
  const ring:number[][]=[];for(let c=0;c<s.columns;c++)ring.push([0,c]);for(let r=1;r<s.rows;r++)ring.push([r,s.columns-1]);for(let c=s.columns-2;c>=0;c--)ring.push([s.rows-1,c]);for(let r=s.rows-2;r>0;r--)ring.push([r,0]);
  for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];g.quad(m,[point(...b as [number,number]),point(...a as [number,number]),point(...a as [number,number],true),point(...b as [number,number],true)]);}return;
 }
 const n=s.profile.length,full=s.arc>=Math.PI*2-1e-6,phase=(s.seed%991)/991*Math.PI*2,lengths=[0];
 for(let r=1;r<n;r++)lengths.push(lengths[r-1]+Math.hypot(s.profile[r][0]-s.profile[r-1][0],s.profile[r][1]-s.profile[r-1][1]));
 const point=(r:number,c:number,inside=false):V=>{const u=c/s.segments,rough=full?0:s.edgeRoughness*Math.min(s.arc*.2,.2)*Math.sin(r*2.17+phase)*Math.cos(u*Math.PI),angle=s.start+s.arc*u+rough,radius=s.profile[r][0]-(inside?s.thickness:0);return [radius*Math.cos(angle),radius*Math.sin(angle),s.profile[r][1]];};
 for(let r=0;r<n-1;r++)for(let c=0;c<s.segments;c++){const rc=[[r,c],[r,c+1],[r+1,c+1],[r+1,c]],uv=rc.map(([a,b])=>[b/s.segments,1-lengths[a]/lengths[n-1]]);g.quad(m,rc.map(([a,b])=>point(a,b)),uv);g.quad(m,rc.map(([a,b])=>point(a,b,true)).reverse(),[...uv].reverse());}
 for(let c=0;c<s.segments;c++){g.quad(m,[point(0,c,true),point(0,c+1,true),point(0,c+1),point(0,c)]);g.quad(m,[point(n-1,c),point(n-1,c+1),point(n-1,c+1,true),point(n-1,c,true)]);}
 if(!full)for(let r=0;r<n-1;r++){g.quad(m,[point(r,0,true),point(r,0),point(r+1,0),point(r+1,0,true)]);g.quad(m,[point(r,s.segments),point(r,s.segments,true),point(r+1,s.segments,true),point(r+1,s.segments)]);}
}
