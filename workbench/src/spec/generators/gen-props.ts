/**
 * 道具与设备:设备箱(GEN-PROP-01)、电气柜(GEN-CABINET-01)、杂项(GEN-DRESSING-01)、控制室陈设(GEN-CONSOLE-01)、
 * 导流体与存放座(GEN-CARRIER-01)。局部原点在物件脚底中心;规格尺寸 (x,y,z) 中 z 为高度,换到引擎是 (x,z 高,y 深)。
 * 同族不同部件用 kind 区分,由 adapt 按对象 ID 前缀确定。
 */
import type {Model} from '@forgeax/engine/modeling';
import {defineGenerator,nums} from './kit.ts';
import {bar,rod} from './parts.ts';

const size=(def:[number,number,number])=>({type:'vec3' as const,default:def,min:0.02,max:30});
const kindOf=(id:string|undefined,prefixes:string[])=>Math.max(0,prefixes.findIndex(p=>id?.startsWith(p)));

export const GEN_PROP=defineGenerator({
 id:'GEN-PROP-01',label:'设备箱',
 params:{size:size([0.8,0.6,0.6])},
 slots:['shell','lid','handle','vent','indicator','stencil'],
 build(m:Model,p){
  const [w,d,h]=p.size,lid=Math.min(0.06,h*0.12);
  m.box({size:[w,h-lid,d],center:[0,(h-lid)/2,0],material:'shell',label:'shell'});
  m.box({size:[w+0.02,lid,d+0.02],center:[0,h-lid/2,0],material:'lid',label:'lid'});
  for(const s of [-1,1])bar(m,[s*(w/2+0.02),h*0.6,-d*0.25],[s*(w/2+0.02),h*0.6,d*0.25],0.03,0.03,'handle','handle');
  for(let i=0;i<3;i++)m.box({size:[w*0.5,0.012,0.01],center:[0,h*0.35+i*0.05,d/2+0.004],material:'vent',label:'vent'});
  m.box({size:[0.05,0.03,0.01],center:[w*0.35,h*0.75,d/2+0.004],material:'indicator',label:'indicator'});
  m.box({size:[w*0.4,h*0.18,0.004],center:[-w*0.15,h*0.6,d/2+0.003],material:'stencil',label:'stencil'});
 },
});

export const GEN_CABINET=defineGenerator({
 id:'GEN-CABINET-01',label:'电气柜',
 params:{size:size([1.2,0.6,2]),count:{type:'int',default:1,min:1,max:12},frontSign:{type:'int',default:1,min:-1,max:1}},
 slots:['cabinet','door','plinth','warningDecal','indicator','vent'],
 // 一排柜沿规格 Y 排列;柜门朝大厅中心(对象在 X>0 侧则朝 -X)。
 adapt(raw,ctx){const out={...raw},f=nums(raw.footprintHeight,3);if(f){const n=typeof raw.cabinetCount==='number'?raw.cabinetCount:1;out.size=[f[0],f[1]/n,f[2]];out.count=n;}if(ctx)out.frontSign=ctx.position[0]>0?-1:1;return out;},
 build(m,p){
  const [w,d,h]=p.size,s=p.frontSign||1;
  // 柜深沿 X(靠墙),宽沿规格 Y(引擎 -Z)。
  for(let i=0;i<p.count;i++){
   const z=-(i-(p.count-1)/2)*d,fx=s*w/2;
   m.box({size:[w,0.1,d-0.02],center:[0,0.05,z],material:'plinth',label:'plinth'});
   m.box({size:[w,h-0.1,d-0.04],center:[0,0.1+(h-0.1)/2,z],material:'cabinet',label:'body'});
   for(const t of [-1,1])m.box({size:[0.015,h*0.8,(d-0.12)/2],center:[fx+s*0.008,0.1+h*0.45,z+t*(d-0.04)/4],material:'door',label:'door'});
   for(let k=0;k<4;k++)m.box({size:[0.012,0.012,d*0.5],center:[fx+s*0.012,h*0.15+k*0.05,z],material:'vent',label:'vent'});
   m.box({size:[0.01,0.035,0.035],center:[fx+s*0.02,h*0.85,z+d*0.3],material:'indicator',label:'indicator'});
   m.box({size:[0.006,0.18,0.24],center:[fx+s*0.02,h*0.7,z],material:'warningDecal',label:'decal'});
  }
 },
});

