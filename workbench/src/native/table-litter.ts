import {MeshBuilder,type V} from './mesh';
import {clothPoint} from './cloth';
import {TABLE_SURFACE} from './tabletop';

// 固定种子生成局部散物；位置贴合真实布面，不把平面噪声当作碎片网格。
export function addTableLitter(g:MeshBuilder,w:number,d:number,options:any){
 const contacts=options.tableContactAreas??[],clear=options.tableLitterKeepClear??[];
 let seed=options.tableCupPosition?90217:17303;
 const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 const z=(x:number,y:number)=>clothPoint(.5+x/(w+.64),.5+y/(d+.56),w,d,contacts)[2];
 const count=options.tableCupPosition?620:190;
 for(let i=0,placed=0;i<count*12&&placed<count;i++){
  const x=(random()*2-1)*(w/2-.055),y=(random()*2-1)*(d/2-.055);
  const density=Math.exp(-((x+.08)**2/.17+(y-.04)**2/.40));
  if(random()>.12+.88*density)continue;
  const fine=random()<.72,r=fine?.003+random()*.011:.015+random()*.035;
  if(clear.some((b:number[])=>x+r>b[0]&&x-r<b[2]&&y+r>b[1]&&y-r<b[3]))continue;
  // 灯罩圆形底边保留净距，罩内和破口周围可有碎屑，避免穿过完整压边。
  if((options.tableLitterLampAreas??[]).some((b:number[])=>{
   const rx=(b[2]-b[0])/2,ry=(b[3]-b[1])/2,q=Math.hypot((x-(b[0]+b[2])/2)/rx,(y-(b[1]+b[3])/2)/ry);
   return Math.abs(q-1)<.08+r/Math.min(rx,ry);
  }))continue;
  placed++;
  const mat=fine?'soil':placed%7===0?'glassArt':placed%4===0?'paper':'soil';
  const sides=mat==='glassArt'?3:5,a=random()*Math.PI*2,uvx=random()*.6,uvy=random()*.6;
  const edge:V[]=Array.from({length:sides},(_,k)=>{const t=a+k/sides*Math.PI*2,rr=r*(.68+random()*.32),xx=x+Math.cos(t)*rr,yy=y+Math.sin(t)*rr;return [xx,yy,z(xx,yy)+.004];});
  const center:V=[x,y,z(x,y)+.004+(fine?.004:.010+random()*.020)];
  for(let k=0;k<sides;k++){
   const p=edge[k],q=edge[(k+1)%sides];
   g.triangle(mat,[center,p,q],[[uvx+.12,uvy+.12],[uvx,uvy],[uvx+.24,uvy]]);
   const low=(v:V):V=>[v[0],v[1],v[2]-.002];
   g.quad(mat,[p,low(p),low(q),q]);
  }
 }
 if(options.tableCupPosition)addFallenCup(g,options.tableCupPosition);
}

// 侧倒纸杯保留外壳、卷口、杯底和内壁，开口不是实心黑圆片。
export function addFallenCup(g:MeshBuilder,center:number[]){
 const profile=[[0,0],[.042,0],[.046,.008],[.058,.17],[.061,.18],[.058,.187],[.052,.187],[.049,.17],[.037,.015],[0,.015]];
 const angle=.5,c=Math.cos(angle),s=Math.sin(angle),N=48;
 const point=(i:number,j:number):V=>{const [r,h]=profile[j],t=i/N*Math.PI*2,x=r*Math.cos(t),y=.0935-h;return [center[0]+c*x-s*y,center[1]+s*x+c*y,TABLE_SURFACE+.063+r*Math.sin(t)];};
 for(let j=0;j<profile.length-1;j++)for(let i=0;i<N;i++)g.quad(j===7?'paper':'cream',[point(i,j),point(i+1,j),point(i+1,j+1),point(i,j+1)]);
}
