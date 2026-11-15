/**
 * 结构附件与灯具:环挂点与核心吊杆(GEN-RINGMOUNT-01)、泄能接口(GEN-SOCKET-01)、护盖支撑与维护架(GEN-BRACE-01)、
 * 楼梯(GEN-STAIR-01)、远端工业门(GEN-INDUSTRIALDOOR-01)、灯具(GEN-LUMINAIRE-01)。
 * 引擎局部轴:Y 向上;规格 +Y = 引擎 -Z。同族不同部件用 kind 区分,adapt 按对象 ID 确定。
 */
import {defineGenerator,nums,triples} from './kit.ts';
import {bar,rod,type P3} from './parts.ts';

const kindOf=(id:string|undefined,prefixes:string[])=>Math.max(0,prefixes.findIndex(p=>id?.startsWith(p)));

export const GEN_RINGMOUNT=defineGenerator({
 id:'GEN-RINGMOUNT-01',label:'环挂点 / 核心吊杆',
 params:{mast:{type:'bool',default:false},mastUp:{type:'number',default:0.8,min:0,max:80},mastDown:{type:'number',default:6.7,min:0,max:80},hubDiameter:{type:'number',default:1.6,min:0.2,max:6},mastSection:{type:'number',default:0.9,min:0.1,max:4}},
 slots:['mountHousing','jointAxle','mast','emitterLens','indicator'],
 // 吊杆从桁架下弦一直落到核心顶(规格 mastBottomZ),所以长度按对象高度换算。
 adapt(raw,ctx){const out={...raw};if(typeof raw.hubDiameter==='number'&&ctx){out.mast=true;const bottom=typeof raw.mastBottomZ==='number'?raw.mastBottomZ:11;out.mastDown=Math.max(0.5,ctx.position[2]-bottom);if(typeof raw.mastTopZ==='number')out.mastUp=Math.max(0,Math.min(1.2,raw.mastTopZ-ctx.position[2]));}return out;},
 build(m,p){
  if(p.mast){const s=p.mastSection,r=p.hubDiameter/2;
   bar(m,[0,p.mastUp,0],[0,-p.mastDown+0.6,0],s,s,'mast','mast');
   for(let i=0;i<4;i++){const a=i*Math.PI/2;bar(m,[Math.cos(a)*s*0.5,-p.mastDown*0.2,Math.sin(a)*s*0.5],[Math.cos(a)*s*0.5,-p.mastDown+0.8,Math.sin(a)*s*0.5],0.06,0.06,'jointAxle','rib');}
   m.cylinder({radiusTop:r*0.7,radiusBottom:r,height:0.6,radialSegments:28,center:[0,-p.mastDown+0.3,0],material:'mountHousing',label:'hub'});
   m.cylinder({radiusTop:r*1.02,radiusBottom:r*1.02,height:0.06,radialSegments:28,center:[0,-p.mastDown+0.45,0],material:'indicator',label:'hub-ring'});return;}
  m.box({size:[0.55,0.7,0.55],center:[0,0,0],material:'mountHousing',label:'housing'});
  rod(m,[0,0,-0.45],[0,0,0.45],0.12,'jointAxle','axle',14);
  m.cylinder({radiusTop:0.16,radiusBottom:0.16,height:0.05,radialSegments:16,center:[0,0.37,0],material:'emitterLens',label:'lens'});
  m.box({size:[0.08,0.05,0.02],center:[0.18,0.2,0.285],material:'indicator',label:'indicator'});
 },
});

