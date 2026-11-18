/**
 * 工业 CAD 示范生成器组(gen-scifi-kit.ts):
 * - GEN-WORKSTATION-01: 全息多联监控工位(弧形人体工学指挥台 + 多联折角屏阵 + 悬浮全息战术环 + 键控台 + 下挂服务器副柜 + 指挥椅)
 * - GEN-MECH-ACTUATOR-01: 液压锁紧支座与管簇(真实 recipes.hydraulicCylinder + recipes.clevis + recipes.hexBolt + pipeRun 圆角弯管簇 + 状态灯带)
 */
import {sel,type Model} from '@forgeax/engine/modeling';
import {defineGenerator,nums,rad} from './kit.ts';
import {bar,pipeRun,rod,type P3} from './parts.ts';
import {appendHexBolts,appendHydraulicStrut,type BoltPlacement} from './trim-kit.ts';

const rectProfile=(r0:number,r1:number,y0:number,y1:number):[number,number][]=>[
 [r0,y0],
 [r1,y0],
 [r1,y1],
 [r0,y1],
 [r0,y0],
];

export const GEN_WORKSTATION=defineGenerator({
 id:'GEN-WORKSTATION-01',
 label:'全息多联监控工位',
 params:{
  width:{type:'number',default:2.6,min:1.4,max:4.5},
  depth:{type:'number',default:1.35,min:0.85,max:2.4},
  deskHeight:{type:'number',default:0.78,min:0.68,max:1.05},
  monitors:{type:'int',default:3,min:2,max:5},
  holoDiameter:{type:'number',default:0.44,min:0.2,max:0.9},
  subRacks:{type:'int',default:2,min:1,max:2},
  withChair:{type:'bool',default:true},
 },
 slots:['frame','desk','screen','holoGlow','trim','chair'],
 adapt(raw){
  const out={...raw};
  const s=nums(raw.sizeXYZ,3)??nums(raw.deskSize,3);
  if(s){out.width=s[0]!;out.depth=s[1]!;out.deskHeight=Math.max(0.68,Math.min(1.05,s[2]!));}
  if(typeof raw.screenCount==='number')out.monitors=raw.screenCount;
  return out;
 },
 build(m:Model,p){
  const W=p.width,D=p.depth,H=p.deskHeight;
  // 弧形桌面几何:以操作员焦点 (0, *, zPivot) 为圆心,围绕 -Z 展开 spanDeg 弧段
  const spanDeg=92;
  const halfSpan=rad(spanDeg/2);
  const rOuter=Math.max(0.95,W/(2*Math.sin(halfSpan)));
  const deskBand=Math.min(0.58,Math.max(0.38,D*0.42));
  const rInner=Math.max(0.45,rOuter-deskBand);
  const zPivot=rOuter-D*0.48;
  const startDeg=90-spanDeg/2;

  const placeArc=(label:string,r0:number,r1:number,y0:number,y1:number,mat:string,ang=spanDeg,rot=startDeg)=>{
   m.revolve({points:rectProfile(r0,r1,y0,y1),segments:20,angle:ang,material:mat,label});
   m.rotate(sel.createdBy(label),'y',rot);
   m.translate(sel.createdBy(label),[0,0,zPivot]);
  };

  // 1. 弧形指挥台面 + 前后包边 + 台沿冷光导带 + 后背设备汇流梁
  placeArc('ws-desk-top',rInner,rOuter,H-0.045,H,'desk');
  placeArc('ws-desk-core',rInner+0.03,rOuter-0.02,H-0.085,H-0.045,'frame');
  placeArc('ws-lip-inner',rInner-0.018,rInner+0.015,H-0.042,H+0.006,'trim');
  placeArc('ws-lip-glow',rInner-0.022,rInner-0.012,H-0.03,H-0.014,'holoGlow',spanDeg*0.92,startDeg+spanDeg*0.04);
  placeArc('ws-rear-rail',rOuter-0.055,rOuter+0.025,H,H+0.075,'frame');
  placeArc('ws-rear-modesty',rOuter-0.025,rOuter+0.015,H*0.32,H-0.045,'frame',spanDeg*0.94,startDeg+spanDeg*0.03);

  // 2. 两侧斜撑悬臂立柱 + 底部滑橇底座 + 真实六角螺栓 + 下挂服务器副柜
  const wingBolts:BoltPlacement[]=[];
  for(let sideIdx=0;sideIdx<2;sideIdx++){
   const s=sideIdx===0?-1:1;
   const phi=rad(90+s*(spanDeg*0.42));
   const rMid=(rInner+rOuter)*0.5;
   const wx=rMid*Math.cos(phi),wz=zPivot-rMid*Math.sin(phi);
   // 地面滑橇脚
   m.box({size:[0.14,0.045,deskBand*0.92],center:[wx,0.0225,wz],material:'trim',label:`ws-skid-${sideIdx}`});
   // 斜撑双立柱
   bar(m,[wx,0.045,wz-deskBand*0.32],[wx,H-0.06,wz-deskBand*0.18],0.09,0.08,'frame',`ws-leg-f-${sideIdx}`);
   bar(m,[wx,0.045,wz+deskBand*0.28],[wx,H-0.06,wz+deskBand*0.14],0.075,0.07,'frame',`ws-leg-r-${sideIdx}`);
   m.box({size:[0.15,0.22,deskBand*0.58],center:[wx+s*0.015,H*0.52,wz],material:'trim',label:`ws-gusset-${sideIdx}`});
   for(const dy of [-0.06,0.06]){
    for(const dz of [-0.1,0.1]){
     wingBolts.push({position:[wx+s*0.09,H*0.52+dy,wz+dz],normal:[s,0,0]});
    }
   }

   // 下挂服务器副柜(subRacks=1 挂右侧,subRacks=2 左右对称双副柜)
   if(sideIdx<p.subRacks){
    const rw=Math.min(0.36,W*0.18),rh=H-0.16,rd=deskBand*0.76;
    const rx=wx-s*(rw*0.52+0.06),rz=wz-0.02;
    m.box({size:[rw,rh,rd],center:[rx,0.06+rh/2,rz],material:'frame',label:`ws-rack-${sideIdx}`});
    m.box({size:[rw+0.016,0.035,rd+0.016],center:[rx,0.045,rz],material:'trim',label:`ws-rack-base-${sideIdx}`});
    // 刀片服务器抽屉面板 + 拉手 + LED 阵列
    const blades=4;
    for(let b=0;b<blades;b++){
     const by=0.14+(b+0.5)*(rh-0.14)/blades;
     m.box({size:[rw*0.86,0.075,0.018],center:[rx,by,rz+rd/2+0.008],material:'trim',label:`ws-blade-${sideIdx}-${b}`});
     m.box({size:[rw*0.42,0.012,0.008],center:[rx-rw*0.12,by,rz+rd/2+0.02],material:'holoGlow',label:`ws-blade-led-${sideIdx}-${b}`});
    }
   }
  }
  appendHexBolts(m,wingBolts,{size:'M10',length:0.02,segments:12,material:'trim'});

  // 3. 操作员键控斜台(左/中/右三分区触控与推杆模块)
  const kbZ=zPivot-(rInner+deskBand*0.24);
  m.box({size:[Math.min(0.76,W*0.36),0.026,0.22],center:[0,H+0.014,kbZ],material:'trim',label:'ws-kb-tray'});
  m.box({size:[Math.min(0.66,W*0.31),0.012,0.13],center:[0,H+0.03,kbZ-0.02],material:'screen',label:'ws-kb-keys'});
  m.box({size:[Math.min(0.68,W*0.32),0.014,0.05],center:[0,H+0.024,kbZ+0.075],material:'desk',label:'ws-kb-rest'});
  for(const s of [-1,1]){
   const px=s*Math.min(0.5,W*0.24);
   m.box({size:[0.18,0.024,0.18],center:[px,H+0.012,kbZ+0.02],material:'trim',label:`ws-pad-${s}`});
   m.box({size:[0.13,0.008,0.13],center:[px,H+0.026,kbZ+0.02],material:'holoGlow',label:`ws-pad-glow-${s}`});
  }

  // 4. 桌面中央嵌入式全息战术投影盘与多层悬浮全息战术环
  const holoR=p.holoDiameter/2;
  const holoZ=zPivot-(rInner+deskBand*0.62);
  m.cylinder({radiusTop:holoR*0.72,radiusBottom:holoR*0.82,height:0.028,radialSegments:28,center:[0,H+0.012,holoZ],material:'trim',label:'ws-holo-well'});
  m.cylinder({radiusTop:holoR*0.58,radiusBottom:holoR*0.58,height:0.01,radialSegments:28,center:[0,H+0.028,holoZ],material:'screen',label:'ws-holo-lens'});

  const holoY=H+0.24;
  // 外层水平战术方位环
  m.torus({radius:holoR,tube:Math.max(0.007,holoR*0.038),radialSegments:10,tubularSegments:36,material:'holoGlow',label:'ws-holo-ring-main'});
  m.rotate(sel.createdBy('ws-holo-ring-main'),'x',90);
  m.translate(sel.createdBy('ws-holo-ring-main'),[0,holoY,holoZ]);

  // 内层倾斜陀螺战术环
  m.torus({radius:holoR*0.72,tube:Math.max(0.006,holoR*0.032),radialSegments:10,tubularSegments:32,material:'holoGlow',label:'ws-holo-ring-tilt'});
  m.rotate(sel.createdBy('ws-holo-ring-tilt'),'x',68);
  m.rotate(sel.createdBy('ws-holo-ring-tilt'),'z',18);
  m.translate(sel.createdBy('ws-holo-ring-tilt'),[0,holoY+0.02,holoZ]);

  // 中心悬浮战术核心球与四向刻度游标
  m.sphere({radius:Math.max(0.028,holoR*0.18),widthSegments:14,heightSegments:10,center:[0,holoY+0.02,holoZ],material:'holoGlow',label:'ws-holo-core'});
  for(let k=0;k<4;k++){
   const a=k*Math.PI/2;
   const tx=Math.cos(a)*holoR*1.06,tz=holoZ+Math.sin(a)*holoR*1.06;
   m.box({size:[0.018,0.028,0.018],center:[tx,holoY,tz],material:'holoGlow',label:`ws-holo-tick-${k}`});
   rod(m,[tx*0.55,H+0.032,holoZ+(tz-holoZ)*0.55],[tx*0.88,holoY-0.01,holoZ+(tz-holoZ)*0.88],0.004,'holoGlow',`ws-holo-ray-${k}`,6);
  }

  // 5. 弧形多联折角监控屏阵(每块屏沿弧排列并内倾朝向操作员焦点)
  const monSpan=Math.min(82,spanDeg-8);
  const rMon=rOuter-0.08;
  const arcLen=rad(monSpan)*rMon;
  const monW=Math.min(0.68,Math.max(0.36,(arcLen/p.monitors)*0.92));
  const monH=monW/1.72;
  const monY=H+0.2+monH/2;

  for(let i=0;i<p.monitors;i++){
   const u=p.monitors===1?0.5:(i+0.5)/p.monitors;
   const phiDeg=90-monSpan/2+u*monSpan;
   // 先在 [rMon, *, 0] 处建模,正面朝 -X(指向圆心),再绕 Y 旋转 phiDeg 并平移 zPivot
   const grp=(tag:string)=>`ws-mon-${i}-${tag}`;
   // 支臂立柱与万向节
   m.box({size:[0.045,monY-H+0.04,0.055],center:[rOuter-0.015,H+(monY-H)/2,0],material:'frame',label:grp('post')});
   m.box({size:[rOuter-rMon+0.03,0.04,0.06],center:[(rOuter+rMon)/2,monY,0],material:'trim',label:grp('arm')});
   // 显示器壳体、窄边框、发光屏幕与顶部遥测灯条
   m.box({size:[0.032,monH+0.028,monW+0.028],center:[rMon,monY,0],material:'trim',label:grp('bezel')});
   m.box({size:[0.024,monH*0.65,monW*0.55],center:[rMon+0.022,monY,0],material:'frame',label:grp('back')});
   m.box({size:[0.008,monH-0.016,monW-0.016],center:[rMon-0.018,monY,0],material:'screen',label:grp('panel')});
   m.box({size:[0.01,0.012,monW*0.72],center:[rMon-0.02,monY+monH/2+0.006,0],material:'holoGlow',label:grp('strip')});

   for(const part of ['bezel','back','panel','strip']){
    m.rotate(sel.createdBy(grp(part)),'z',-7,[rMon,monY,0]);
   }
   for(const part of ['post','arm','bezel','back','panel','strip']){
    m.rotate(sel.createdBy(grp(part)),'y',phiDeg);
    m.translate(sel.createdBy(grp(part)),[0,0,zPivot]);
   }
  }

  // 多屏时居中加装一块上层俯仰态势副屏
  if(p.monitors>=3){
   const topW=monW*1.15,topH=monH*0.52,topY=monY+monH*0.5+topH*0.5+0.045;
   const topZ=zPivot-rMon+0.02;
   bar(m,[0,monY+monH*0.35,zPivot-rOuter+0.02],[0,topY,topZ-0.03],0.045,0.045,'frame','ws-top-mast');
   m.box({size:[topW+0.024,topH+0.024,0.028],center:[0,topY,topZ],material:'trim',label:'ws-top-bezel'});
   m.box({size:[topW-0.014,topH-0.014,0.008],center:[0,topY,topZ+0.016],material:'screen',label:'ws-top-screen'});
   m.rotate(sel.createdBy('ws-top-bezel'),'x',14,[0,topY,topZ]);
   m.rotate(sel.createdBy('ws-top-screen'),'x',14,[0,topY,topZ]);
  }

  // 6. 人体工学高背指挥椅(位于 +Z 侧,面向 -Z 控制台)
  if(p.withChair){
   const cz=Math.min(D*0.44,zPivot-rInner+0.36);
   const seatY=Math.max(0.44,H-0.31);
   // 五星铸铝脚架 + 双轮脚轮 + 气压升降柱
   m.cylinder({radiusTop:0.036,radiusBottom:0.044,height:seatY-0.08,radialSegments:14,center:[0,0.08+(seatY-0.08)/2,cz],material:'frame',label:'ws-chair-col'});
   m.cylinder({radiusTop:0.052,radiusBottom:0.052,height:0.06,radialSegments:14,center:[0,0.12,cz],material:'trim',label:'ws-chair-collar'});
   for(let k=0;k<5;k++){
    const a=k*Math.PI*2/5;
    const lx=Math.sin(a)*0.31,lz=cz+Math.cos(a)*0.31;
    bar(m,[0,0.085,cz],[lx,0.05,lz],0.042,0.03,'frame',`ws-chair-leg-${k}`);
    m.cylinder({radiusTop:0.028,radiusBottom:0.028,height:0.034,radialSegments:10,center:[lx,0.028,lz],material:'trim',label:`ws-chair-wheel-${k}`});
    m.rotate(sel.createdBy(`ws-chair-wheel-${k}`),'z',90,[lx,0.028,lz]);
   }
   // 鞍形座垫 + 外骨骼分体高靠背 + 头枕 + 悬臂扶手
   m.box({size:[0.5,0.075,0.48],center:[0,seatY,cz],material:'chair',label:'ws-chair-seat'});
   m.box({size:[0.44,0.04,0.4],center:[0,seatY-0.048,cz],material:'frame',label:'ws-chair-pan'});
   // 背部外骨骼脊柱
   bar(m,[0,seatY-0.02,cz+0.2],[0,seatY+0.62,cz+0.28],0.07,0.045,'frame','ws-chair-spine');
   m.box({size:[0.46,0.38,0.065],center:[0,seatY+0.25,cz+0.22],material:'chair',label:'ws-chair-back'});
   m.box({size:[0.3,0.16,0.055],center:[0,seatY+0.55,cz+0.25],material:'chair',label:'ws-chair-head'});
   m.box({size:[0.34,0.05,0.03],center:[0,seatY+0.44,cz+0.26],material:'trim',label:'ws-chair-yoke'});
   for(const s of [-1,1]){
    bar(m,[s*0.26,seatY-0.02,cz+0.06],[s*0.27,seatY+0.19,cz+0.02],0.032,0.04,'frame',`ws-arm-post-${s}`);
    m.box({size:[0.075,0.028,0.26],center:[s*0.27,seatY+0.2,cz-0.02],material:'trim',label:`ws-arm-pad-${s}`});
   }
  }
 },
});

