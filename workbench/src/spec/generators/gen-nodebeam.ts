/**
 * GEN-NODEBEAM-01(规格化新增):节点能量导柱。局部原点在导柱底部中心(节点顶盖),沿 +Y 竖起:
 * 透明导管包着蓝白发光芯,按间距加箍环,两端端盖,底部一圈状态指示。一根导柱一个实例,只绑定自身节点。
 */
import type {Model} from '@forgeax/engine/modeling';
import {defineGenerator,nums} from './kit.ts';

export const GEN_NODEBEAM=defineGenerator({
 id:'GEN-NODEBEAM-01',label:'节点能量导柱',
 params:{
  height:{type:'number',default:11,min:1,max:30},
  conduitDiameter:{type:'number',default:1.4,min:0.2,max:4},
  coreDiameter:{type:'number',default:0.4,min:0.05,max:3},
  clampRingSpacing:{type:'number',default:3,min:0.5,max:20},
  radialSegments:{type:'int',default:24,min:8,max:64},
 },
 slots:['tube','energyCore','clampRing','endCap','indicator'],
 adapt(raw){const hd=nums(raw.heightDiameter,2);return hd?{...raw,height:hd[0]}:raw;},
 build(m:Model,p){
  if(p.coreDiameter>=p.conduitDiameter*0.9)throw Error('GEN-NODEBEAM-01: 发光芯必须细于导管');
  // 概念图的能量柱:金属基座套筒 + 通长玻璃管(内有发光芯)+ 四根外侧立筋 + 细箍环 + 顶部套筒。
  const H=p.height,R=p.conduitDiameter/2,seg=p.radialSegments,base=Math.min(1.6,H*0.15),top=Math.min(1,H*0.1);
  m.cylinder({radiusTop:R*1.22,radiusBottom:R*1.38,height:base,radialSegments:seg,center:[0,base/2,0],material:'endCap',label:'base'});
  for(let k=1;k<=3;k++)m.cylinder({radiusTop:R*1.4,radiusBottom:R*1.4,height:0.06,radialSegments:seg,center:[0,base*k/4,0],material:'clampRing',label:'base-rib'+k});
  m.cylinder({radiusTop:R*1.42,radiusBottom:R*1.42,height:0.05,radialSegments:seg,center:[0,base+0.03,0],material:'indicator',label:'indicator'});
  m.cylinder({radiusTop:R*1.2,radiusBottom:R*1.2,height:top,radialSegments:seg,center:[0,H-top/2,0],material:'endCap',label:'top'});
  m.cylinder({radiusTop:R,radiusBottom:R,height:H-base-top,radialSegments:seg,center:[0,base+(H-base-top)/2,0],material:'tube',label:'tube'});
  m.cylinder({radiusTop:p.coreDiameter/2,radiusBottom:p.coreDiameter/2,height:H-base-top,radialSegments:Math.max(8,seg/2),center:[0,base+(H-base-top)/2,0],material:'energyCore',label:'core'});
  for(let k=0;k<4;k++){const a=k*Math.PI/2+Math.PI/4;m.box({size:[0.08,H-base-top,0.08],center:[Math.cos(a)*R*1.08,base+(H-base-top)/2,Math.sin(a)*R*1.08],material:'clampRing',label:'strut'+k});}
  const n=Math.floor((H-base-top)/p.clampRingSpacing);
  for(let i=1;i<=n;i++){const y=base+i*(H-base-top)/(n+1);m.cylinder({radiusTop:R*1.1,radiusBottom:R*1.1,height:0.05,radialSegments:seg,center:[0,y,0],material:'clampRing',label:`ring${i}`});}
 },
});
