/**
 * GEN-RING-01(手册卷三 §3;叶资产 COR-005..008):分段倾斜环。每段按弧长绕 +Y 旋转矩形截面生成(不把直条拉弯),
 * 段间留 gap,接缝处套阶梯机械抱箍接头并配真实 ISO 六角螺栓(recipes.hexBolt);
 * 段外侧加护甲板与琥珀灯点,内侧设导光轨、双道能量导管汇流环与径向加强卡箍肋,近景呈现重型精密航天机械质感。
 */
import {sel,type MetricSize,type Model} from '@forgeax/engine/modeling';
import {defineGenerator,deg,nums,rad} from './kit.ts';
import {appendHexBolts,type BoltPlacement} from './trim-kit.ts';

const rect=(r0:number,r1:number,h:number):[number,number][]=>[[r0,-h],[r1,-h],[r1,h],[r0,h],[r0,-h]];
const bandRect=(r0:number,r1:number,y0:number,y1:number):[number,number][]=>[[r0,y0],[r1,y0],[r1,y1],[r0,y1],[r0,y0]];

/** 将原始局部坐标 [x,y,z] 绕 +Y 旋转 angleDeg 度(与 m.rotate(...,'y',angleDeg) 一致)。 */
function rotY(p:[number,number,number],angleDeg:number):[number,number,number]{
 const a=rad(angleDeg),c=Math.cos(a),s=Math.sin(a);
 return [p[0]*c+p[2]*s,p[1],-p[0]*s+p[2]*c];
}

