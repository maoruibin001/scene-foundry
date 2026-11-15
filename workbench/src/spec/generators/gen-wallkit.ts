/**
 * GEN-WALLKIT-01(密度模块):一段贴墙的工业机组,用来把大面积平墙变成概念图那种层层堆叠的设备墙。
 * 局部坐标:墙面在 z=0,机组朝 +Z 伸出;宽沿 X(width),高沿 Y(height)。规格里不旋转时朝规格 -Y,
 * 放北墙;西墙绕 Z 转 90°,东墙 -90°,南墙 180°。
 * 内容(按 seed 确定性排布):分缝背板、2–4 束竖向管束(带卡箍)、上下两条横向线槽、若干控制箱/接线盒(带指示灯)、
 * 小琥珀壁灯。每块都贴着墙往外叠,不悬空。
 */
import type {Model} from '@forgeax/engine/modeling';
import {defineGenerator} from './kit.ts';
import {rod} from './parts.ts';

const rng=(seed:number)=>{let s=(seed*2654435761)>>>0||1;return ()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return ((s>>>0)%100000)/100000;};};

export const GEN_WALLKIT=defineGenerator({
 id:'GEN-WALLKIT-01',label:'墙面机组(密度模块)',
 params:{
  width:{type:'number',default:6,min:1,max:30},
  height:{type:'number',default:5,min:1,max:80},
  seed:{type:'int',default:1,min:0,max:9999},
  pipeBundles:{type:'int',default:3,min:0,max:8},
  boxes:{type:'int',default:4,min:0,max:16},
  lamps:{type:'int',default:2,min:0,max:8},
  tiers:{type:'int',default:0,min:0,max:16},
  style:{type:'int',default:0,min:0,max:2},
 },
 slots:['panel','pipe','clamp','box','indicator','tray','window','trim','glow','screen'],
 build(m:Model,p){
  if(p.style===2)return darkTechFacade(m,p);
  if(p.style===1)return techFacade(m,p);
  if(p.tiers>0)return facade(m,p);
  const W=p.width,H=p.height,r=rng(p.seed);
  // 背板:按 1.2m × 1.0m 分格,每格深度略有起伏,留 2cm 缝
  const cw=1.2,ch=1.0,nx=Math.max(1,Math.round(W/cw)),ny=Math.max(1,Math.round(H/ch)),gw=W/nx,gh=H/ny;
  for(let i=0;i<nx;i++)for(let j=0;j<ny;j++){const d=0.03+r()*0.05;m.box({size:[gw-0.02,gh-0.02,d],center:[-W/2+gw*(i+0.5),gh*(j+0.5),d/2],material:'panel',label:'kit-panel'});}
  // 横向线槽:两条,带吊架
  for(const y of [H*0.38,H*0.82]){
   m.box({size:[W,0.06,0.35],center:[0,y,0.32],material:'tray',label:'kit-tray'});
   m.box({size:[W,0.12,0.02],center:[0,y+0.06,0.49],material:'tray',label:'kit-tray-lip'});
   for(let x=-W/2+0.4;x<W/2;x+=1.2)m.box({size:[0.04,0.06,0.32],center:[x,y-0.05,0.16],material:'clamp',label:'kit-tray-arm'});
   // 线槽里的线缆
   for(let k=0;k<4;k++)rod(m,[-W/2+0.05,y+0.06,0.2+k*0.07],[W/2-0.05,y+0.06,0.2+k*0.07],0.022,'box','kit-cable',6);
  }
  // 竖向管束:每束 2–3 根,带卡箍
  for(let b=0;b<p.pipeBundles;b++){
   const x=-W/2+W*(b+0.5)/p.pipeBundles+(r()-0.5)*0.4,n=2+Math.floor(r()*2),dia=0.08+r()*0.08;
   for(let k=0;k<n;k++){const xz=x+(k-(n-1)/2)*dia*2.4;rod(m,[xz,0.1,0.22+dia],[xz,H-0.05,0.22+dia],dia,'pipe','kit-pipe',10);}
   for(let y=0.6;y<H;y+=0.9)m.box({size:[n*dia*2.4+0.1,0.06,dia*2+0.12],center:[x,y,0.22+dia],material:'clamp',label:'kit-pipe-clamp'});
  }
  // 控制箱 / 接线盒:贴在背板上,带一两个指示灯
  for(let k=0;k<p.boxes;k++){
   const bw=0.4+r()*0.6,bh=0.5+r()*0.7,bd=0.2+r()*0.2,x=-W/2+bw/2+r()*(W-bw),y=0.4+bh/2+r()*Math.max(0.01,H*0.32-bh);
   m.box({size:[bw,bh,bd],center:[x,y,0.08+bd/2],material:'box',label:'kit-box'});
   m.box({size:[bw*0.85,bh*0.85,0.01],center:[x,y,0.08+bd+0.005],material:'clamp',label:'kit-box-door'});
   m.box({size:[0.05,0.05,0.02],center:[x+bw*0.3,y+bh*0.35,0.08+bd+0.015],material:'indicator',label:'kit-led'});
   if(r()>0.5)m.box({size:[0.05,0.05,0.02],center:[x+bw*0.18,y+bh*0.35,0.08+bd+0.015],material:'indicator',label:'kit-led'});
  }
  // 小琥珀壁灯
  for(let k=0;k<p.lamps;k++){const x=-W/2+W*(k+0.5)/p.lamps;m.box({size:[0.3,0.16,0.12],center:[x,H*0.6,0.12],material:'box',label:'kit-lamp'});m.box({size:[0.24,0.1,0.02],center:[x,H*0.6,0.19],material:'indicator',label:'kit-lamp-lens'});}
 },
});

