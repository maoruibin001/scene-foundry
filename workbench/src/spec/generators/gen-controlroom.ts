/**
 * GEN-CONTROLROOM-01(规格化新增):玻璃控制室外壳。局部原点在室内地面中心,房间沿 X 宽 sizeX、沿局部 Z 深 sizeZ、高 height;
 * 局部 +X 面是朝大厅的玻璃立面:立柱(mullions)与横梁(transoms)组成窗框,玻璃板由 GEN-GLASS-01 另行实例化;
 * 其余三面为实墙(后墙留门洞),白色内饰天花与室内灯槽(发光面,真实光源在灯光状态里配)。
 */
import type {Model} from '@forgeax/engine/modeling';
import {defineGenerator,nums} from './kit.ts';

export const GEN_CONTROLROOM=defineGenerator({
 id:'GEN-CONTROLROOM-01',label:'玻璃控制室外壳',
 params:{
  sizeX:{type:'number',default:5.85,min:2,max:30},
  sizeZ:{type:'number',default:10,min:2,max:40},
  height:{type:'number',default:3.6,min:2.2,max:12},
  mullions:{type:'int',default:5,min:1,max:30},
  transoms:{type:'int',default:2,min:0,max:10},
  sillHeight:{type:'number',default:0.9,min:0,max:3},
  wallThickness:{type:'number',default:0.2,min:0.05,max:1},
  doorWidth:{type:'number',default:1.2,min:0,max:4},
  lightTroughs:{type:'int',default:2,min:0,max:12},
 },
 slots:['mullion','transom','sideWall','interiorWall','ceiling','door','lightTrough','floor'],
 // 规格常把尺寸写成 sizeXYZ(规格 X、Y、Z 向上)、立柱/横梁写成一对数。
 adapt(raw){const out={...raw},s=nums(raw.sizeXYZ,3),mt=nums(raw.mullionsTransoms,2);if(s){out.sizeX=s[0];out.sizeZ=s[1];out.height=s[2];}if(mt){out.mullions=mt[0];out.transoms=mt[1];}return out;},
 build(m:Model,p){
  const X=p.sizeX,Z=p.sizeZ,H=p.height,t=p.wallThickness,fx=X/2;
  if(p.sillHeight>=H-0.5)throw Error('GEN-CONTROLROOM-01: 窗台必须低于层高');
  if(p.doorWidth>=X-2*t)throw Error('GEN-CONTROLROOM-01: 门宽必须小于后墙');
  m.box({size:[X,0.1,Z],center:[0,0.05,0],material:'floor',label:'floor'});
  m.box({size:[X+2*t,0.25,Z+2*t],center:[0,H+0.125,0],material:'sideWall',label:'roof'});
  m.box({size:[X-0.1,0.04,Z-0.1],center:[0,H-0.02,0],material:'ceiling',label:'ceiling'});
  // 两端侧墙(局部 ±Z)与内衬。
  for(const s of [-1,1]){
   m.box({size:[X+2*t,H,t],center:[0,H/2,s*(Z/2+t/2)],material:'sideWall',label:'end-wall'});
   m.box({size:[X,H-0.1,0.02],center:[0,H/2,s*(Z/2-0.01)],material:'interiorWall',label:'end-lining'});
  }
  // 后墙(局部 -X)带门洞;门扇关闭贴在门洞内。
  const dw=p.doorWidth,dh=Math.min(2.2,H-0.3),seg=(Z-dw)/2;
  for(const s of [-1,1])m.box({size:[t,H,seg],center:[-fx-t/2,H/2,s*(dw/2+seg/2)],material:'sideWall',label:'back-wall'});
  m.box({size:[t,H-dh,dw],center:[-fx-t/2,dh+(H-dh)/2,0],material:'sideWall',label:'back-lintel'});
  if(dw>0)m.box({size:[0.06,dh,dw-0.04],center:[-fx-t/2,dh/2,0],material:'door',label:'door'});
  m.box({size:[0.02,H-0.1,Z],center:[-fx+0.01,H/2,0],material:'interiorWall',label:'back-lining'});
  // 玻璃立面(局部 +X):窗台下实墙 + 立柱 + 横梁。
  const sill=p.sillHeight;
  if(sill>0)m.box({size:[t,sill,Z],center:[fx+t/2,sill/2,0],material:'sideWall',label:'sill'});
  const mw=0.12;
  for(let i=0;i<=p.mullions;i++){const z=-Z/2+Z*i/p.mullions;m.box({size:[mw,H-sill,mw],center:[fx+t/2,sill+(H-sill)/2,z],material:'mullion',label:'mullion'});}
  for(let k=0;k<=p.transoms+1;k++){const y=sill+(H-sill)*k/(p.transoms+1);m.box({size:[mw,mw,Z],center:[fx+t/2,Math.min(H-mw/2,Math.max(sill+mw/2,y)),0],material:'transom',label:'transom'});}
  for(let i=0;i<p.lightTroughs;i++){const z=-Z/2+Z*(i+0.5)/p.lightTroughs;m.box({size:[X*0.6,0.03,0.25],center:[0,H-0.055,z],material:'lightTrough',label:'trough'});}
 },
});