export const GEN_RING=defineGenerator({
 id:'GEN-RING-01',label:'分段倾斜环',
 params:{
  outerDiameter:{type:'number',default:11,min:2,max:40},
  radialWidth:{type:'number',default:0.35,min:0.05,max:2},
  depth:{type:'number',default:0.25,min:0.05,max:2},
  segments:{type:'int',default:8,min:3,max:32},
  gap:{type:'number',default:0.025,min:0.002,max:0.5},
  arcSteps:{type:'int',default:14,min:3,max:64},
  armor:{type:'bool',default:true},
  lampsPerSegment:{type:'int',default:3,min:0,max:12},
  bandWidth:{type:'number',default:0.34,min:0.05,max:3},
  rivetSpacing:{type:'number',default:0,min:0,max:5},
 },
 slots:['segment','outerArmor','joint','lightRail','indicator'],
 adapt(raw){const v=nums(raw.radialWidthDepthGap,3);return v?{...raw,radialWidth:v[0]!,depth:v[1]!,gap:v[2]!}:raw;},
 build(m:Model,p){
  const ro=p.outerDiameter/2,ri=ro-p.radialWidth,h=p.depth/2;
  if(ri<=0.05)throw Error('GEN-RING-01: radialWidth 必须小于外半径');
  const step=360/p.segments,gapDeg=deg(p.gap/ro),arc=step-gapDeg;
  if(arc<=1)throw Error('GEN-RING-01: gap 过大导致单段弧角不足');
  const turn=(label:string,angle:number)=>{if(angle)m.rotate(sel.createdBy(label),'y',angle);};

  const boltSize:MetricSize=p.radialWidth>=0.28?'M20':p.radialWidth>=0.14?'M12':'M8';
  const boltScale=p.radialWidth>=0.28?1.25:1;
  const bolts:BoltPlacement[]=[];

  const railIn=Math.min(0.03,ri*0.18);
  const railH=Math.min(0.05,h*0.4);
  const condThick=Math.max(0.008,Math.min(0.024,h*0.22));
  const condY=Math.min(h*0.72,railH+condThick*1.35);

  for(let k=0;k<p.segments;k++){
   const start=k*step+gapDeg/2;
   m.revolve({points:rect(ri,ro,h),segments:p.arcSteps,angle:arc,label:`seg${k}`,material:'segment'});turn(`seg${k}`,start);
   // 内缘主导光轨与上下双道精密能量导管肋
   m.revolve({points:rect(ri-railIn,ri,railH),segments:p.arcSteps,angle:arc*0.86,label:`rail${k}`,material:'lightRail'});turn(`rail${k}`,start+arc*0.07);
   if(h>=0.04&&arc>6){
    for(const sy of [-1,1] as const){
     const y0=sy>0?condY:(-condY-condThick),y1=sy>0?(condY+condThick):-condY;
     const clbl=`cond${k}_${sy>0?'t':'b'}`;
     m.revolve({points:bandRect(ri-railIn*0.78,ri+0.004,y0,y1),segments:p.arcSteps,angle:arc*0.84,label:clbl,material:'joint'});
     turn(clbl,start+arc*0.08);
    }
    // 沿内弧排布径向 C 形导管抱箍肋,近距离呈现航空级精密机械分件
    const ribCount=Math.max(2,Math.min(6,Math.round(rad(arc)*ri/0.95)));
    const ribW=Math.min(0.05,p.radialWidth*0.25);
    const ribZ=Math.min(0.045,rad(arc)*ri*0.08);
    for(let rIdx=0;rIdx<ribCount;rIdx++){
     const a=start+arc*(0.14+0.72*(rIdx+0.5)/ribCount);
     const rlbl=`inrib${k}_${rIdx}`;
     m.box({size:[ribW+railIn*0.9,Math.min(p.depth*0.88,(condY+condThick)*2.15),ribZ],center:[ri-railIn*0.35+ribW*0.3,0,0],label:rlbl,material:'joint'});
     turn(rlbl,a);
    }
   }

   // 护甲:与结构环同平面、向外伸出的扁平钢带,两缘交错排布真实航空六角螺栓头
   const ext=Math.max(0.07,p.bandWidth-p.radialWidth),band=Math.min(h,0.08),bo=ro+ext;
   if(p.armor){
    m.revolve({points:rect(ri,bo,band+0.01),segments:p.arcSteps,angle:arc*0.92,label:`armor${k}`,material:'outerArmor'});turn(`armor${k}`,start+arc*0.04);
    if(p.rivetSpacing>0){
     const n=Math.min(10,Math.max(2,Math.floor(rad(arc)*bo/Math.max(0.3,p.rivetSpacing))));
     const margin=Math.min(0.06,(bo-ri)*0.22);
     for(let i=0;i<n;i++){
      const phi=start+arc*0.04+arc*0.92*(i+0.5)/n;
      const r=i%2===0?bo-margin:ri+margin;
      for(const sy of [1,-1] as const){
       bolts.push({position:rotY([r,sy*(band+0.01),0],phi),normal:[0,sy,0]});
      }
     }
    }
   }
   for(let i=0;i<p.lampsPerSegment;i++){
    const label=`lamp${k}_${i}`,r=(p.armor?ro+Math.max(0.07,p.bandWidth-p.radialWidth):ro)+0.02;
    m.box({size:[0.04,0.07,0.16],center:[r,0,0],label,material:'indicator'});turn(label,start+arc*(i+1)/(p.lampsPerSegment+1));
   }

   // 接缝机械抱箍接头 + 阶梯压板 + 上下/外侧真实六角锁紧螺栓群
   const jMid=(ri+ro)/2,jW=p.radialWidth+0.18,jH=p.depth+0.16,jLen=Math.min(0.42,rad(step)*jMid*0.45);
   m.box({size:[jW,jH,jLen],center:[jMid,0,0],label:`joint${k}`,material:'joint'});turn(`joint${k}`,k*step);
   m.box({size:[jW*0.78,jH+0.028,jLen*0.64],center:[jMid,0,0],label:`jcap${k}`,material:'joint'});turn(`jcap${k}`,k*step);

   const zOff=jLen*0.22;
   for(const sy of [1,-1] as const){
    bolts.push({position:rotY([jMid,sy*(jH/2+0.014),0],k*step),normal:[0,sy,0]});
   }
   const outNorm=rotY([1,0,0],k*step);
   for(const sz of [-1,1] as const){
    bolts.push({position:rotY([jMid+jW/2,0,sz*zOff],k*step),normal:outNorm});
   }
  }

  appendHexBolts(m,bolts,{size:boltSize,length:Math.min(0.03,p.depth*0.35),segments:12,scale:boltScale,material:'joint'});
 },
});