/**
 * tiers>0:整面墙的多层设施立面(概念图墙面读作层层叠起的楼层)。每层:分格背板、一条亮着的窄窗带(部分格子熄灭)、
 * 层间挑檐 + 细栏杆;竖向肋板按 1.5m 贯通全高;两束竖管贯通;每层若干琥珀小灯与设备箱。
 */
function facade(m:Model,p:{width:number;height:number;seed:number;tiers:number;pipeBundles:number;boxes:number;lamps:number}){
 const W=p.width,H=p.height,r=rng(p.seed),th=H/p.tiers;
 m.box({size:[W,H,0.04],center:[0,H/2,0.02],material:'panel',label:'fac-back'});
 for(let t=0;t<p.tiers;t++){
  const y0=t*th;
  // 窗带:按 0.6–2.4m 随机分段,段间夹实墙/设备板;约一半亮着,其余是暗玻璃,避免规则平铺像写字楼。
  const wy=y0+th*0.55,wh=Math.min(0.9,th*0.3);
  for(let x=-W/2+0.1;x<W/2-0.4;){const len=Math.min(W/2-0.1-x,0.6+r()*1.8),kind=r();
   if(kind<0.25){m.box({size:[len,wh*1.6,0.18],center:[x+len/2,wy,0.13],material:'box',label:'fac-equip'});
    for(let k=0;k<2;k++)m.box({size:[len*0.8,0.04,0.02],center:[x+len/2,wy-wh*0.4+k*wh*0.8,0.23],material:'clamp',label:'fac-equip-rib'});}
   else m.box({size:[len-0.1,wh,0.03],center:[x+len/2,wy,0.06],material:'box',label:'fac-win'});
   x+=len+0.15+r()*0.6;}
  // 层间挑檐 + 栏杆
  if(t>0){m.box({size:[W,0.18,0.9],center:[0,y0,0.45],material:'tray',label:'fac-ledge'});
   m.box({size:[W,0.03,0.04],center:[0,y0-0.11,0.86],material:'window',label:'fac-ledge-strip'});
   m.box({size:[W,0.04,0.04],center:[0,y0+1.0,0.88],material:'clamp',label:'fac-rail'});
   for(let x=-W/2+0.2;x<W/2;x+=1.2)m.box({size:[0.04,1.0,0.04],center:[x,y0+0.5,0.88],material:'clamp',label:'fac-post'});}
  // 设备箱与小灯
  for(let k=0;k<p.boxes;k++){const bw=0.4+r()*0.5,bh=0.4+r()*0.5,x=-W/2+bw/2+r()*(W-bw),y=y0+0.25+bh/2+r()*Math.max(0.01,th*0.25-bh);
   m.box({size:[bw,bh,0.25],center:[x,y,0.17],material:'box',label:'fac-box'});
   m.box({size:[0.05,0.05,0.02],center:[x+bw*0.3,y+bh*0.3,0.31],material:'indicator',label:'fac-led'});}
  for(let k=0;k<p.lamps;k++){const x=-W/2+W*(k+0.5)/p.lamps;m.box({size:[0.18,0.1,0.06],center:[x,y0+th*0.9,0.08],material:'indicator',label:'fac-lamp'});}
 }
 // 竖向肋板贯通全高
 for(let x=-W/2;x<=W/2+1e-6;x+=1.5)m.box({size:[0.12,H,0.22],center:[x,H/2,0.11],material:'clamp',label:'fac-rib'});
 for(let b=0;b<p.pipeBundles;b++){const x=-W/2+W*(b+0.5)/p.pipeBundles+0.4;for(let k=0;k<2;k++)rod(m,[x+k*0.28,0.1,0.32],[x+k*0.28,H-0.1,0.32],0.09,'pipe','fac-pipe',8);}
}