export const GEN_SOCKET=defineGenerator({
 id:'GEN-SOCKET-01',label:'泄能接口',assembly:true,
 params:{acceptRadius:{type:'number',default:0.8,min:0.2,max:3},depth:{type:'number',default:0.9,min:0.2,max:4}},
 slots:['base','liner','contactRing','statusLight','cover','coverMarking','hinge'],
 // 开口朝规格局部 +Y(引擎 -Z);实例旋转把它转到世界 +X。
 build(m,p){
  const R=p.acceptRadius,D=p.depth;
  rod(m,[0,0,D*0.5],[0,0,-D*0.5],R*1.25,'base','housing',32);
  rod(m,[0,0,-D*0.5],[0,0,-D*0.5-0.08],R*1.05,'contactRing','contact',32);
  rod(m,[0,0,-D*0.5-0.08],[0,0,-D*0.5-0.1],R*0.95,'liner','mouth',32);
  rod(m,[0,0,-D*0.5-0.1],[0,0,-D*0.5-0.16],R*1.0,'cover','cover',32);
  m.box({size:[R*1.6,0.08,0.01],center:[0,0,-D*0.5-0.165],material:'coverMarking',label:'marking'});
  for(const s of [-1,1])rod(m,[s*R*0.6,R*1.02,-D*0.5-0.1],[s*R*0.6+s*0.25,R*1.02,-D*0.5-0.1],0.06,'hinge','hinge',10);
  rod(m,[0,0,-D*0.5+0.02],[0,0,-D*0.5-0.02],R*1.32,'statusLight','status',32);
 },
});

export const GEN_BRACE=defineGenerator({
 id:'GEN-BRACE-01',label:'护盖支撑 / 接口维护架',
 params:{endPoint:{type:'list',default:[0,3,0],min:-30,max:30,minLength:3,maxLength:3,stride:3},diameter:{type:'number',default:0.22,min:0.03,max:2},seamFraction:{type:'number',default:0.45,min:0.05,max:0.95},rack:{type:'bool',default:false},footprint:{type:'vec3',default:[1.6,4.2,0],min:0,max:30},deckHeight:{type:'number',default:4.5,min:0.3,max:20}},
 slots:['braceBody','seamSection','frame','bolt'],
 adapt(raw,ctx){const out={...raw};if(typeof raw.cutSeamFraction==='number')out.seamFraction=raw.cutSeamFraction;const f=nums(raw.footprint,2);if(f){out.rack=true;out.footprint=[f[0],f[1],0];if(typeof raw.topDeckZ==='number'&&ctx)out.deckHeight=raw.topDeckZ-ctx.position[2];}else if(typeof raw.footprint==='number'&&Number.isFinite(raw.footprint)&&raw.footprint>0){out.rack=true;out.footprint=[Math.min(30,raw.footprint),Math.min(30,raw.footprint*2),0];if(typeof raw.topDeckZ==='number'&&ctx)out.deckHeight=Math.max(0.3,raw.topDeckZ-ctx.position[2]);}return out;},
 build(m,p){
  if(p.rack){const [w,l]=p.footprint,h=p.deckHeight;
   for(const x of [-1,1])for(const z of [-1,1])bar(m,[x*(w/2-0.08),0,z*(l/2-0.08)],[x*(w/2-0.08),h,z*(l/2-0.08)],0.14,0.14,'frame','leg');
   m.box({size:[w,0.1,l],center:[0,h-0.05,0],material:'frame',label:'deck'});
   for(const x of [-1,1])bar(m,[x*(w/2-0.08),0.3,-(l/2-0.08)],[x*(w/2-0.08),h-0.3,l/2-0.08],0.06,0.06,'braceBody','x-brace');return;}
  const e=triples(p.endPoint)[0],r=p.diameter/2,t=p.seamFraction,c:P3=[e[0]*t,e[1]*t,e[2]*t],L=Math.hypot(...e),u=e.map(v=>v/L) as P3;
  rod(m,[0,0,0],e,r,'braceBody','brace',14);
  rod(m,c.map((v,k)=>v-u[k]*0.05) as P3,c.map((v,k)=>v+u[k]*0.05) as P3,r*1.18,'seamSection','seam',14);
  for(const q of [[0,0,0],e] as P3[]){m.box({size:[r*3.5,r*3.5,r*3.5],center:q,material:'frame',label:'plate'});for(const s of [-1,1])m.sphere({radius:r*0.35,widthSegments:8,heightSegments:4,center:[q[0]+s*r*1.3,q[1]+r*1.8,q[2]],material:'bolt',label:'bolt'});}
 },
});