export const GEN_MECH_ACTUATOR=defineGenerator({
 id:'GEN-MECH-ACTUATOR-01',
 label:'液压锁紧支座与管簇',
 params:{
  width:{type:'number',default:1.05,min:0.55,max:2.4},
  depth:{type:'number',default:0.95,min:0.55,max:2.2},
  height:{type:'number',default:1.45,min:0.7,max:3.2},
  cylinders:{type:'int',default:2,min:1,max:4},
  tiltDeg:{type:'number',default:16,min:0,max:32},
  extension:{type:'number',default:0.45,min:0.1,max:0.85},
  conduits:{type:'int',default:2,min:1,max:4},
 },
 slots:['housing','piston','bolt','pipe','glow'],
 adapt(raw){
  const out={...raw};
  const s=nums(raw.sizeXYZ,3)??nums(raw.size,3);
  if(s){out.width=s[0]!;out.depth=s[1]!;out.height=s[2]!;}
  return out;
 },
 build(m:Model,p){
  const W=p.width,D=p.depth,H=p.height;
  const baseH=Math.min(0.14,H*0.1);
  const plinthH=Math.min(0.22,H*0.15);

  // 1. 重型阶梯锚固底板 + 侧向加强筋板 + 四周真实 ISO 六角地脚螺栓
  m.box({size:[W,baseH,D],center:[0,baseH/2,0],material:'housing',label:'ma-soleplate'});
  m.box({size:[W*0.82,plinthH,D*0.76],center:[0,baseH+plinthH/2,0],material:'housing',label:'ma-plinth'});
  for(const sx of [-1,1]){
   m.box({size:[0.045,plinthH*0.88,D*0.66],center:[sx*(W*0.41+0.02),baseH+plinthH*0.44,0],material:'housing',label:`ma-rib-${sx}`});
  }

  const baseBolts:BoltPlacement[]=[];
  const bx=W*0.44,bz=D*0.42;
  for(const sx of [-1,1]){
   for(const sz of [-1,0,1]){
    baseBolts.push({position:[sx*bx,baseH,sz*bz],normal:[0,1,0]});
   }
  }
  const boltMetric=W>=1.2?'M20':W>=0.8?'M16':'M12';
  appendHexBolts(m,baseBolts,{size:boltMetric,length:baseH*0.7,segments:12,material:'bolt'});

  // 2. 上部锁紧承力鞍座(带双耳夹紧颚板与横向锁紧螺栓)
  const tilt=rad(p.tiltDeg);
  const spanY=H*0.64;
  const shiftZ=Math.min(D*0.24,Math.tan(tilt)*spanY*0.5);
  const headY=H-Math.min(0.16,H*0.11);
  const headW=W*0.76,headD=Math.min(D*0.56,0.52),headH=Math.min(0.22,H*0.16);

  m.box({size:[headW,headH,headD],center:[0,headY,shiftZ],material:'housing',label:'ma-yoke'});
  // 顶部锁紧卡爪
  for(const sx of [-1,1]){
   m.box({size:[headW*0.26,headH*0.42,headD*0.84],center:[sx*headW*0.32,headY+headH*0.68,shiftZ],material:'housing',label:`ma-jaw-${sx}`});
  }
  // 后侧抗剪立柱导轨(将底座与上承力鞍座构成刚性闭合框架感)
  for(const sx of [-1,1]){
   const gx=sx*W*0.34;
   bar(m,[gx,baseH+plinthH*0.6,-shiftZ-headD*0.24],[gx,headY-headH*0.2,shiftZ-headD*0.28],0.065,0.075,'housing',`ma-guide-${sx}`);
  }
  const yokeBolts:BoltPlacement[]=[
   {position:[-headW/2,headY,shiftZ-headD*0.22],normal:[-1,0,0]},
   {position:[-headW/2,headY,shiftZ+headD*0.22],normal:[-1,0,0]},
   {position:[headW/2,headY,shiftZ-headD*0.22],normal:[1,0,0]},
   {position:[headW/2,headY,shiftZ+headD*0.22],normal:[1,0,0]},
  ];
  appendHexBolts(m,yokeBolts,{size:'M12',length:0.035,segments:12,material:'bolt'});

  // 3. 真实 recipes.hydraulicCylinder + recipes.clevis 多缸并联液压作动机构
  const yLow=baseH+plinthH+0.035;
  const yHigh=headY-headH*0.5-0.03;
  const usableW=headW*0.72;
  for(let i=0;i<p.cylinders;i++){
   const x=p.cylinders===1?0:(-usableW/2+usableW*i/(p.cylinders-1));
   const from:P3=[x,yLow,-shiftZ*0.85];
   const to:P3=[x,yHigh,shiftZ*0.95];
   appendHydraulicStrut(m,{
    from,
    to,
    bore:Math.min(0.14,Math.max(0.032,W*0.09/Math.sqrt(p.cylinders))),
    extension:p.extension,
    segments:20,
    housingMaterial:'housing',
    pistonMaterial:'piston',
    mountMaterial:'bolt',
    withClevis:true,
   });
  }

  // 4. 液压分配阀块与真实 pipeRun(m.pipeNetwork)高压弯管簇
  const manW=Math.min(0.24,W*0.26),manH=Math.min(0.26,H*0.2),manD=Math.min(0.32,D*0.36);
  const manX=0,manY=baseH+plinthH+manH/2,manZ=-D*0.26;
  m.box({size:[manW,manH,manD],center:[manX,manY,manZ],material:'housing',label:'ma-manifold'});
  appendHexBolts(
   m,
   [
    {position:[manX-manW*0.32,manY+manH/2,manZ-manD*0.28],normal:[0,1,0]},
    {position:[manX+manW*0.32,manY+manH/2,manZ-manD*0.28],normal:[0,1,0]},
    {position:[manX-manW*0.32,manY+manH/2,manZ+manD*0.28],normal:[0,1,0]},
    {position:[manX+manW*0.32,manY+manH/2,manZ+manD*0.28],normal:[0,1,0]},
   ],
   {size:'M10',length:0.025,segments:12,material:'bolt'},
  );

  const pipeR=Math.max(0.012,Math.min(0.026,Math.min(W,H)*0.02));
  for(let k=0;k<p.conduits;k++){
   const side=k%2===0?-1:1;
   const tier=Math.floor(k/2);
   const pxOut=side*(W*0.38+tier*pipeR*3.4);
   const zPort=manZ+(tier===0?-manD*0.22:manD*0.22);
   const yPort=manY+(tier===0?0.03:-0.03);
   const yTopRun=Math.min(headY-0.02,manY+0.18+(H-baseH-plinthH)*0.42+tier*pipeR*3.2);
   const zEnd=shiftZ+(tier===0?-headD*0.18:headD*0.18);
   const pts:P3[]=[
    [side*manW*0.5,yPort,zPort],
    [pxOut,yPort,zPort],
    [pxOut,yTopRun,zPort],
    [pxOut,yTopRun,zEnd],
    [side*headW*0.48,yTopRun,zEnd],
   ];
   pipeRun(m,pts,pipeR,'pipe','bolt',12);
  }

  // 5. 锁紧状态发光遥测灯带(上鞍座前额 + 分配阀块侧窗)
  const segs=4;
  const barSpan=headW*0.68;
  m.box({size:[barSpan+0.04,0.042,0.024],center:[0,headY,shiftZ+headD/2+0.01],material:'housing',label:'ma-glow-bezel'});
  for(let i=0;i<segs;i++){
   const gx=-barSpan/2+barSpan*(i+0.5)/segs;
   m.box({size:[barSpan/segs*0.74,0.02,0.012],center:[gx,headY,shiftZ+headD/2+0.022],material:'glow',label:`ma-glow-seg-${i}`});
  }
  m.box({size:[manW*0.68,0.022,0.014],center:[manX,manY+manH*0.22,manZ-manD/2-0.006],material:'glow',label:'ma-manifold-glow'});
 },
});