/**
 * style=1 高科技立面(科幻调研 2026-11-07:浅色漆面板 + 深色缝 + 沿缝发光线 + 点彩光点 + 屏幕):
 * 每层:浅色面板(trim 深色倒角框)按 2.4m 分块,块间深色缝里嵌青白发光细条;层间挑檐下一条连续发光线;
 * 每块面板角上 2 个小光点;每层若干块换成发光屏幕(深色底 + 亮边);竖向深色肋板贯通全高。
 */
function techFacade(m:Model,p:{width:number;height:number;seed:number;tiers:number}){
 const W=p.width,H=p.height,r=rng(p.seed),T=Math.max(1,p.tiers||8),th=H/T,pw=2.4,n=Math.max(1,Math.round(W/pw)),bw=W/n;
 m.box({size:[W,H,0.06],center:[0,H/2,0.03],material:'trim',label:'tf-back'});
 for(let t=0;t<T;t++){const y0=t*th;
  for(let i=0;i<n;i++){const x=-W/2+bw*(i+0.5),screen=r()<0.12;
   const ph=th-0.5;
   m.box({size:[bw-0.12,ph,0.12],center:[x,y0+0.25+ph/2,0.12],material:screen?'trim':'panel',label:'tf-panel'});
   if(screen){m.box({size:[bw-0.5,ph*0.55,0.02],center:[x,y0+0.25+ph*0.55,0.19],material:'screen',label:'tf-screen'});}
   else{m.box({size:[bw-0.5,0.05,0.03],center:[x,y0+0.25+ph*0.82,0.19],material:'trim',label:'tf-groove'});m.box({size:[0.2,ph*0.5,0.03],center:[x-bw*0.3,y0+0.25+ph*0.4,0.19],material:'trim',label:'tf-groove'});}
   for(const dx of [-1,1])m.box({size:[0.08,0.08,0.03],center:[x+dx*(bw/2-0.25),y0+0.45,0.2],material:'indicator',label:'tf-dot'});
   m.box({size:[0.04,ph,0.04],center:[x+bw/2,y0+0.25+ph/2,0.17],material:'glow',label:'tf-seam'});}
  m.box({size:[W,0.25,0.7],center:[0,y0+th,0.35],material:'trim',label:'tf-ledge'});
  m.box({size:[W,0.05,0.04],center:[0,y0+th-0.16,0.7],material:'glow',label:'tf-ledge-line'});}
 for(let x=-W/2;x<=W/2+1e-6;x+=bw*2)m.box({size:[0.3,H,0.35],center:[x,H/2,0.17],material:'trim',label:'tf-rib'});
}

