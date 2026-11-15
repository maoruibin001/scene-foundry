/**
 * GEN-POOL-01(手册卷三 §3;叶资产 WAT-001..006):中央水池。手册把 POOL_001 的枢轴放在水面(Z=-0.35),
 * 所以局部原点在水面中心;water/bottom 是大厅绝对高度,完成地面在 0,几何按差值放置。
 * 盆底与四壁、外沿金属包边、水面(独立材质,不与池沿共面)、排流格栅;宽沿 X、长沿局部 Z(规格 Y)。
 */
import {sel,type Model} from '@forgeax/engine/modeling';
import {defineGenerator} from './kit.ts';

export const GEN_POOL=defineGenerator({
 id:'GEN-POOL-01',label:'中央水池',assembly:true,
 params:{
  width:{type:'number',default:20,min:2,max:60},
  length:{type:'number',default:24,min:2,max:60},
  bottom:{type:'number',default:-2.5,min:-20,max:-0.2},
  water:{type:'number',default:-0.35,min:-19.9,max:-0.01},
  rim:{type:'number',default:0.25,min:0.05,max:2},
  wallThickness:{type:'number',default:0.3,min:0.05,max:2},
  drains:{type:'int',default:4,min:0,max:16},
  round:{type:'bool',default:false},
  railHeight:{type:'number',default:0,min:0,max:2},
  railGapDeg:{type:'number',default:40,min:0,max:180},
 },
 slots:['basin','poolWall','rimCap','water','drainGrate','rail'],
 build(m:Model,p){
  if(p.water<=p.bottom+0.1)throw Error('GEN-POOL-01: 水面必须高于池底');
  const floorY=-p.water,bottomY=p.bottom-p.water,depth=floorY-bottomY,t=p.wallThickness,w=p.width,l=p.length;
  if(p.round){
   // 圆池:按半径 w/2 旋转出池底、池壁、池沿与水面,最后沿局部 Z 拉伸到 l(椭圆,冻结包络 w×l 不变)。
   const r=w/2,rect=(r0:number,r1:number,y0:number,y1:number):[number,number][]=>[[r0,y0],[r1,y0],[r1,y1],[r0,y1],[r0,y0]];
   m.cylinder({radiusTop:r+t,radiusBottom:r+t,height:t,radialSegments:96,center:[0,bottomY-t/2,0],material:'basin',label:'bed'});
   m.revolve({points:rect(r,r+t,bottomY,floorY),segments:96,material:'poolWall',label:'wall'});
   m.revolve({points:rect(r-0.05,r+p.rim,floorY,floorY+0.06),segments:96,material:'rimCap',label:'rim'});
   m.cylinder({radiusTop:r,radiusBottom:r,height:0.01,radialSegments:96,center:[0,-0.005,0],material:'water',label:'surface'});
   for(let i=0;i<p.drains;i++){const label='drain'+i;m.box({size:[0.06,0.5,1.2],center:[r-0.03,bottomY+0.45,0],material:'drainGrate',label});m.rotate(sel.createdBy(label),'y',45+i*360/p.drains);}
   if(p.railHeight>0){
    // 环形护栏:立柱 + 扶手环 + 中横环;朝局部 +Z(规格 -Y,入口方向)留 railGapDeg 开口。
    const rr=r+p.rim*0.6,H=p.railHeight,span=360-p.railGapDeg,start=90+p.railGapDeg/2,posts=Math.max(4,Math.round(span/360*2*Math.PI*rr/2));
    for(let i=0;i<=posts;i++){const a=(start+span*i/posts)*Math.PI/180,label='post'+i;m.box({size:[0.06,H,0.06],center:[rr*Math.cos(a),floorY+H/2,rr*Math.sin(a)],material:'rail',label});}
    for(const [y,hh] of [[H,0.05],[H*0.5,0.035]] as const){const label='ring'+y;m.revolve({points:rect(rr-hh/2,rr+hh/2,floorY+y-hh/2,floorY+y+hh/2),segments:72,angle:span,material:'rail',label});m.rotate(sel.createdBy(label),'y',-(start+span)+0);}
   }
   if(l!==w)m.scale(sel.all(),[1,1,l/w],[0,0,0]);
   return;
  }
  m.box({size:[w+2*t,t,l+2*t],center:[0,bottomY-t/2,0],material:'basin',label:'bed'});
  for(const s of [-1,1]){
   m.box({size:[w+2*t,depth,t],center:[0,bottomY+depth/2,s*(l/2+t/2)],material:'poolWall',label:'wall-long'});
   m.box({size:[t,depth,l],center:[s*(w/2+t/2),bottomY+depth/2,0],material:'poolWall',label:'wall-short'});
  }
  // 包边略高出完成地面,建立池沿高差与尺度参照;水面低于池沿,避免共面。
  const r=p.rim,lip=0.06;
  for(const s of [-1,1]){
   m.box({size:[w+2*r,lip,r],center:[0,floorY+lip/2,s*(l/2+r/2)],material:'rimCap',label:'rim-long'});
   m.box({size:[r,lip,l],center:[s*(w/2+r/2),floorY+lip/2,0],material:'rimCap',label:'rim-short'});
  }
  m.box({size:[w,0.01,l],center:[0,-0.005,0],material:'water',label:'surface'});
  for(let i=0;i<p.drains;i++){
   const side=i%2?1:-1,along=(Math.floor(i/2)/Math.max(1,Math.ceil(p.drains/2)-1||1)-0.5)*w*0.6;
   m.box({size:[1.2,0.5,0.06],center:[p.drains>1?along:0,bottomY+0.45,side*(l/2-0.03)],material:'drainGrate',label:`drain${i}`});
  }
 },
});
