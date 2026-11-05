/**
 * GEN-ENTRY-01(规格化新增;SAFE_BARRIER_001):入口隔爆门与浅门斗。局部原点在门平面中心的地面上,
 * 局部 +Z 指向门斗(规格 -Y,大厅外),局部 -Z 指向大厅。门扇按"平时开启"外观收进两侧门袋;
 * 门框带一圈发光条,门扇有不可碎观察窗;门轨与驱动箱在门洞上方;安全区地面标记在门斗内。
 */
import type {Model} from '@forgeax/engine/modeling';
import {defineGenerator} from './kit.ts';

export const GEN_ENTRY=defineGenerator({
 id:'GEN-ENTRY-01',label:'入口隔爆门与门斗',
 params:{
  doorClearWidth:{type:'number',default:6,min:1,max:20},
  doorHeight:{type:'number',default:4,min:2,max:12},
  vestibuleDepth:{type:'number',default:5,min:1,max:20},
  vestibuleWidth:{type:'number',default:8,min:2,max:30},
  vestibuleHeight:{type:'number',default:4.5,min:2.2,max:14},
  frameDepth:{type:'number',default:0.8,min:0.1,max:3},
  openFraction:{type:'number',default:1,min:0,max:1},
  safeMarkingSize:{type:'vec3',default:[6,3,0],min:0,max:30},
 },
 slots:['doorFrame','doorLeaf','observationWindow','doorRail','driveBox','vestibuleShell','vestibuleFloor','safeMarking','frameLight'],
 build(m:Model,p){
  const w=p.doorClearWidth,h=p.doorHeight,fd=p.frameDepth,jamb=0.5,head=0.6,vw=p.vestibuleWidth,vd=p.vestibuleDepth,vh=p.vestibuleHeight;
  if(vw<w+2*jamb)throw Error('GEN-ENTRY-01: 门斗宽度必须容下门洞与两侧门框');
  if(vh<h+0.3)throw Error('GEN-ENTRY-01: 门斗高度必须高于门洞');
  // 门框:两侧门柱 + 门楣,深度跨门平面。
  for(const s of [-1,1])m.box({size:[jamb,h+head,fd],center:[s*(w/2+jamb/2),(h+head)/2,0],material:'doorFrame',label:'jamb'});
  m.box({size:[w+2*jamb,head,fd],center:[0,h+head/2,0],material:'doorFrame',label:'head'});
  // 门框内侧发光条(朝大厅一面),给入口一个可读的光边。
  const strip=0.06,face=-fd/2-0.01;
  for(const s of [-1,1])m.box({size:[strip,h,0.02],center:[s*(w/2+strip/2),h/2,face],material:'frameLight',label:'frame-light'});
  m.box({size:[w+2*strip,strip,0.02],center:[0,h+strip/2,face],material:'frameLight',label:'frame-light'});
  // 门扇:左右两扇,开启量 openFraction(1 = 完全收进门袋);观察窗嵌在扇面中上部,两面各一片。
  const leafW=w/2,leafT=0.18,shift=p.openFraction*leafW;
  for(const s of [-1,1]){
   const cx=s*(leafW/2+shift),zc=fd/2+leafT/2+0.05;
   m.box({size:[leafW,h-0.05,leafT],center:[cx,(h-0.05)/2,zc],material:'doorLeaf',label:'leaf'});
   for(const side of [-1,1])m.box({size:[leafW*0.35,h*0.22,0.02],center:[cx,h*0.62,zc+side*(leafT/2+0.008)],material:'observationWindow',label:'window'});
  }
  // 门轨贯穿门洞两侧门袋,驱动箱在门轨中央上方。
  m.box({size:[2*w+2*jamb,0.14,0.2],center:[0,h+0.07,fd/2+0.2],material:'doorRail',label:'rail'});
  m.box({size:[1.6,0.5,0.45],center:[0,h+0.4,fd/2+0.3],material:'driveBox',label:'drive'});
  // 门斗壳体:两侧墙、顶板、后壁(后壁中间留通往外部走廊的门洞)。
  const t=0.25,z0=fd/2,z1=fd/2+vd;
  for(const s of [-1,1])m.box({size:[t,vh,vd],center:[s*(vw/2+t/2),vh/2,(z0+z1)/2],material:'vestibuleShell',label:'vest-wall'});
  m.box({size:[vw+2*t,t,vd],center:[0,vh+t/2,(z0+z1)/2],material:'vestibuleShell',label:'vest-roof'});
  const back=(vw-w*0.6)/2;
  for(const s of [-1,1])m.box({size:[back,vh,t],center:[s*(vw/2-back/2),vh/2,z1+t/2],material:'vestibuleShell',label:'vest-back'});
  m.box({size:[w*0.6,vh-3,t],center:[0,3+(vh-3)/2,z1+t/2],material:'vestibuleShell',label:'vest-back'});
  m.box({size:[vw,0.04,vd],center:[0,0.02,(z0+z1)/2],material:'vestibuleFloor',label:'vest-floor'});
  // 安全区标记:门斗地面上的矩形框线(斑马条留给贴花)。
  const [mx,mz]=p.safeMarkingSize,lw=0.15,mzc=(z0+z1)/2;
  if(mx>0&&mz>0)for(const s of [-1,1]){
   m.box({size:[mx,0.006,lw],center:[0,0.043,mzc+s*(mz/2-lw/2)],material:'safeMarking',label:'safe-mark'});
   m.box({size:[lw,0.006,mz],center:[s*(mx/2-lw/2),0.043,mzc],material:'safeMarking',label:'safe-mark'});
  }
 },
});