/**
 * style=2 深色科技立面(圆厅验证 2026-11-07:浅色面板读作瓷砖,科技感弱):深色金属面板 + 密集发光分割线。
 * 每层:面板按 1.6m 分块,块间竖向发光缝;面板中腰一条内凹发光线(约 60% 块亮);约 30% 块换成竖向屏幕组
 * (2–3 块窄屏 + 亮框);层底挑檐带连续发光线 + 栏杆(比例参照);面板角点阵指示灯;每 3 块一根贯通肋板夹竖管。
 */
function darkTechFacade(m:Model,p:{width:number;height:number;seed:number;tiers:number}){
 const W=p.width,H=p.height,r=rng(p.seed),T=Math.max(1,p.tiers||8),th=H/T,n=Math.max(1,Math.round(W/1.6)),bw=W/n;
 m.box({size:[W,H,0.06],center:[0,H/2,0.03],material:'trim',label:'dt-back'});
 for(let t=0;t<T;t++){const y0=t*th,ph=th-0.7,yc=y0+0.35+ph/2;
  for(let i=0;i<n;i++){const x=-W/2+bw*(i+0.5),k=r();
   if(k<0.08){
    m.box({size:[bw-0.08,ph,0.1],center:[x,yc,0.1],material:'trim',label:'dt-screen-frame'});
    const ns=2+Math.floor(r()*2),sh=(ph-0.4)/ns;
    for(let j=0;j<ns;j++)m.box({size:[bw-0.34,sh-0.12,0.02],center:[x,y0+0.55+sh*(j+0.5),0.16],material:'screen',label:'dt-screen'});
    m.box({size:[bw-0.2,0.04,0.03],center:[x,y0+0.45,0.17],material:'glow',label:'dt-screen-edge'});
   }else{
    m.box({size:[bw-0.08,ph,0.14],center:[x,yc,0.12],material:'panel',label:'dt-panel'});
    m.box({size:[bw-0.3,0.12,0.03],center:[x,yc+(r()-0.5)*ph*0.3,0.2],material:'trim',label:'dt-recess'});
    if(k<0.75)m.box({size:[bw-0.4,0.06,0.03],center:[x,yc+ph*0.28,0.2],material:'glow',label:'dt-midline'});
    for(let d=0;d<4;d++)m.box({size:[0.05,0.05,0.02],center:[x-bw/2+0.22+d*0.1,y0+0.6,0.2],material:d===0&&r()<0.3?'window':'indicator',label:'dt-dot'});
   }
   m.box({size:[0.07,ph,0.04],center:[x+bw/2,yc,0.18],material:'glow',label:'dt-seam'});
  }
  m.box({size:[W,0.3,1.1],center:[0,y0+th-0.15,0.55],material:'trim',label:'dt-ledge'});
  m.box({size:[W,0.1,0.05],center:[0,y0+th-0.32,1.08],material:'glow',label:'dt-ledge-line'});
  m.box({size:[W,0.05,0.05],center:[0,y0+th+1.05,1.05],material:'clamp',label:'dt-rail'});
  for(let x=-W/2+0.3;x<W/2;x+=1.6)m.box({size:[0.05,1.05,0.05],center:[x,y0+th+0.52,1.05],material:'clamp',label:'dt-post'});
 }
 for(let x=-W/2;x<=W/2+1e-6;x+=bw*3){m.box({size:[0.4,H,0.4],center:[x,H/2,0.2],material:'trim',label:'dt-rib'});rod(m,[x+0.35,0.1,0.32],[x+0.35,H-0.1,0.32],0.08,'pipe','dt-pipe',8);}
}
