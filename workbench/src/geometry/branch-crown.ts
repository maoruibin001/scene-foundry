import {add,sub,mul,norm,cross,hasTriangleArea,type V,type MeshBuilder} from './mesh';

/** A seeded branching construction. Resolution changes tessellation, never attachment topology. */
export type BranchCrown={type:'branchCrown';size:V;habit:'upright'|'spreading'|'hanging';stems:number;leafPairs:number;leafLength:number;leafWidth:number;curl:number;seed:number;segments:2|4|8;layer:'whole'|'branches'|'leaves'};
type Vertex={p:V;uv:[number,number];n?:V};
type Face=[Vertex,Vertex,Vertex];
type Axis={points:[V,V,V,V];radius:number};
type Leaf={base:V;axis:V;side:V;normal:V;length:number;width:number;curl:number};
const check=(ok:any,message:string)=>{if(!ok)throw Error('枝冠构造：'+message);};
const finite=(v:any,min:number,max:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
export function validateCrown(s:BranchCrown){
 check(s?.type==='branchCrown'&&Array.isArray(s.size)&&s.size.length===3&&s.size.every(n=>finite(n,.05,50)),'size必须为0.05..50米的三元组');
 check(['upright','spreading','hanging'].includes(s.habit)&&['whole','branches','leaves'].includes(s.layer),'habit/layer无效');
 check(Number.isInteger(s.stems)&&s.stems>=2&&s.stems<=16&&Number.isInteger(s.leafPairs)&&s.leafPairs>=2&&s.leafPairs<=20,'stems=2..16，leafPairs=2..20');
 check(finite(s.leafLength,.08,.4)&&finite(s.leafWidth,.15,1)&&finite(s.curl,-.5,.5),'leafLength=.08.. .4归一化冠幅，leafWidth=.15..1长宽比，curl=-.5.. .5');
 check(Number.isInteger(s.seed)&&s.seed>=0&&s.seed<=0xffffffff&&[2,4,8].includes(s.segments),'seed或segments无效');
 return s;
}
const bezier=(p:V[],t:number):V=>p[0].map((_,k)=>(1-t)**3*p[0][k]+3*(1-t)**2*t*p[1][k]+3*(1-t)*t*t*p[2][k]+t**3*p[3][k]) as V;
function topology(s:BranchCrown){
 validateCrown(s);let state=s.seed>>>0;
 const random=()=>{state=(state+0x6d2b79f5)>>>0;let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};
 const axes:Axis[]=[],leaves:Leaf[]=[];const phase=random()*Math.PI*2;
 for(let i=0;i<s.stems;i++){
  const a=phase+i*Math.PI*(3-Math.sqrt(5)),r=.28+.17*Math.sqrt((i+.5)/s.stems),d:V=[Math.cos(a),Math.sin(a),0];
  const root:V=[d[0]*.025,d[1]*.025,s.habit==='hanging'?.48:-.48];
  const height=.2+.25*random();
  const points:[V,V,V,V]=s.habit==='hanging'?[root,[d[0]*r*.5,d[1]*r*.5,.5],[d[0]*r,d[1]*r,-.05],[d[0]*r*.65,d[1]*r*.65,-height]]:
   [root,[d[0]*r*.2,d[1]*r*.2,-.1],[d[0]*r*.7,d[1]*r*.7,s.habit==='spreading'?.1:height*.9],[d[0]*r,d[1]*r,s.habit==='spreading'?.03+height*.4:height]];
  axes.push({points,radius:.009+.004*random()});
  for(let j=0;j<s.leafPairs;j++)for(const sign of [-1,1]){
   const t=.24+.73*(j+.5)/s.leafPairs,base=bezier(points,t),angle=a+sign*(.65+.3*random())+(random()-.5)*.3;
   const axis=norm([Math.cos(angle),Math.sin(angle),(s.habit==='hanging'?-.5:.08)+(random()-.5)*.4]);
   const side=norm(cross([0,0,1],axis)),normal=norm(cross(axis,side));
   const length=s.leafLength*(.7+.3*Math.sin(t*Math.PI))*(.88+.24*random());
   leaves.push({base,axis,side,normal,length,width:length*s.leafWidth,curl:s.curl});
  }
 }
 return {axes,leaves};
}
function leafPoint(l:Leaf,u:number,v:number):V{
 const width=l.width*(.025+.975*Math.sin(Math.PI*u)**.8)/2;
 return add(l.base,add(mul(l.axis,l.length*u),add(mul(l.side,width*v),mul(l.normal,l.length*Math.sin(Math.PI*u)*(l.curl+.07*(1-v*v))))));
}
/** Shared anchors are available for stage-handoff checks without comparing polygon counts. */
export function crownSkeleton(s:BranchCrown){const {axes,leaves}=topology(s);return {axes,leaves};}
const cache=new Map<string,Face[]>();
export function crownFaces(s:BranchCrown):Face[]{
 validateCrown(s);const key=JSON.stringify(s);if(cache.has(key))return cache.get(key)!;
 const {axes,leaves}=topology(s),raw:Face[]=[],envelope:V[]=[];
 // A fixed high-resolution envelope keeps coarse/fine vertices in the same coordinate system.
 for(const l of leaves)for(let i=0;i<=8;i++)for(const v of [-1,0,1])for(const sign of [-1,1])envelope.push(add(leafPoint(l,i/8,v),mul(l.normal,sign*l.length*.004)));
 for(const a of axes)for(let i=0;i<=8;i++){const p=bezier(a.points,i/8);for(let k=0;k<3;k++)for(const sign of [-1,1]){const q=[...p] as V;q[k]+=a.radius*sign;envelope.push(q);}}
 const min=[0,1,2].map(k=>Math.min(...envelope.map(p=>p[k]))),max=[0,1,2].map(k=>Math.max(...envelope.map(p=>p[k])));
 const scale=s.size.map((v,k)=>v/(max[k]-min[k])),point=(p:V)=>p.map((n,k)=>(n-(max[k]+min[k])/2)*scale[k]) as V;
 const triangle=(a:Vertex,b:Vertex,c:Vertex)=>{const vs=[a,b,c].map(v=>({...v,p:point(v.p),...(v.n?{n:norm(v.n.map((n,k)=>n/scale[k]) as V)}:{})})) as Face;
  if(hasTriangleArea(cross(sub(vs[1].p,vs[0].p),sub(vs[2].p,vs[0].p))))raw.push(vs);};
 const quad=(vs:Vertex[])=>{triangle(vs[0],vs[1],vs[2]);triangle(vs[0],vs[2],vs[3]);};
 if(s.layer!=='leaves')for(const a of axes){
  const ring=(t:number)=>{const p=bezier(a.points,t),tangent=norm(sub(bezier(a.points,Math.min(1,t+.0001)),bezier(a.points,Math.max(0,t-.0001)))),u=norm(cross(tangent,Math.abs(tangent[2])<.8?[0,0,1]:[0,1,0])),v=cross(tangent,u),r=a.radius*(1-.8*t);
   return Array.from({length:6},(_,j)=>{const n=add(mul(u,Math.cos(j*Math.PI/3)),mul(v,Math.sin(j*Math.PI/3)));return {p:add(p,mul(n,r)),uv:[j/6,t] as [number,number],n};});};
  const knots=[0,.25,.5,.75,1,...Array.from({length:s.leafPairs},(_,j)=>.24+.73*(j+.5)/s.leafPairs)].sort((a,b)=>a-b);
  const rings=[...new Set(knots)].map(ring),last=rings.length-1;
  for(let i=0;i<last;i++)for(let j=0;j<6;j++)quad([rings[i][j],rings[i][(j+1)%6],rings[i+1][(j+1)%6],rings[i+1][j]]);
  for(let j=0;j<6;j++){triangle({p:a.points[0],uv:[.5,.5]},rings[0][(j+1)%6],rings[0][j]);triangle({p:a.points[3],uv:[.5,.5]},rings[last][j],rings[last][(j+1)%6]);}
 }
 if(s.layer!=='branches')for(const l of leaves){
  const n=s.segments,vertex=(i:number,j:number,back=false):Vertex=>({p:add(leafPoint(l,i/n,j-1),mul(l.normal,(back?-1:1)*l.length*.004)),uv:[j/2,1-i/n]});
  for(let i=0;i<n;i++)for(let j=0;j<2;j++){quad([vertex(i,j),vertex(i+1,j),vertex(i+1,j+1),vertex(i,j+1)]);quad([vertex(i,j,true),vertex(i,j+1,true),vertex(i+1,j+1,true),vertex(i+1,j,true)]);}
  const edge:number[][]=[[0,0],[0,1],[0,2]];for(let i=1;i<=n;i++)edge.push([i,2]);edge.push([n,1],[n,0]);for(let i=n-1;i>0;i--)edge.push([i,0]);
  for(let k=0;k<edge.length;k++){const [i,j]=edge[k],[r,c]=edge[(k+1)%edge.length];quad([vertex(i,j),vertex(r,c),vertex(r,c,true),vertex(i,j,true)]);}
 }
 check(raw.length>0,'构造没有有效几何');if(cache.size>=16)cache.delete(cache.keys().next().value!);cache.set(key,raw);return raw;
}
export function drawCrown(g:MeshBuilder,material:string,s:BranchCrown){for(const f of crownFaces(s))g.triangle(material,f.map(v=>v.p),f.map(v=>v.uv),f.every(v=>v.n)?f.map(v=>v.n!) as V[]:undefined);}
export const CROWN_RULES='branchCrown是有根、弯曲枝条和成对附着叶片的确定性组群：size为实际完整宽深高(米)，居中原点；habit=upright/spreading/hanging，stems=2..16，leafPairs=2..20为每枝叶对数，leafLength=.08.. .4为归一化冠幅的叶长，leafWidth=.15..1为叶宽/长，curl=-.5.. .5为纵向弯曲，seed固定整数。segments只能2/4/8，改变细分不会改变枝叶锚点、数量和包围尺度。layer=whole包含枝叶；branches/leaves可用完全相同结构参数和姿态拆成两部件，分别绑定枝与叶材质。叶片双面有厚度，每片UV完整0..1，含枝条真实连接，不是广告牌或填满体积的块。灰模segments=2、layer=whole；详细阶段保持已验收结构参数与姿态，仅细分或分层绑定材质。展开真实三角形全部计入原预算；先替换错误组群，不对所有物体套用。';