export const GEN_DRESSING=defineGenerator({
 id:'GEN-DRESSING-01',label:'工具车 / 工具 / 灭火器 / 警示牌',
 params:{kind:{type:'int',default:0,min:0,max:3},size:size([0.9,0.5,0.9]),height:{type:'number',default:0.6,min:0.1,max:3},pieces:{type:'int',default:6,min:1,max:16}},
 slots:['cartBody','cartWheel','extinguisher','bracket','tools','toolGrip','sign'],
 adapt(raw,ctx){const out={...raw};out.kind=kindOf(ctx?.id,['TOOLCART','TOOLSET','FIRE_EXT','WARNING_SIGNS']);if(typeof raw.pieceCount==='number')out.pieces=raw.pieceCount;return out;},
 build(m,p){
  const [w,d,h]=p.size;
  if(p.kind===0){ // 工具车:两层托盘 + 立柱 + 四轮
   for(const y of [0.25,h-0.05])m.box({size:[w,0.04,d],center:[0,y,0],material:'cartBody',label:'tray'});
   for(const x of [-1,1])for(const z of [-1,1]){bar(m,[x*(w/2-0.03),0.12,z*(d/2-0.03)],[x*(w/2-0.03),h,z*(d/2-0.03)],0.03,0.03,'cartBody','post');rod(m,[x*(w/2-0.06),0.06,z*(d/2-0.06)-0.02],[x*(w/2-0.06),0.06,z*(d/2-0.06)+0.02],0.06,'cartWheel','wheel',12);}
  }else if(p.kind===1){ // 工具:散放在车面上的几件
   for(let i=0;i<p.pieces;i++){const x=-0.3+0.6*((i*0.37)%1),z=-0.15+0.3*((i*0.61)%1),l=0.15+0.1*(i%3);bar(m,[x-l/2,0.02,z],[x+l/2,0.02,z],0.03,0.025,i%2?'tools':'toolGrip','tool');}
  }else if(p.kind===2){ // 灭火器:红色瓶身 + 墙上托架
   rod(m,[0,0,0],[0,p.height,0],0.08,'extinguisher','bottle',16);rod(m,[0,p.height,0],[0,p.height+0.08,0],0.03,'bracket','valve',8);
   m.box({size:[0.04,0.25,0.2],center:[-0.11,p.height*0.5,0],material:'bracket',label:'bracket'});
  }else{ // 警示牌:墙面薄板,法线沿局部 +X
   m.box({size:[0.02,0.45,0.6],center:[0,0,0],material:'sign',label:'sign'});m.box({size:[0.015,0.47,0.62],center:[-0.01,0,0],material:'bracket',label:'sign-back'});
  }
 },
});

