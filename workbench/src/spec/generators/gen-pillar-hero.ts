/**
 * GEN-NODEBEAM-02(最小验证用的精细能量柱,对照概念图 01 的柱体):沿 +Y 自下而上——
 * 底座箱体(侧板凸起、通风格栅、四根竖向管线)→ 下层玻璃舱(上下法兰带螺栓、一圈竖向发光管 + 中心光芯、外侧立筋)
 * → 中段机械鼓(肋条 + 琥珀指示灯)→ 上层玻璃舱 → 顶盖(法兰 + 罩 + 边灯)。尺寸按总高 height 等比分配。
 */
import {sel,type Model} from '@forgeax/engine/modeling';
import {defineGenerator} from './kit.ts';
import {rod} from './parts.ts';

export const GEN_PILLAR_HERO=defineGenerator({
 id:'GEN-NODEBEAM-02',label:'精细能量柱',
 params:{
  height:{type:'number',default:14,min:6,max:30},
  radius:{type:'number',default:1.5,min:0.6,max:4},
  tubes:{type:'int',default:6,min:3,max:12},
  segments:{type:'int',default:32,min:12,max:64},
 },
 slots:['tube','energyCore','clampRing','endCap','indicator','pipe','tubeGlass'],
 build(m:Model,p){
  const H=p.height,R=p.radius,seg=p.segments,u=H/14;
  const cyl=(r0:number,r1:number,y0:number,y1:number,material:string,label:string)=>m.cylinder({radiusTop:r1,radiusBottom:r0,height:y1-y0,radialSegments:seg,center:[0,(y0+y1)/2,0],material,label});
  const ring=(n:number,r:number,y:number,size:[number,number,number],material:string,label:string)=>{for(let i=0;i<n;i++){const a=i*360/n,l=`${label}-${i}`;m.box({size,center:[r,y,0],material,label:l});m.rotate(sel.createdBy(l),'y',a);}};
  // 底座箱体
  const bw=R*2.2,bh=2.4*u;
  m.box({size:[bw,bh,bw],center:[0,bh/2,0],material:'endCap',label:'base'});
  for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
   const fx=dx*(bw/2+0.03),fz=dz*(bw/2+0.03);
   m.box({size:dx?[0.06,bh*0.6,bw*0.7]:[bw*0.7,bh*0.6,0.06],center:[fx,bh*0.5,fz],material:'clampRing',label:'base-plate'});
   for(let k=0;k<5;k++)m.box({size:dx?[0.08,0.05,bw*0.5]:[bw*0.5,0.05,0.08],center:[fx*1.01,bh*0.25+k*0.09,fz*1.01],material:'endCap',label:'vent'});
   m.box({size:dx?[0.04,0.12,0.12]:[0.12,0.12,0.04],center:[fx*1.02+(dz?0.6:0),bh*0.85,fz*1.02+(dx?0.6:0)],material:'indicator',label:'base-lamp'});
  }
  // 外挂铜管:四根贴柱体上行到顶,每 1.2u 一道卡箍;另有两束黑色线缆从底座绕到中段。
  for(const s of [[1,1],[1,-1],[-1,1],[-1,-1]]){const x=s[0]*R*0.8,z=s[1]*R*0.8;rod(m,[x,bh,z],[x,13.2*u,z],0.11*u,'pipe','riser',12);
   for(let y=bh+0.6*u;y<13*u;y+=1.2*u)rod(m,[x,y-0.05,z],[x,y+0.05,z],0.15*u,'clampRing','riser-clamp',12);}
  for(const s of [1,-1])for(let k=0;k<3;k++){const a=s*(0.3+k*0.12);rod(m,[Math.cos(a)*R*1.15,bh-0.1,Math.sin(a)*R*1.15],[Math.cos(a+s*0.4)*R*1.12,6.4*u,Math.sin(a+s*0.4)*R*1.12],0.035*u,'endCap','cable',6);}
  // 玻璃舱:法兰 + 螺栓 + 竖向发光管 + 中心光芯 + 立筋
  const capsule=(y0:number,y1:number,r:number,tag:string)=>{
   const f=0.35*u;
   cyl(r*1.08,r*1.08,y0,y0+f,'clampRing',tag+'-flange-lo');cyl(r*1.08,r*1.08,y1-f,y1,'clampRing',tag+'-flange-hi');
   ring(20,r*1.1,y0+f*0.5,[0.08,f*0.6,0.08],'endCap',tag+'-bolt-lo');ring(20,r*1.1,y1-f*0.5,[0.08,f*0.6,0.08],'endCap',tag+'-bolt-hi');
   cyl(r*0.98,r*0.98,y0+f,y1-f,'tube',tag+'-glass');
   // 中心是深色金属芯轴 + 细发光芯,玻璃内部有明暗层次而不是整团亮光。
   // 中心:深色金属芯轴,外套一根粗玻璃管,管内细发光芯。
   cyl(r*0.12,r*0.12,y0+f,y1-f,'endCap',tag+'-spine');cyl(r*0.2,r*0.2,y0+f+0.2*u,y1-f-0.2*u,'tubeGlass',tag+'-core-glass');
   for(let k=0;k<3;k++){const a=k*Math.PI*2/3,x=Math.cos(a)*r*0.155,z=Math.sin(a)*r*0.155;rod(m,[x,y0+f+0.2*u,z],[x,y1-f-0.2*u,z],r*0.012,'energyCore',tag+'-core-filament',6);}
   // 灯管 = 透明玻璃管(tubeGlass)+ 管内细发光芯(energyCore)+ 两端金属端帽;发光只在芯,玻璃管本身透明。
   for(let i=0;i<p.tubes;i++){const a=i*Math.PI*2/p.tubes,x=Math.cos(a)*r*0.55,z=Math.sin(a)*r*0.55,cap=0.18*u;
    rod(m,[x,y0+f+cap,z],[x,y1-f-cap,z],r*0.085,'tubeGlass',tag+'-tube-glass',16);
    rod(m,[x,y0+f+cap,z],[x,y1-f-cap,z],r*0.016,'energyCore',tag+'-filament',8);
    for(const [ya,yb] of [[y0+f,y0+f+cap],[y1-f-cap,y1-f]])rod(m,[x,ya,z],[x,yb,z],r*0.1,'clampRing',tag+'-tube-cap',16);
    rod(m,[x*1.28,y0+f,z*1.28],[x*1.28,y1-f,z*1.28],r*0.02,'clampRing',tag+'-tube-rail',6);}
   for(let i=0;i<8;i++){const a=i*Math.PI/4+Math.PI/8;m.box({size:[0.1,y1-y0-2*f,0.1],center:[Math.cos(a)*r*1.02,(y0+y1)/2,Math.sin(a)*r*1.02],material:'clampRing',label:`${tag}-strut-${i}`});}
  };
  capsule(bh,6.2*u,R,'lower');
  // 中段机械鼓
  cyl(R*1.2,R*1.2,6.2*u,6.8*u,'endCap','drum-lo');cyl(R*0.95,R*0.95,6.8*u,7.6*u,'clampRing','drum');cyl(R*1.15,R*1.15,7.6*u,8.0*u,'endCap','drum-hi');
  ring(16,R*0.97,7.2*u,[0.12,0.7*u,0.1],'endCap','drum-rib');ring(8,R*1.21,6.5*u,[0.05,0.14,0.18],'indicator','drum-lamp');
  capsule(8.0*u,12.4*u,R*0.92,'upper');
  // 顶部机械冠:三层递收的法兰盘 + 一圈径向肋板 + 阀门手轮 + 上出管,概念图柱顶的多层冠。
  cyl(R*1.18,R*1.18,12.4*u,12.75*u,'endCap','crown-1');ring(24,R*1.2,12.57*u,[0.07,0.22*u,0.07],'clampRing','crown-bolt');
  cyl(R*1.05,R*0.98,12.75*u,13.1*u,'clampRing','crown-2');ring(12,R*0.9,13.25*u,[0.5*R,0.3*u,0.08],'endCap','crown-rib');
  cyl(R*0.85,R*0.7,13.1*u,13.5*u,'endCap','crown-3');ring(6,R*1.19,12.6*u,[0.05,0.12,0.25],'indicator','cap-lamp');
  cyl(R*0.45,R*0.45,13.5*u,14*u,'clampRing','cap-top');
  for(const s of [1,-1]){const x=s*R*0.55;rod(m,[x,13.5*u,0],[x,14*u+0.6,0],0.12*u,'pipe','crown-pipe',12);
   m.cylinder({radiusTop:0.28*u,radiusBottom:0.28*u,height:0.05,radialSegments:16,center:[x,13.8*u,0.3*u],material:'clampRing',label:'valve-wheel'});
   rod(m,[x,13.8*u,0],[x,13.8*u,0.3*u],0.03*u,'clampRing','valve-stem',6);}
  // 中段机械鼓下方加一圈阀门箱,上下舱之间的过渡更丰富。
  ring(4,R*1.25,6.9*u,[0.4*u,0.5*u,0.6*u],'endCap','drum-box');ring(4,R*1.27,7.0*u,[0.05,0.1,0.1],'indicator','drum-box-lamp');
 },
});
