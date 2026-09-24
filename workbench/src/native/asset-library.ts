import {MeshBuilder,type V,norm,cross,sub,triangulatePolygon} from './mesh';
import {BOOTH_BASE,TABLE_SURFACE} from './tabletop';
import {clothPoint,clothNormal} from './cloth';
import {addTableLitter} from './table-litter';
export function nativeAsset(kind:string,atlas:any,options:any={}){
const g=new MeshBuilder(atlas);let seed=703;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const box=(m:string,p:V,s:V)=>g.box(m,p,s),tube=(m:string,a:V,b:V,r:number,rt=r)=>g.tube(m,a,b,r,rt),at=(name:string,p:V,yaw:number,fn:()=>void)=>g.at(name,p,yaw,fn);
function bottle(x:number,y:number,z:number,color:string){g.lathe(color,[x,y,z],[[.058,0],[.068,.03],[.066,.22],[.046,.26],[.025,.29],[.025,.38]],16);g.lathe('metal',[x,y,z+.37],[[.029,0],[.029,.03]],16);}
function tableItems(x:number,y:number,z:number){bottle(x,y,z,'red');bottle(x+.16,y+.03,z,'green');g.rounded('cream',[x-.17,y,z+.10],[.15,.14,.20],.025);box('dark',[x-.17,y-.073,z+.10],[.105,.005,.1]);g.lathe('cream',[x+.32,y,z],[[.033,0],[.045,.12],[.050,.13]],12);}
function booth(name:string,x:number,y:number,dir:number){at(name,[x,y,0],dir,()=>{
 box('wood',[0,0,.26],[.58,1.90,.50]);g.rounded('leather',[0,0,.53],[.63,1.91,.16],.065);
 box('wood',[-.29,0,.51],[.08,1.99,1.00]);box('leather',[-.205,0,.805],[.105,1.89,.46]);
 // 连续软包表皮，沟槽压入整块皮革，不再用一排独立方块代替靠背。
 const point=(u:number,v:number):V=>{const y=(u*2-1)*.94,z=.575+v*.46,edge=Math.sin(Math.PI*v),rib=Math.abs(Math.sin(u*Math.PI*8));return [-.158+.050*Math.pow(rib,.7)*Math.pow(Math.max(0,edge),.35)+.003*Math.sin(u*103+v*17)*edge,y,z];};
 const vertex=(u:number,v:number)=>({p:point(u,v),n:norm(cross(sub(point(u+.0001,v),point(u-.0001,v)),sub(point(u,v+.0001),point(u,v-.0001)))),uv:[u*2,v]});
 for(let i=0;i<72;i++)for(let j=0;j<24;j++){const a=vertex(i/72,j/24),b=vertex((i+1)/72,j/24),c=vertex((i+1)/72,(j+1)/24),d=vertex(i/72,(j+1)/24);for(const t of [[a,b,c],[a,c,d]])g.triangle('leather',t.map(q=>q.p),t.map(q=>q.uv),t.map(q=>q.n));}
 box('wood',[-.28,0,1.045],[.14,2.0,.055]);for(const y of [-.97,.97]){g.rounded('leather',[-.13,y,.52],[.43,.065,1.02],.025);tube('leather',[-.14,y,.59],[-.14,y,1.03],.007);}
 });}
function clothTable(name:string,x:number,y:number,w:number,d:number){at(name,[x,y,0],0,()=>{
 box('wood',[0,0,.79],[w,d,.12]);for(const a of [-1,1])for(const b of [-1,1])box('wood',[a*(w/2-.12),b*(d/2-.13),.37],[.065,.07,.74]);
 const N=56,M=72,contacts=options.tableContactAreas??[];
 const vertex=(u:number,v:number)=>({p:clothPoint(u,v,w,d,contacts),n:clothNormal(u,v,w,d,contacts),uv:[u*(w+.64)/.65,v*(d+.56)/.65]});
 for(let i=0;i<N;i++)for(let j=0;j<M;j++){const a=vertex(i/N,j/M),b=vertex((i+1)/N,j/M),c=vertex((i+1)/N,(j+1)/M),d=vertex(i/N,(j+1)/M);for(const t of [[a,b,c],[a,c,d]]){g.triangle('cloth',t.map(q=>q.p),t.map(q=>q.uv),t.map(q=>q.n));g.triangle('cloth',[...t].reverse().map(q=>[q.p[0],q.p[1],q.p[2]-.001] as V),[...t].reverse().map(q=>q.uv),[...t].reverse().map(q=>q.n.map(n=>-n) as V));}}
 const [ix,iy]=options.tableItemsPosition??[-.23,.65];tableItems(ix,iy,TABLE_SURFACE);
 if(options.tableLitterKeepClear)addTableLitter(g,w,d,options);
 });}
function chair(name:string,x:number,y:number,angle:number){at(name,[x,y,0],angle,()=>{for(const a of [-1,1])for(const b of [-1,1]){tube('wood',[a*.22,b*.21,.045],[a*.19,b*.18,.48],.032,.029);if(b===1)tube('wood',[a*.19,b*.18,.45],[a*.24,b*.27,1.04],.028,.032);}g.rounded('leather',[0,0,.48],[.51,.46,.09],.038);for(const a of [-1,1])tube('wood',[a*.21,-.2,.22],[a*.21,.2,.22],.017);for(let i=-2;i<=2;i++)tube('wood',[i*.078,.205,.58],[i*.085,.265,.98],.014);box('wood',[0,.27,1.02],[.56,.066,.11]);});}
function cafe(name:string,x:number,y:number){at(name,[x,y,0],0,()=>{g.lathe('wood',[0,0,.76],[[.53,0],[.57,.025],[.57,.06],[.53,.08]],48);g.lathe('wood',[0,0,.10],[[.09,0],[.07,.53],[.12,.67]],16);for(let i=0;i<3;i++){const a=i*Math.PI*2/3;tube('wood',[0,0,.21],[Math.cos(a)*.42,Math.sin(a)*.42,.05],.045,.031);}});}
function arcade(){at('街机',[0,0,0],0,()=>{
 const poly=[[-.41,0],[.43,0],[.43,1.91],[.29,2.10],[-.34,2.10],[-.49,1.94],[-.35,1.58],[-.43,1.35],[-.60,1.03],[-.44,.88]];
 const triangles=triangulatePolygon(poly),n=poly.length;
 for(const side of [-1,1]){const outer=side*.47,inner=side*.435;
  for(const tri of triangles){const ids=side<0?[...tri].reverse():tri,points=ids.map(i=>[outer,poly[i][0],poly[i][1]] as V);g.triangle('arcade',points,points.map(p=>{const u=(p[1]+.60)/1.03;return [side<0?1-u:u,1-p[2]/2.1];}));g.triangle('cabinetPaint',[...points].reverse().map(p=>[inner,p[1],p[2]] as V));}
  for(let i=0;i<n;i++){const a=poly[i],b=poly[(i+1)%n],ps:V[]=[[outer,a[0],a[1]],[inner,a[0],a[1]],[inner,b[0],b[1]],[outer,b[0],b[1]]];if(side<0)ps.reverse();g.quad('cabinetPaint',ps);tube('wood',[outer,a[0],a[1]],[outer,b[0],b[1]],.012);}
 }
 box('cabinetPaint',[0,.035,.46],[.87,.78,.92]);box('arcadeFront',[0,-.365,.46],[.86,.018,.88]);
 box('metal',[.235,-.386,.48],[.18,.025,.36]);box('dark',[.235,-.402,.57],[.125,.007,.026]);box('metal',[.235,-.404,.36],[.105,.035,.08]);box('dark',[.235,-.425,.367],[.071,.007,.035]);
 for(let i=0;i<9;i++)box('dark',[-.19,-.38,.19+i*.016],[.29,.008,.005]);
 // 黑色凹入的 CRT 有曲面，外侧漆框与内侧玻璃分离。
 const outer:V[]=[[-.425,-.40,1.10],[.425,-.40,1.10],[.425,-.13,1.79],[-.425,-.13,1.79]],inner:V[]=[[-.345,-.29,1.22],[.345,-.29,1.22],[.345,-.05,1.69],[-.345,-.05,1.69]];
 for(let i=0;i<4;i++)g.quad('dark',[outer[i],outer[(i+1)%4],inner[(i+1)%4],inner[i]]);
 const screen=(u:number,v:number):V=>[(u-.5)*.69,-.29+v*.24-.025*Math.sin(u*Math.PI)*Math.sin(v*Math.PI),1.22+v*.47];
 for(let i=0;i<24;i++)for(let j=0;j<20;j++)g.quad('screen',[screen(i/24,j/20),screen((i+1)/24,j/20),screen((i+1)/24,(j+1)/20),screen(i/24,(j+1)/20)]);
 box('cabinetPaint',[0,-.39,1.93],[.92,.20,.28]);box('arcadeMarquee',[0,-.496,1.935],[.85,.016,.202]);
 const controls:V[]=[[-.445,-.60,1.03],[.445,-.60,1.03],[.425,-.33,1.20],[-.425,-.33,1.20]];
 g.quad('arcadePanel',controls);for(let i=0;i<3;i++)g.quad('cabinetPaint',[controls[i],controls[(i+1)%4],controls[(i+1)%4].map((v,k)=>k===2?v-.045:v) as V,controls[i].map((v,k)=>k===2?v-.045:v) as V]);
 const y=-.495,z=1.03+(y+.60)/.27*.17;
 g.lathe('metal',[-.20,y,z],[[.058,0],[.058,.010],[.028,.017]],24);tube('metal',[-.20,y,z+.01],[-.20,y,z+.145],.011);
 g.lathe('red',[-.20,y,z+.13],[[0,0],[.027,.007],[.035,.028],[.027,.05],[0,.057]],24);
 for(let i=0;i<3;i++){g.lathe('metal',[.035+i*.105,y,z],[[.035,0],[.035,.008]],20);g.lathe(i===1?'cream':'red',[.035+i*.105,y,z+.008],[[.027,0],[.027,.011],[.023,.017]],20);}
 });}
function lampshade(name:string,p:V,broken=false){at(name,p,0,()=>{
 const segments=96,rings=20,start=broken?.42:0,arc=broken?Math.PI*2-.92:Math.PI*2;
 const radius=(t:number)=>.045+.49*Math.sqrt(Math.max(0,1-t*t));
 const point=(i:number,j:number,inside=false):V=>{const t=j/rings,angle=start+i/segments*arc,r=radius(t)-(inside?.009:0);return [r*Math.cos(angle),r*Math.sin(angle),.34*t-(inside?.004:0)];};
 // 用沿罩面弧长的纬向坐标，避免平面投影把侧面的花瓣拉成长条。
 // 四个完整花纹绕灯罩排布；缺口贯穿玻璃及骨架，不能保留完整圆环遮住缺口。
 const uv=(i:number,j:number)=>[(start+i/segments*arc)/(Math.PI*2)*4,1-j/rings];
 const edge=(j:number)=>broken&&j<rings-2?(j%5===0?2:j%3===0?1:0):0;
 for(let i=0;i<segments;i++)for(let j=0;j<rings;j++){
  if(i<edge(j)||i>=segments-edge(j+1))continue;
  for(const inside of [false,true]){const ij=[[i,j],[i+1,j],[i+1,j+1],[i,j+1]];if(inside)ij.reverse();g.quad('glassArt',ij.map(([a,b])=>point(a,b,inside)),ij.map(([a,b])=>uv(a,b)));}
 }
 // 顶盖与最下沿保留黄铜压边，花纹内铅条由原生材质表达。
 for(const t of [0,1]){const r=radius(t);g.lathe('metal',[0,0,.34*t],[[r-.006,0],[r+.006,.01]],96,arc,start);}
 g.lathe('metal',[0,0,.34],[[.06,0],[.085,.012],[.06,.028],[.028,.045]],24);
 if(broken){for(let i=0;i<5;i++){const a=start-.06-i*.14,r=.31+i*.025;g.triangle('glassArt',[[r*Math.cos(a),r*Math.sin(a),.008],[(r+.09)*Math.cos(a),(r+.09)*Math.sin(a),.008],[(r+.07)*Math.cos(a-.13),(r+.07)*Math.sin(a-.13),.012]],[[.12,.15],[.31,.18],[.28,.40]]);}}
 });}
function picture(name:string,x:number,y:number,z:number,w:number,h:number){at(name,[x,y,z],0,()=>{
 // 真实画框、背板和有厚度的画布；可见图面不与框背共面。
 box('wood',[0,.018,0],[w+.06,.024,h+.06]);
 for(const side of [-1,1]){box('frame',[side*(w/2+.036),-.018,0],[.072,.09,h+.144]);box('frame',[0,-.018,side*(h/2+.036)],[w,.09,.072]);box('metal',[side*(w/2+.005),-.068,0],[.010,.007,h]);box('metal',[0,-.068,side*(h/2+.005)],[w,.007,.010]);}
 box('painting',[0,-.042,0],[w,.015,h]);
 });}
let base:V;
switch(kind){
 case 'booth_set':booth('卡座左',-.78,0,0);if(options.openSide!=='positive')booth('卡座右',.78,0,Math.PI);clothTable('餐桌',0,0,1.1,1.76);base=[...BOOTH_BASE];break;
 case 'booth_end':booth('近景卡座',0,0,0);base=[.71,2,1.08];break;
 case 'kitchen_shelf':at('旧柜架',[0,0,0],0,()=>{box('wood',[0,.06,.43],[1.5,.43,.86]);for(const x of [-.73,.73])box('wood',[x,.12,1],[.055,.30,2]);for(const z of [.91,1.35,1.69,1.98])box('wood',[0,.06,z],[1.5,.5,.045]);for(const x of [-.38,.38]){box('wood',[x,-.168,.43],[.69,.035,.75]);box('metal',[x+.22,-.193,.49],[.025,.025,.14]);}for(let j=0;j<5;j++)g.lathe('cream',[-.4,-.015,1.38+j*.027],[[.14,0],[.15,.018]],24);for(let j=0;j<3;j++)box('paper',[.28+j*.11,.07,1.52],[.085,.22,.25]);for(let j=0;j<3;j++)g.lathe('metal',[-.42+j*.24,.04,1.72],[[.08,0],[.08,.2]],20);});base=[1.5,.55,2];break;
 case 'arcade':arcade();base=[1,1.12,2.12];break;
 case 'pendant':lampshade('灯罩',[0,0,0]);base=[1.07,1.07,.405];break;
 case 'fallen_lamp':lampshade('残缺灯罩',[0,0,0],true);base=[1.07,1.07,.405];break;
 case 'chair':chair('木椅',0,0,0);base=[.56,.56,1.08];break;
 case 'round_table':cafe('圆桌',0,0);base=[1.14,1.14,.84];break;
 case 'fallen_table':cafe('倾倒圆桌',0,0);base=[1.14,1.14,.84];break;
 case 'picture':picture('挂画',0,0,.572,.8,1);base=[.944,.112,1.144];break;
 case 'debris':at('碎片',[0,0,0],0,()=>{for(let i=0;i<22;i++){const x=(random()-.5)*2,y=(random()-.5)*2,z=.02+random()*.02,r=.03+random()*.08;g.quad(i%3?'paper':'soil',[[x,y,z],[x+r*2,y,z],[x+r*1.7,y+r,z+.02],[x-.02,y+r,z]]);if(i%6===0)g.box('plaster',[x,y,z+.035],[r*2,r,.05]);}});base=[2.2,2.2,.10];break;
 default:throw Error('未知原生资产类型：'+kind);
}
const meshes=g.meshes();
if(kind==='fallen_table'){
 const angle=1.24,c=Math.cos(angle),s=Math.sin(angle),rotate=(v:number[])=>[v[0],v[1]*c-v[2]*s,v[1]*s+v[2]*c];
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 for(const m of meshes)for(let i=0;i<m.geometry.positions.length;i+=3){const p=rotate(m.geometry.positions.slice(i,i+3)),n=rotate(m.geometry.normals.slice(i,i+3));for(let k=0;k<3;k++){m.geometry.positions[i+k]=p[k];m.geometry.normals[i+k]=n[k];min[k]=Math.min(min[k],p[k]);max[k]=Math.max(max[k],p[k]);}}
 for(const m of meshes)for(let i=0;i<m.geometry.positions.length;i+=3)for(let k=0;k<3;k++)m.geometry.positions[i+k]-=k===2?min[k]:(min[k]+max[k])/2;
 base=max.map((v,k)=>v-min[k]) as V;
}
return {meshes,base};
}
export function placeNativeAsset(target:MeshBuilder,node:any,atlas:any,ceiling:number){
 const asset=nativeAsset(node.kind,atlas,node),scale=node.size.map((n:number,i:number)=>n/asset.base[i]);
 for(const m of asset.meshes){const a=m.geometry;target.at(node.id+'_'+m.name,node.position,node.rotation,()=>{for(let i=0;i<a.indices.length;i+=3){const indices=a.indices.slice(i,i+3),points=indices.map((n:number)=>a.positions.slice(n*3,n*3+3).map((v:number,k:number)=>v*scale[k]) as V),uv=indices.map((n:number)=>a.uvs.slice(n*2,n*2+2)),ns=indices.map((n:number)=>norm(a.normals.slice(n*3,n*3+3).map((v:number,k:number)=>v/scale[k]) as V));target.triangle(m.geometry.material.id,points,uv,ns);}});}
 if(node.kind==='pendant'){target.at(node.id+'_吊链',node.position,0,()=>{const start=node.size[2],end=Math.max(start,ceiling-node.position[2]);target.tube('metal',[0,0,start],[0,0,end],.008);for(let z=start;z<end;z+=.055)target.lathe('metal',[0,0,z],[[.013,0],[.015,.014],[.009,.029]],8);});}
}
