/**
 * GEN-NODE-01(手册卷三 §3;叶资产 NOD-001..009):外锁供能节点。局部原点在地面中心,弱点耦合器朝局部 +Z
 * (场景用实例朝向让它对着内部通道)。底座、左右金属侧壳(散热片)、背壳、透明护套、发光芯柱、弱点、顶盖、读数面板。能源柱由独立资产族承担。
 */
import type {Model} from '@forgeax/engine/modeling';
import {defineGenerator,nums} from './kit.ts';

export const GEN_NODE=defineGenerator({
 id:'GEN-NODE-01',label:'外锁供能节点',
 params:{
  width:{type:'number',default:2,min:0.8,max:6},
  depth:{type:'number',default:2,min:0.8,max:6},
  height:{type:'number',default:3,min:1.2,max:8},
  weakpointZ:{type:'number',default:1.6,min:0.4,max:6},
  finCount:{type:'int',default:8,min:0,max:24},
  radialSegments:{type:'int',default:24,min:8,max:64},
 },
 slots:['base','sideShell','sleeve','core','weakpoint','fin','readout','topCap'],
 adapt(raw){const s=nums(raw.size,3);return s?{...raw,width:s[0],depth:s[1],height:s[2]}:raw;},
 build(m:Model,p){
  const w=p.width,d=p.depth,h=p.height,base=0.25,cap=0.22,body=h-base-cap,side=Math.min(0.4,w*0.18),seg=p.radialSegments;
  if(p.weakpointZ<=base||p.weakpointZ>=h-cap)throw Error('GEN-NODE-01: weakpointZ 必须落在壳体高度内');
  m.box({size:[w*1.1,base,d*1.1],center:[0,base/2,0],material:'base',label:'base'});
  for(const s of [-1,1])m.box({size:[side,body,d],center:[s*(w/2-side/2),base+body/2,0],material:'sideShell',label:'side'});
  m.box({size:[w-2*side,body,0.25],center:[0,base+body/2,-(d/2-0.125)],material:'sideShell',label:'back'});
  const sleeve=Math.min(w,d)*0.28;
  m.cylinder({radiusTop:sleeve,radiusBottom:sleeve,height:body,radialSegments:seg,center:[0,base+body/2,0],material:'sleeve',label:'sleeve'});
  m.cylinder({radiusTop:sleeve*0.4,radiusBottom:sleeve*0.4,height:body*0.96,radialSegments:seg,center:[0,base+body/2,0],material:'core',label:'core'});
  m.box({size:[w*0.26,0.36,0.22],center:[0,p.weakpointZ,d/2-0.06],material:'weakpoint',label:'weakpoint'});
  m.box({size:[w*0.16,0.2,0.04],center:[w*0.28,p.weakpointZ+0.5,d/2+0.02],material:'readout',label:'readout'});
  const perSide=Math.floor(p.finCount/2);
  for(let i=0;i<perSide;i++){const z=-d/2+d*(i+0.5)/perSide;for(const s of [-1,1])m.box({size:[0.16,body*0.8,0.04],center:[s*(w/2+0.08),base+body*0.5,z],material:'fin',label:'fin'});}
  m.box({size:[w*1.06,cap,d*1.06],center:[0,h-cap/2,0],material:'topCap',label:'cap'}); 
 },
});
