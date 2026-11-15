/**
 * GEN-SCREENWALL-01(圆厅验证 2026-11-08:纯发光平板读作灰板,廉价):有"内容"的大屏。
 * 局部原点在屏底边中点,屏面朝局部 +Z(不旋转时朝规格 -Y)。深色厚边框 + 亮描边;屏内深底(弱发光)上排布
 * 左侧环形仪表(两道同心环 + 刻度)、右侧数据条阵(随机长度横条)、底部小方块状态格与琥珀告警点;上下各一道托架。
 */
import {sel,type Model} from '@forgeax/engine/modeling';
import {defineGenerator} from './kit.ts';

const rng=(seed:number)=>{let s=(seed*2654435761)>>>0||1;return ()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return ((s>>>0)%100000)/100000;};};

export const GEN_SCREENWALL=defineGenerator({
 id:'GEN-SCREENWALL-01',label:'内容大屏',
 params:{
  width:{type:'number',default:16,min:2,max:60},
  height:{type:'number',default:6,min:1,max:30},
  seed:{type:'int',default:1,min:0,max:9999},
 },
 slots:['frame','screen','glow','tile','accent'],
 build(m:Model,p){
  const W=p.width,H=p.height,r=rng(p.seed),b=Math.min(W,H)*0.05,z0=0.3;
  // 边框与托架
  m.box({size:[W+2*b,H+2*b,z0],center:[0,H/2,z0/2],material:'frame',label:'sw-frame'});
  for(const y of [H+b*0.5,-b*0.5])m.box({size:[W+b,0.06,0.04],center:[0,y,z0+0.02],material:'glow',label:'sw-edge'});
  for(const y of [H+b+0.4,-b-0.4])m.box({size:[W*0.7,0.5,0.8],center:[0,y,0.2],material:'frame',label:'sw-bracket'});
  m.box({size:[W,H,0.02],center:[0,H/2,z0+0.01],material:'screen',label:'sw-bg'});
  const zc=z0+0.03;
  // 左:环形仪表
  const R=H*0.32,cx=-W/2+R+H*0.15,cy=H*0.55;
  for(const [rr,w,mat] of [[R,R*0.07,'glow'],[R*0.72,R*0.05,'tile']] as const){
   const label='sw-ring'+rr.toFixed(2);m.revolve({points:[[rr-w,0],[rr,0],[rr,0.02],[rr-w,0.02],[rr-w,0]],segments:64,material:mat,label});
   m.rotate(sel.createdBy(label),'x',90);m.translate(sel.createdBy(label),[cx,cy,zc]);}
  for(let k=0;k<24;k++){const a=k*Math.PI*2/24,label='sw-tick'+k;
   m.box({size:[R*0.12,0.04,0.02],center:[cx+Math.cos(a)*R*1.12,cy+Math.sin(a)*R*1.12,zc],material:k%6?'tile':'accent',label});
   m.rotate(sel.createdBy(label),'z',a*180/Math.PI,[cx+Math.cos(a)*R*1.12,cy+Math.sin(a)*R*1.12,zc]);}
  m.box({size:[R*0.5,R*0.5,0.02],center:[cx,cy,zc],material:'tile',label:'sw-core'});
  // 右:数据条阵
  const x0=cx+R*1.4+H*0.1,x1=W/2-H*0.1,rows=Math.max(4,Math.round(H/0.45));
  for(let j=0;j<rows;j++){const y=H*0.12+(H*0.8)*(j+0.5)/rows,len=(x1-x0)*(0.25+r()*0.75),hot=r()<0.15;
   m.box({size:[len,Math.min(0.14,H*0.6/rows),0.02],center:[x0+len/2,y,zc],material:hot?'accent':(r()<0.5?'glow':'tile'),label:'sw-bar'});}
  // 底:状态格
  const n=Math.max(6,Math.round(W/0.9));
  for(let i=0;i<n;i++){const w=W*0.9/n;m.box({size:[w*0.7,H*0.05,0.02],center:[-W*0.45+w*(i+0.5),H*0.05,zc],material:r()<0.1?'accent':'tile',label:'sw-cell'});}
 },
});