export const GEN_CONSOLE=defineGenerator({
 id:'GEN-CONSOLE-01',label:'控制室陈设',
 params:{kind:{type:'int',default:0,min:0,max:3},deskSize:size([2.4,0.9,0.9]),screens:{type:'int',default:5,min:0,max:12},size:size([1,0.6,2.1]),panel:{type:'vec3',default:[2.4,1.4,0],min:0,max:20}},
 slots:['desk','deskBackPanel','screen','screenBezel','buttonPanel','buttonLight','chairSeat','chairFrame','serverCabinet','serverLight','wallDiagram'],
 adapt(raw,ctx){const out={...raw};out.kind=kindOf(ctx?.id,['CONSOLES','CHAIRS','SERVERS','SCHEMATIC']);if(typeof raw.screenCount==='number')out.screens=raw.screenCount;const s=nums(raw.size,2);if(s){out.panel=[s[0],s[1],0];delete out.size;}return out;},
 build(m,p){
  if(p.kind===0){ // 控制台:台面、背板、屏幕排在后沿朝操作者(引擎 +Z),斜面按钮板
   const [w,d,h]=p.deskSize;
   m.box({size:[w,0.05,d],center:[0,h,0],material:'desk',label:'top'});
   m.box({size:[w,h,0.05],center:[0,h/2,-d/2+0.03],material:'deskBackPanel',label:'back'});
   for(const s of [-1,1])m.box({size:[0.05,h,d],center:[s*(w/2-0.03),h/2,0],material:'desk',label:'side'});
   const n=p.screens,sw=Math.min(0.62,(w-0.1)/Math.max(1,n)),sh=sw/1.78;
   for(let i=0;i<n;i++){const x=-w/2+0.05+sw*(i+0.5)+(w-0.1-sw*n)/2;
    m.box({size:[sw-0.02,sh+0.02,0.04],center:[x,h+0.12+sh/2,-d/2+0.12],material:'screenBezel',label:'bezel'});
    m.box({size:[sw-0.05,sh-0.01,0.005],center:[x,h+0.12+sh/2,-d/2+0.143],material:'screen',label:'screen'});}
   m.box({size:[w*0.6,0.03,0.25],center:[0,h+0.03,d/2-0.18],material:'buttonPanel',label:'buttons'});
   for(let i=0;i<8;i++)m.box({size:[0.03,0.012,0.03],center:[-w*0.25+i*w*0.07,h+0.05,d/2-0.18],material:'buttonLight',label:'button'});
  }else if(p.kind===1){ // 椅子
   m.box({size:[0.5,0.08,0.5],center:[0,0.48,0],material:'chairSeat',label:'seat'});m.box({size:[0.48,0.55,0.06],center:[0,0.8,0.24],material:'chairSeat',label:'back'});
   rod(m,[0,0.08,0],[0,0.44,0],0.03,'chairFrame','post',8);for(let i=0;i<5;i++){const a=i*Math.PI*2/5;bar(m,[0,0.06,0],[Math.cos(a)*0.3,0.03,Math.sin(a)*0.3],0.04,0.03,'chairFrame','leg');}
  }else if(p.kind===2){ // 服务器柜:前面板 + 状态灯行
   const [w,d,h]=p.size;m.box({size:[w,h,d],center:[0,h/2,0],material:'serverCabinet',label:'rack'});
   for(let k=0;k<10;k++)m.box({size:[w*0.7,0.012,0.005],center:[0,0.25+k*(h-0.4)/10,d/2+0.003],material:'serverLight',label:'led'});
  }else{ // 墙面示意图:发光面板 + 边框,法线沿局部 +X
   const [w,h]=p.panel;m.box({size:[0.04,h+0.08,w+0.08],center:[0,0,0],material:'deskBackPanel',label:'frame'});m.box({size:[0.01,h,w],center:[0.025,0,0],material:'wallDiagram',label:'diagram'});
  }
 },
});

export const GEN_CARRIER=defineGenerator({
 id:'GEN-CARRIER-01',label:'导流体与存放座',
 params:{kind:{type:'int',default:0,min:0,max:2},pedestalHeight:{type:'number',default:1,min:0.2,max:3},length:{type:'number',default:1.2,min:0.2,max:4},width:{type:'number',default:0.35,min:0.05,max:2},sign:{type:'number',default:0.5,min:0.1,max:3}},
 slots:['carrierBody','carrierGripRing','cradle','cradlePad','signIcon','signBackground'],
 adapt(raw,ctx){const out={...raw};out.kind=kindOf(ctx?.id,['CARRIER_HOME','CARRIER_0','CARRIER_SIGN']);const lw=nums(raw.lengthWidth,2);if(lw){out.length=lw[0];out.width=lw[1];}const s=nums(raw.size,2);if(s)out.sign=s[0];return out;},
 build(m,p){
  if(p.kind===0){const h=p.pedestalHeight;
   m.box({size:[0.6,h-0.1,0.6],center:[0,(h-0.1)/2-1.1,0],material:'cradle',label:'pedestal'});
   for(const s of [-1,1])m.box({size:[0.5,0.12,0.12],center:[0,h-1.1-0.04,s*0.35],material:'cradlePad',label:'cradle'});
  }else if(p.kind===1){const r=p.width/2,l=p.length;
   rod(m,[0,0,l/2],[0,0,-l/2],r,'carrierBody','body',20);
   for(const z of [-l*0.3,l*0.3])rod(m,[0,0,z-0.03],[0,0,z+0.03],r*1.12,'carrierGripRing','grip',20);
   for(const z of [-l/2,l/2])m.sphere({radius:r,widthSegments:16,heightSegments:8,center:[0,0,z],material:'carrierBody',label:'cap'});
  }else{const s=p.sign;m.box({size:[0.03,s,s],center:[0,0,0],material:'signBackground',label:'sign'});m.box({size:[0.01,s*0.6,s*0.6],center:[0.02,0,0],material:'signIcon',label:'icon'});}
 },
});
