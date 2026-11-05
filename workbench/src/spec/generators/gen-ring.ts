/**
 * GEN-RING-01(手册卷三 §3;叶资产 COR-005..008):分段倾斜环。每段按弧长绕 +Y 旋转矩形截面生成(不把直条拉弯),
 * 段间留 gap,接缝处套机械接头;段外侧加护甲板与琥珀灯点,内侧一条导光轨。
 * bandWidth>结构径宽时护甲是环平面内向外伸出的宽扁钢带(径向展开,厚度薄),带面两缘按 rivetSpacing 排铆钉——结构截面仍按手册,外观是概念图的铆接钢带。一个实例出一道环,环面在局部 XZ 平面。
 */
import {sel,type Model} from '@forgeax/engine/modeling';
import {defineGenerator,deg,nums} from './kit.ts';

const rect=(r0:number,r1:number,h:number):[number,number][]=>[[r0,-h],[r1,-h],[r1,h],[r0,h],[r0,-h]];

export const GEN_RING=defineGenerator({
 id:'GEN-RING-01',label:'分段倾斜环',
 params:{
  outerDiameter:{type:'number',default:11,min:2,max:40},
  radialWidth:{type:'number',default:0.35,min:0.05,max:2},
  depth:{type:'number',default:0.25,min:0.05,max:2},
  segments:{type:'int',default:8,min:3,max:32},
  gap:{type:'number',default:0.025,min:0.005,max:0.5},
  arcSteps:{type:'int',default:14,min:3,max:64},
  armor:{type:'bool',default:true},
  lampsPerSegment:{type:'int',default:3,min:0,max:12},
  bandWidth:{type:'number',default:0.34,min:0.05,max:3},
  rivetSpacing:{type:'number',default:0,min:0,max:5},
 },
 slots:['segment','outerArmor','joint','lightRail','indicator'],
 adapt(raw){const v=nums(raw.radialWidthDepthGap,3);return v?{...raw,radialWidth:v[0],depth:v[1],gap:v[2]}:raw;},
 build(m:Model,p){
  const ro=p.outerDiameter/2,ri=ro-p.radialWidth,h=p.depth/2;
  if(ri<=0.05)throw Error('GEN-RING-01: radialWidth 必须小于外半径');
  const step=360/p.segments,gapDeg=deg(p.gap/ro),arc=step-gapDeg;
  const turn=(label:string,angle:number)=>{if(angle)m.rotate(sel.createdBy(label),'y',angle);};
  for(let k=0;k<p.segments;k++){
   const start=k*step+gapDeg/2;
   m.revolve({points:rect(ri,ro,h),segments:p.arcSteps,angle:arc,label:`seg${k}`,material:'segment'});turn(`seg${k}`,start);
   // 导光轨略短于段长,两端让给接头。
   m.revolve({points:rect(ri-0.03,ri,Math.min(0.05,h*0.4)),segments:p.arcSteps,angle:arc*0.86,label:`rail${k}`,material:'lightRail'});turn(`rail${k}`,start+arc*0.07);
   // 护甲:与结构环同平面、向外伸出的扁平钢带(外径 ro+ext,厚 band),两面带面边缘铆钉。
   const ext=Math.max(0.07,p.bandWidth-p.radialWidth),band=Math.min(h,0.08),bo=ro+ext;
   if(p.armor){m.revolve({points:rect(ri,bo,band+0.01),segments:p.arcSteps,angle:arc*0.92,label:`armor${k}`,material:'outerArmor'});turn(`armor${k}`,start+arc*0.04);
    if(p.rivetSpacing>0){const n=Math.max(2,Math.floor(arc*Math.PI/180*bo/p.rivetSpacing));
     for(let i=0;i<n;i++)for(const [r,y] of [[bo-0.06,band+0.02],[bo-0.06,-band-0.02],[ri+0.06,band+0.02],[ri+0.06,-band-0.02]]){const label=`rivet${k}_${i}_${r.toFixed(2)}_${y>0}`;m.box({size:[0.05,0.03,0.05],center:[r,y,0],label,material:'joint'});turn(label,start+arc*0.04+arc*0.92*(i+0.5)/n);}}}
   for(let i=0;i<p.lampsPerSegment;i++){
    const label=`lamp${k}_${i}`,r=(p.armor?ro+Math.max(0.07,p.bandWidth-p.radialWidth):ro)+0.02;
    m.box({size:[0.04,0.07,0.16],center:[r,0,0],label,material:'indicator'});turn(label,start+arc*(i+1)/(p.lampsPerSegment+1));
   }
   // 接头横跨接缝:径向略宽、厚度略厚,沿切向 0.42m。
   m.box({size:[p.radialWidth+0.18,p.depth+0.16,0.42],center:[(ri+ro)/2,0,0],label:`joint${k}`,material:'joint'});turn(`joint${k}`,k*step);
  }
 },
});
