/**
 * GEN-EQUIPGROUP-01(地面层设备群,对照概念图 01/02/03 能量柱底座与楼梯脚下成组的设备):
 * 一组贴地组合件,按 seed 确定性排布在 width×depth 的地块内——
 * 2–3 台带门板与指示灯的大机柜(1.0–1.6m 高)、叠放的设备箱(1–3 层)、一台带滚轮的工具车、
 * 2–4 束从机柜底部拖到地块边缘的粗线缆(贴地折线)、1–2 根带琥珀灯头的灯桩。局部 +Z 为朝向大厅一侧。
 */
import type {Model} from '@forgeax/engine/modeling';
import {defineGenerator} from './kit.ts';
import {rod} from './parts.ts';

const rng=(seed:number)=>{let s=(seed*2654435761)>>>0||1;return ()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return ((s>>>0)%100000)/100000;};};

export const GEN_EQUIPGROUP=defineGenerator({
 id:'GEN-EQUIPGROUP-01',label:'地面层设备群',
 params:{
  width:{type:'number',default:4,min:1,max:12},
  depth:{type:'number',default:2.5,min:1,max:8},
  seed:{type:'int',default:1,min:0,max:9999},
  cabinets:{type:'int',default:2,min:0,max:12},
  crates:{type:'int',default:4,min:0,max:12},
  cables:{type:'int',default:3,min:0,max:8},
  posts:{type:'int',default:1,min:0,max:4},
 },
 slots:['cabinet','door','crate','trim','indicator','cable','lamp'],
 build(m:Model,p){
  const W=p.width,Dp=p.depth,r=rng(p.seed);
  // 大机柜:靠地块后沿(-Z)一字排开
  let x=-W/2+0.1;const roots:[number,number][]=[];
  const cols=Math.max(1,Math.ceil(Math.sqrt(p.cabinets*W/Dp))),rows=Math.max(1,Math.ceil(p.cabinets/cols));
  for(let i=0;i<p.cabinets;i++){const w=W/cols*0.86,h=1.0+r()*0.6,d=Dp/rows*0.8,cz=-Dp/2+(Math.floor(i/cols)+0.5)*Dp/rows;x=-W/2+(i%cols+0.5)*W/cols-w/2;
   m.box({size:[w,h,d],center:[x+w/2,h/2,cz],material:'cabinet',label:'eq-cab'});
   m.box({size:[w*0.86,h*0.8,0.02],center:[x+w/2,h*0.5,cz+d/2+0.01],material:'door',label:'eq-door'});
   for(let k=0;k<4;k++)m.box({size:[w*0.6,0.015,0.01],center:[x+w/2,h*0.25+k*0.04,cz+d/2+0.022],material:'trim',label:'eq-vent'});
   for(let k=0;k<3;k++)m.box({size:[0.04,0.04,0.015],center:[x+w*0.2+k*0.08,h*0.85,cz+d/2+0.025],material:'indicator',label:'eq-led'});
   m.box({size:[w+0.04,0.06,d+0.04],center:[x+w/2,h+0.03,cz],material:'trim',label:'eq-cap'});
   roots.push([x+w/2,cz+d/2]);x+=w+0.08;}
  // 叠放设备箱:地块前半区成堆
  for(let i=0;i<p.crates;i++){const w=0.5+r()*0.5,d=0.4+r()*0.3,h=0.35+r()*0.3,cx=-W/2+w/2+r()*(W-w),cz=r()*Dp*0.4;const n=1+Math.floor(r()*3);
   for(let k=0;k<n;k++){const s=1-k*0.12;m.box({size:[w*s,h,d*s],center:[cx+(r()-0.5)*0.05,h*(k+0.5),cz],material:'crate',label:'eq-crate'});
    m.box({size:[w*s+0.02,0.03,d*s+0.02],center:[cx,h*(k+1)-0.015,cz],material:'trim',label:'eq-crate-band'});}}
  // 工具车
  {const cx=W/2-0.6,cz=Dp/2-0.5;m.box({size:[0.8,0.05,0.5],center:[cx,0.75,cz],material:'trim',label:'eq-cart'});m.box({size:[0.8,0.05,0.5],center:[cx,0.3,cz],material:'trim',label:'eq-cart'});
   for(const [dx,dz] of [[-0.37,-0.22],[0.37,-0.22],[-0.37,0.22],[0.37,0.22]]){rod(m,[cx+dx,0.08,cz+dz],[cx+dx,0.78,cz+dz],0.015,'cabinet','eq-cart-leg',6);m.box({size:[0.06,0.08,0.03],center:[cx+dx,0.04,cz+dz],material:'cable',label:'eq-wheel'});}
   m.box({size:[0.6,0.2,0.35],center:[cx,0.88,cz],material:'crate',label:'eq-cart-box'});}
  // 线缆:从机柜底部拖到地块前沿,贴地两折
  for(let i=0;i<p.cables;i++){const [rx,rz]=roots[i%Math.max(1,roots.length)]??[0,-Dp/2],mx=rx+(r()-0.5)*1.5,ex=mx+(r()-0.5)*2,dia=0.04+r()*0.03;
   rod(m,[rx,dia,rz],[mx,dia,rz+Dp*0.4],dia,'cable','eq-cable',6);rod(m,[mx,dia,rz+Dp*0.4],[ex,dia,Dp/2+0.6],dia,'cable','eq-cable',6);}
  // 灯桩
  for(let i=0;i<p.posts;i++){const cx=-W/2+0.3+i*(W-0.6)/Math.max(1,p.posts-1||1),cz=Dp/2-0.15;
   rod(m,[cx,0,cz],[cx,1.1,cz],0.05,'cabinet','eq-post',8);m.box({size:[0.16,0.22,0.16],center:[cx,1.2,cz],material:'cabinet',label:'eq-post-head'});
   m.box({size:[0.12,0.16,0.02],center:[cx,1.2,cz+0.085],material:'lamp',label:'eq-post-lamp'});}
 },
});
