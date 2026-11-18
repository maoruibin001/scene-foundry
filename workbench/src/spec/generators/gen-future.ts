/**
 * GEN-FUTURE-01(圆厅科技感 A/B 2026-11-08:旧件全是方管/细线网格,读作钢结构厂房):未来风大形体件。
 * 共同原则:大面积连续回转曲面 + 干净倒角 + 少而精的发光线。局部原点在地面中心,Y 向上(引擎轴)。
 * mode=0 圆墙:半径 radius、高 height、tiers 层;每层一段微鼓的光滑面板,层间内凹槽嵌一道发光环;每 24° 一条深色竖缝。
 * mode=1 穹顶天花:从 radius 处 height 高起拱到中心圆孔(oculusRadius),拱面嵌 3 道发光环,圆孔是发光盘。
 * mode=2 核心球:光滑壳 + 赤道内凹发光缝 + 上下两道深色细带。
 * mode=3 光柱:底座 + 光滑柱身 + 顶帽,四条竖向内嵌发光芯 + 底部发光环。
 * mode=4 地面嵌灯环:rings 道同心细环(innerRadius..radius)。
 * mode=5 扁平光环带:外径 radius、带宽 width、厚 depth 的扁平环,内沿一道发光边。
 */
import {sel,type Model} from '@forgeax/engine/modeling';
import {defineGenerator} from './kit.ts';

type P=Record<string,number>;
/** 闭合剖面统一成 (r,y) 平面逆时针(建模内核要求正体积)。 */
const ccw=(pts:[number,number][])=>{let a=0;for(let i=0;i<pts.length-1;i++)a+=pts[i]![0]*pts[i+1]![1]-pts[i+1]![0]*pts[i]![1];return a<0?[...pts].reverse():pts;};
const ring=(m:Model,r0:number,r1:number,y0:number,y1:number,material:string,label:string,segments=128)=>
 m.revolve({points:[[r0,y0],[r1,y0],[r1,y1],[r0,y1],[r0,y0]],segments,material,label});

export const GEN_FUTURE=defineGenerator({
 id:'GEN-FUTURE-01',label:'未来风大形体件',
 params:{
  mode:{type:'int',default:0,min:0,max:5},
  radius:{type:'number',default:38,min:0.5,max:200},
  height:{type:'number',default:46,min:0.1,max:200},
  tiers:{type:'int',default:6,min:1,max:24},
  oculusRadius:{type:'number',default:5,min:0.5,max:50},
  rise:{type:'number',default:6,min:0,max:50},
  innerRadius:{type:'number',default:8,min:0,max:200},
  rings:{type:'int',default:4,min:1,max:16},
  width:{type:'number',default:0.8,min:0.02,max:20},
  depth:{type:'number',default:0.12,min:0.01,max:5},
 },
 slots:['shell','dark','glow','sky'],
 build(m:Model,p:P){
  const R=p.radius,H=p.height;
  if(p.mode===0){
   const T=p.tiers,th=H/T,pts:[number,number][]=[[R+0.4,0],[R-0.1,0]];
   for(let t=0;t<T;t++){const y0=t*th;
    pts.push([R-0.1,y0+0.35],[R-0.45,y0+0.7],[R-0.6,y0+th*0.5],[R-0.45,y0+th-0.7],[R-0.1,y0+th-0.35],[R-0.1,y0+th]);}
   pts.push([R+0.4,H],[R+0.4,0]);
   m.revolve({points:ccw(pts),segments:96,material:'shell',label:'fw-shell'});
   for(let t=1;t<T;t++)ring(m,R-0.2,R-0.08,t*th-0.06,t*th+0.06,'glow','fw-line',96);
   ring(m,R-0.3,R-0.08,0.9,1.05,'glow','fw-base-line',96);
   for(let k=0;k<15;k++){const label='fw-slot'+k;m.box({size:[0.35,H-0.8,0.6],center:[0,H/2,-(R-0.45)],material:'dark',label});m.rotate(sel.createdBy(label),'y',k*24+12);}
  }else if(p.mode===1){
   const O=p.oculusRadius,n=24,top:[number,number][]=[];
   for(let i=0;i<=n;i++){const u=i/n,r=R+(O-R)*u,y=H+p.rise*Math.sin(u*Math.PI/2);top.push([r,y]);}
   m.revolve({points:ccw([...top,[O,H+p.rise+0.5],[R+0.4,H+0.5],[R+0.4,H],[R,H]]),segments:160,material:'shell',label:'fc-dome'});
   for(const f of [0.25,0.5,0.75]){const r=R+(O-R)*f,y=H+p.rise*Math.sin(f*Math.PI/2)-0.04;ring(m,r-0.18,r+0.18,y-0.04,y,'glow','fc-line');}
   ring(m,O-0.25,O+0.05,H+p.rise-0.1,H+p.rise+0.02,'glow','fc-oculus-rim',96);
   m.revolve({points:[[0,H+p.rise+0.3],[O,H+p.rise+0.3],[O,H+p.rise+0.32],[0,H+p.rise+0.32]],segments:96,material:'sky',label:'fc-oculus'});
  }else if(p.mode===2){
   m.sphere({radius:R,widthSegments:48,heightSegments:24,material:'shell',label:'fs-shell'});
   ring(m,R*0.97,R*1.005,-R*0.025,R*0.025,'glow','fs-equator',64);
   for(const s of [-1,1]){const y=s*R*0.5,r=R*Math.cos(Math.asin(0.5));ring(m,r*0.99,r*1.012,y-R*0.012,y+R*0.012,'dark','fs-band',64);}
   const cy=R*0.92,cr=R*Math.cos(Math.asin(0.92));ring(m,cr*0.6,cr*1.01,cy,cy+R*0.01,'glow','fs-cap',48);
  }else if(p.mode===3){
   const r=p.width;
   m.revolve({points:[[0,0],[r*1.5,0],[r*1.5,0.5],[r*1.25,0.8],[r,1.0],[r,H-1.2],[r*1.25,H-0.8],[r*1.25,H-0.3],[r*0.9,H],[0,H]],segments:64,material:'shell',label:'fp-body'});
   for(let k=0;k<4;k++){const label='fp-core'+k;m.box({size:[r*0.22,H-3,0.06],center:[0,H/2,r*0.99],material:'glow',label});m.rotate(sel.createdBy(label),'y',k*90+45);}
   ring(m,r*1.25,r*1.52,0.5,0.56,'glow','fp-base-line',64);
   ring(m,r*1.0,r*1.27,H-0.82,H-0.76,'glow','fp-top-line',64);
  }else if(p.mode===4){
   for(let i=0;i<p.rings;i++){const r=p.innerRadius+(R-p.innerRadius)*i/Math.max(1,p.rings-1);ring(m,r-p.width/2,r+p.width/2,0,0.02,'glow','ff-ring',160);}
  }else{
   const w=p.width,d=p.depth;
   m.revolve({points:ccw([[R-w,-d/2],[R-0.05,-d/2],[R,-d/4],[R,d/4],[R-0.05,d/2],[R-w,d/2],[R-w,-d/2]]),segments:160,material:'shell',label:'fb-band'});
   ring(m,R-w-0.03,R-w+0.02,-d*0.3,d*0.3,'glow','fb-edge',160);
  }
 },
});
