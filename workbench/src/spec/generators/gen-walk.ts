/**
 * GEN-WALK-01(规格化新增):步道段。局部原点在步道顶面中心,直段沿局部 -Z(规格 +Y)延伸 length;
 * angleDeg>0 时为弧段:以 radius 为中心线半径、绕 +Y 扫过 angleDeg,起点在局部 +X 轴上。
 * 格栅面板按 moduleLength 分块(留缝);两侧边框梁;railLeft/railRight 选择哪一侧有栏杆(立柱 + 扶手 + 中横杆 + 踢脚板);
 * elevated=true 时下方加支撑托梁(上层步道);地面层格栅顶面抬高 3 cm,压在地板面板之上,避免与地面共面。
 */
import {sel,type Model} from '@forgeax/engine/modeling';
import {defineGenerator,nums} from './kit.ts';

export const GEN_WALK=defineGenerator({
 id:'GEN-WALK-01',label:'步道段',
 params:{
  length:{type:'number',default:12,min:0.5,max:80},
  width:{type:'number',default:3,min:0.6,max:10},
  thickness:{type:'number',default:0.2,min:0.04,max:1},
  moduleLength:{type:'number',default:4,min:0.5,max:12},
  angleDeg:{type:'number',default:0,min:0,max:360},
  radius:{type:'number',default:7.5,min:1,max:60},
  railHeight:{type:'number',default:1.1,min:0,max:2},
  railPitch:{type:'number',default:2,min:0.5,max:6},
  railLeft:{type:'bool',default:true},
  railRight:{type:'bool',default:true},
  elevated:{type:'bool',default:false},
  startDeg:{type:'number',default:0,min:-360,max:360},
  fasciaLight:{type:'bool',default:false},
 },
 adapt(raw,ctx){
  const out={...raw},range=nums(raw.angleRangeDeg,2),size=nums(raw.size,2);
  if(range){out.startDeg=range[0];out.angleDeg=range[1]-range[0];}
  if(size){out.width=size[0];out.length=size[1];out.railHeight=0;}           // 平台:整块板,无栏杆
  if(typeof raw.deckThickness==='number')out.thickness=raw.deckThickness;
  if(typeof raw.elevation==='number')out.elevated=raw.elevation>0.5;
  // 只有栏杆的对象(池沿护栏、上层栏杆):窄踢脚板 + 单侧栏杆。
  if(raw.width===undefined&&!size&&(raw.sections!==undefined||raw.railHeight!==undefined)){out.width=0.3;out.thickness=0.06;out.railLeft=false;}
  // 上层步道的悬臂托架:墙上的短方钢块,不是一段步道。
  if(ctx?.id.startsWith('BRACKETS')){out.length=0.6;out.width=0.35;out.thickness=0.35;out.railHeight=0;out.elevated=false;}
  return out;
 },
 slots:['grating','frame','railPost','handrail','endCap','kickPlate','fascia'],
 build(m:Model,p){
  const arc=p.angleDeg>0,W=p.width,T=p.thickness,len=arc?p.radius*p.angleDeg*Math.PI/180:p.length;
  if(arc&&p.radius<=W/2+0.1)throw Error('GEN-WALK-01: 弧段中心线半径必须大于半宽');
  // 中心线采样:s∈[0,len] → 位置与切向。直段沿 -Z;弧段绕 +Y 从 startDeg 起扫(角度从 +X 量向规格 +Y,即局部 -Z)。
  const a0=p.startDeg*Math.PI/180;
  const at=(s:number)=>{
   if(!arc)return {x:0,z:len/2-s,tx:0,tz:-1};
   const a=a0+s/p.radius;return {x:p.radius*Math.cos(a),z:-p.radius*Math.sin(a),tx:-Math.sin(a),tz:-Math.cos(a)};
  };
  // 每段用一个沿切向放置的盒子近似(弧段分段足够细时贴合),盒子按切向绕 Y 转。
  let n=0;
  const seg=(s0:number,s1:number,across:number,size:[number,number],y:number,material:string,label:string)=>{
   const mid=at((s0+s1)/2),nx=-mid.tz,nz=mid.tx,l=s1-s0;
   const c:[number,number,number]=[mid.x+nx*across,y,mid.z+nz*across],key=`${label}-${n++}`;
   m.box({size:[size[0],size[1],l],center:c,material,label:key});
   const yaw=Math.atan2(mid.tx,mid.tz)*180/Math.PI-180;
   if(Math.abs(yaw%360)>1e-6)m.rotate(sel.createdBy(key),'y',yaw,c);
  };
  const pieces=Math.max(1,Math.ceil(len/(arc?Math.min(p.moduleLength,1.2):p.moduleLength))),step=len/pieces,gap=0.02;
  for(let i=0;i<pieces;i++){
   const s0=i*step+gap/2,s1=(i+1)*step-gap/2;
   seg(s0,s1,0,[W-0.16,T*0.6],-T*0.3,'grating','grating');
   for(const side of [-1,1])seg(i*step,(i+1)*step,side*(W/2-0.04),[0.08,T],-T/2,'frame','frame');
   if(p.elevated)for(const side of [-1,1])seg(i*step,(i+1)*step,side*(W/2-0.3),[0.12,0.25],-T-0.125,'frame','joist');
   // 高层回廊外沿下方一条连续灯带,概念图里逐层亮起的横向光线。
   if(p.elevated&&p.fasciaLight)for(const side of [-1,1])seg(i*step,(i+1)*step,side*(W/2+0.02),[0.04,0.06],-T-0.05,'fascia','fascia');
  }
  for(const s of [0,len]){const e=at(s),key=`endcap-${n++}`;m.box({size:[W,T,0.06],center:[e.x,-T/2,e.z],material:'endCap',label:key});const yaw=Math.atan2(e.tx,e.tz)*180/Math.PI-180;if(Math.abs(yaw%360)>1e-6)m.rotate(sel.createdBy(key),'y',yaw,[e.x,-T/2,e.z]);}
  // 以上几何按"顶面在 y=0"搭建,最后整体移到板中心原点;地面层再抬 3 cm。
  const lift=T/2+(p.elevated?0:0.03);
  if(p.railHeight<=0){m.translate(sel.all(),[0,lift,0]);return;}
  const H=p.railHeight,posts=Math.max(1,Math.round(len/p.railPitch));
  for(const [side,on] of [[-1,p.railLeft],[1,p.railRight]] as const){
   if(!on)continue;
   const off=side*(W/2-0.05);
   for(let i=0;i<=posts;i++){const e=at(i*len/posts),nx=-e.tz,nz=e.tx;m.box({size:[0.06,H,0.06],center:[e.x+nx*off,H/2,e.z+nz*off],material:'railPost',label:'post'});}
   const railPieces=arc?pieces:1;
   for(let i=0;i<railPieces;i++){
    const s0=i*len/railPieces,s1=(i+1)*len/railPieces;
    seg(s0,s1,off,[0.05,0.05],H,'handrail','handrail');
    seg(s0,s1,off,[0.035,0.035],H*0.5,'handrail','midrail');
    seg(s0,s1,off,[0.02,0.12],0.06,'kickPlate','kick');
   }
  }
  m.translate(sel.all(),[0,lift,0]);
 },
});