export const GEN_STAIR=defineGenerator({
 id:'GEN-STAIR-01',label:'楼梯(两跑一平台)',
 params:{rise:{type:'number',default:5,min:0.5,max:20},stepHeight:{type:'number',default:0.17,min:0.12,max:0.22},tread:{type:'number',default:0.29,min:0.22,max:0.4},width:{type:'number',default:2.5,min:0.8,max:6},landingLength:{type:'number',default:2.5,min:0.8,max:6}},
 slots:['tread','stringer','landing','handrail','nosing'],
 adapt(raw){const out={...raw},r=nums(raw.riseRisersStepTread,4);if(r){out.rise=r[0];out.stepHeight=r[2];out.tread=r[3];}return out;},
 build(m,p){
  // 两跑同向沿局部 -Z(规格 +Y)上行,中间一个平台;级数按 rise/stepHeight 取整,不压扁踏步。
  const n=Math.round(p.rise/p.stepHeight),h=p.rise/n,t=p.tread,W=p.width,first=Math.ceil(n/2),L=p.landingLength;
  const stepZ=(i:number)=>i<first?-(i*t+t/2):-(first*t+L+(i-first)*t+t/2);
  for(let i=0;i<n;i++){const y=(i+1)*h,z=stepZ(i);m.box({size:[W,0.05,t+0.02],center:[0,y-0.025,z],material:'tread',label:'tread'});m.box({size:[W,0.03,0.04],center:[0,y-0.015,z+t/2-0.01],material:'nosing',label:'nosing'});}
  const zl=-(first*t),yl=first*h;
  m.box({size:[W,0.12,L],center:[0,yl-0.06,zl-L/2],material:'landing',label:'landing'});
  for(const s of [-1,1])for(const [y0,z0,y1,z1] of [[0,0,yl,zl],[yl,zl-L,p.rise,zl-L-(n-first)*t]]){
   bar(m,[s*W/2,y0,z0],[s*W/2,y1,z1],0.06,0.3,'stringer','stringer');
   bar(m,[s*(W/2-0.03),y0+0.95,z0],[s*(W/2-0.03),y1+0.95,z1],0.05,0.05,'handrail','handrail');
   for(const [y,z] of [[y0,z0],[y1,z1],[(y0+y1)/2,(z0+z1)/2]])bar(m,[s*(W/2-0.03),y,z],[s*(W/2-0.03),y+0.95,z],0.04,0.04,'handrail','post');
  }
  for(const x of [-1,1])for(const z of [zl-0.15,zl-L+0.15])bar(m,[x*(W/2-0.15),0,z],[x*(W/2-0.15),yl-0.12,z],0.12,0.12,'stringer','landing-post');
 },
});

export const GEN_INDUSTRIALDOOR=defineGenerator({
 id:'GEN-INDUSTRIALDOOR-01',label:'远端工业门',
 params:{doorWidth:{type:'number',default:6,min:1,max:20},doorHeight:{type:'number',default:8,min:2,max:20},nests:{type:'int',default:3,min:1,max:6},depthStep:{type:'number',default:1.2,min:0.2,max:4},warningSign:{type:'bool',default:true}},
 slots:['frame','doorLeaf','warningSign','frameLightStrip'],
 adapt(raw){const out={...raw},s=nums(raw.size,2);if(s){out.doorWidth=s[0];out.doorHeight=s[1];}if(typeof raw.frameNestCount==='number')out.nests=raw.frameNestCount;if(typeof raw.frameDepthStep==='number')out.depthStep=raw.frameDepthStep;if(typeof raw.warningSign==='string')out.warningSign=true;return out;},
 build(m,p){
  // 层层内收的门框(越往里越小),门扇闭合在最内层;每层门框内沿一圈发光条。
  const W=p.doorWidth,H=p.doorHeight,f=0.5;
  for(let k=0;k<p.nests;k++){const g=(p.nests-1-k)*0.8,w=W+2*g,h=H+g,z=k*p.depthStep;
   for(const s of [-1,1])m.box({size:[f,h+f,p.depthStep],center:[s*(w/2+f/2),(h+f)/2,z],material:'frame',label:'jamb'});
   m.box({size:[w+2*f,f,p.depthStep],center:[0,h+f/2,z],material:'frame',label:'head'});
   for(const s of [-1,1])m.box({size:[0.05,h,0.05],center:[s*(w/2+0.03),h/2,z-p.depthStep/2+0.05],material:'frameLightStrip',label:'strip'});
   m.box({size:[w,0.05,0.05],center:[0,h+0.03,z-p.depthStep/2+0.05],material:'frameLightStrip',label:'strip'});
  }
  const zd=(p.nests-1)*p.depthStep;
  for(const s of [-1,1]){m.box({size:[W/2-0.02,H,0.2],center:[s*W/4,H/2,zd],material:'doorLeaf',label:'leaf'});
   for(let r=1;r<6;r++)m.box({size:[W/2-0.2,0.08,0.05],center:[s*W/4,H*r/6,zd-0.12],material:'frame',label:'rib'});}
  if(p.warningSign)m.box({size:[1.2,0.8,0.03],center:[0,H*0.62,zd-0.16],material:'warningSign',label:'sign'});
 },
});

export const GEN_LUMINAIRE=defineGenerator({
 id:'GEN-LUMINAIRE-01',label:'灯具',
 params:{kind:{type:'int',default:0,min:0,max:5},size:{type:'vec3',default:[2.4,1.2,0.12],min:0.02,max:20},count:{type:'int',default:16,min:1,max:64},ringHalfX:{type:'number',default:14,min:1,max:60},ringHalfY:{type:'number',default:16,min:1,max:60}},
 slots:['housing','lampFace','guideStrip','wallLamp','emergencyLens'],
 adapt(raw,ctx){const out={...raw};out.kind=kindOf(ctx?.id,['CTRL_LIGHT','LUM_HIGHBAY','LUM_SPOT','LUM_EMERGENCY','LUM_GUIDE','LUM_AISLE']);return out;},
 build(m,p){
  if(p.kind===0){const [w,d,h]=p.size;m.box({size:[w,h,d],center:[0,0,0],material:'housing',label:'trough'});m.box({size:[w-0.1,0.01,d-0.1],center:[0,-h/2-0.006,0],material:'lampFace',label:'face'});}
  else if(p.kind===1){m.box({size:[0.5,0.25,3],center:[0,0,0],material:'housing',label:'highbay'});m.box({size:[0.4,0.01,2.8],center:[0,-0.13,0],material:'lampFace',label:'face'});rod(m,[0,0.12,0],[0,1.2,0],0.02,'housing','hanger',6);}
  else if(p.kind===2){m.cylinder({radiusTop:0.25,radiusBottom:0.35,height:0.6,radialSegments:20,center:[0,0,0],material:'housing',label:'can'});m.cylinder({radiusTop:0.3,radiusBottom:0.3,height:0.02,radialSegments:20,center:[0,-0.31,0],material:'lampFace',label:'lens'});m.box({size:[0.7,0.1,0.1],center:[0,0.35,0],material:'housing',label:'yoke'});}
  else if(p.kind===3){m.box({size:[0.35,0.18,0.12],center:[0,0,0],material:'wallLamp',label:'box'});m.box({size:[0.3,0.13,0.02],center:[0,0,0.07],material:'emergencyLens',label:'lens'});}
  else if(p.kind===5){ // 中轴走道:两条琥珀色嵌地灯带夹一条深色防滑走道(概念图 01 前景直通水池的通道),沿局部 -Z 延伸 ringHalfY 米
   const L=p.ringHalfY,w=p.ringHalfX;
   m.box({size:[w,0.02,L],center:[0,0.01,-L/2],material:'housing',label:'aisle'});
   for(const sx of [-1,1]){m.box({size:[0.08,0.03,L-0.4],center:[sx*(w/2+0.1),0.025,-L/2],material:'guideStrip',label:'aisle-lamp'});
    m.box({size:[0.22,0.02,L-0.2],center:[sx*(w/2+0.1),0.012,-L/2],material:'housing',label:'aisle-lamp-frame'});}
  }
  else{ // 引导灯:沿外环通路外缘等距排布的琥珀色地灯
   const hx=p.ringHalfX+1.6,hy=p.ringHalfY+1.6,per=4*(hx+hy);
   for(let i=0;i<p.count;i++){let s=per*i/p.count,x:number,z:number;
    if(s<2*hx){x=-hx+s;z=hy;}else if((s-=2*hx)<2*hy){x=hx;z=hy-s;}else if((s-=2*hy)<2*hx){x=hx-s;z=-hy;}else{s-=2*hx;x=-hx;z=-hy+s;}
    m.box({size:[0.3,0.03,0.12],center:[x,0.04,z],material:'guideStrip',label:'guide'});}
  }
 },
});
