/**
 * 沿折线的基础设施:管道(GEN-PIPE-01)、线槽(GEN-CABLETRAY-01)、线缆(GEN-CABLE-01)、导流管(GEN-DISCHARGE-01)、
 * 天车轨道(GEN-CRANERAIL-01)。折线 path 是引擎局部坐标(导出器已把 pathPointsWorld 换算好),局部原点即对象位置。
 */
import type {Model} from '@forgeax/engine/modeling';
import {defineGenerator,nums,triples} from './kit.ts';
import {along,bar,polyRod,rod,type P3} from './parts.ts';

const path=(def=[0,0,0,0,0,-4])=>({type:'list' as const,default:def,min:-120,max:120,minLength:6,maxLength:96,stride:3});

export const GEN_PIPE=defineGenerator({
 id:'GEN-PIPE-01',label:'管道',
 params:{path:path(),diameter:{type:'number',default:0.25,min:0.03,max:2},flangeSpacing:{type:'number',default:6,min:0,max:40},clampSpacing:{type:'number',default:3,min:0,max:40}},
 slots:['pipe','flange','clamp'],
 adapt(raw){const out={...raw};if(typeof raw.selectedDiameter==='number')out.diameter=raw.selectedDiameter;return out;},
 build(m,p){
  const pts=triples(p.path),r=p.diameter/2;polyRod(m,pts,r,'pipe','flange');
  if(p.flangeSpacing>0)for(const {p:q,d} of along(pts,p.flangeSpacing))rod(m,q.map((v,k)=>v-d[k]*0.04) as P3,q.map((v,k)=>v+d[k]*0.04) as P3,r*1.45,'flange','flange');
  if(p.clampSpacing>0)for(const {p:q,d} of along(pts,p.clampSpacing))rod(m,q.map((v,k)=>v-d[k]*0.05) as P3,q.map((v,k)=>v+d[k]*0.05) as P3,r*1.2,'clamp','clamp');
 },
});

export const GEN_CABLETRAY=defineGenerator({
 id:'GEN-CABLETRAY-01',label:'线槽',
 params:{path:path(),trayWidth:{type:'number',default:0.45,min:0.1,max:2},trayDepth:{type:'number',default:0.12,min:0.03,max:0.6},supportSpacing:{type:'number',default:2,min:0.5,max:10}},
 slots:['tray','support'],
 adapt(raw){const out={...raw},w=nums(raw.widthStraightsCorners);if(w)out.trayWidth=w[0];return out;},
 build(m,p){
  const pts=triples(p.path),w=p.trayWidth,h=p.trayDepth;
  for(let i=0;i+1<pts.length;i++){
   const a=pts[i],b=pts[i+1],d=[b[0]-a[0],b[2]-a[2]],l=Math.hypot(...d)||1,n:[number,number]=[-d[1]/l,d[0]/l];
   bar(m,a,b,w,0.012,'tray','tray-bottom');
   for(const s of [-1,1]){const o=(q:P3):P3=>[q[0]+n[0]*s*w/2,q[1]+h/2,q[2]+n[1]*s*w/2];bar(m,o(a),o(b),0.012,h,'tray','tray-side');}
  }
  for(const {p:q} of along(pts,p.supportSpacing))bar(m,[q[0],q[1]-0.05,q[2]],[q[0],q[1]+0.55,q[2]],0.05,0.05,'support','hanger');
 },
});

export const GEN_CABLE=defineGenerator({
 id:'GEN-CABLE-01',label:'线缆与线盘',
 params:{path:path(),diameter:{type:'number',default:0.03,min:0.005,max:0.3},bundle:{type:'int',default:4,min:1,max:12},reel:{type:'bool',default:false},reelDiameter:{type:'number',default:0.9,min:0.2,max:3}},
 slots:['cable','plug','junctionBox','reel'],
 adapt(raw){const out={...raw};if(!raw.path&&typeof raw.diameter==='number'&&raw.diameter>=0.3){out.reel=true;out.reelDiameter=raw.diameter;delete out.diameter;}if(typeof raw.bundleCount==='number')out.bundle=raw.bundleCount;return out;},
 build(m,p){
  if(p.reel){const R=p.reelDiameter/2;
   for(const s of [-1,1])m.cylinder({radiusTop:R,radiusBottom:R,height:0.05,radialSegments:28,center:[0,R,s*0.3],material:'reel',label:'reel-flange'});
   rod(m,[0,R,-0.3],[0,R,0.3],R*0.7,'cable','reel-core',24);return;}
  const pts=triples(p.path),r=p.diameter/2*Math.sqrt(p.bundle);polyRod(m,pts,r,'cable','cable',8);
  for(const q of [pts[0],pts[pts.length-1]])m.box({size:[r*5,r*5,r*5],center:q,material:'plug',label:'plug'});
 },
});

export const GEN_DISCHARGE=defineGenerator({
 id:'GEN-DISCHARGE-01',label:'泄能导流管与井口',
 params:{path:path(),conduitDiameter:{type:'number',default:0.5,min:0.1,max:3},bandSpacing:{type:'number',default:1.5,min:0.3,max:10},well:{type:'bool',default:false},wellSize:{type:'number',default:2,min:0.5,max:10}},
 slots:['conduit','conduitBand','drainWellFrame','flowChannelGlass'],
 adapt(raw){const out={...raw},s=nums(raw.size);if(s&&!raw.path){out.well=true;out.wellSize=s[0];}return out;},
 build(m,p){
  if(p.well){const w=p.wellSize,t=0.15;
   for(const s of [-1,1]){m.box({size:[w+2*t,0.2,t],center:[0,0.1,s*(w/2+t/2)],material:'drainWellFrame',label:'well-frame'});m.box({size:[t,0.2,w],center:[s*(w/2+t/2),0.1,0],material:'drainWellFrame',label:'well-frame'});}
   m.box({size:[w,0.02,w],center:[0,0.15,0],material:'flowChannelGlass',label:'well-glow'});return;}
  const pts=triples(p.path),r=p.conduitDiameter/2;polyRod(m,pts,r,'conduit','conduit',16);
  // 导流管中线的发光观察窗:每段细长的发光芯,概念里泄能时点亮。
  for(let i=0;i+1<pts.length;i++)rod(m,pts[i],pts[i+1],r*0.35,'flowChannelGlass','flow',10);
  for(const {p:q,d} of along(pts,p.bandSpacing))rod(m,q.map((v,k)=>v-d[k]*0.06) as P3,q.map((v,k)=>v+d[k]*0.06) as P3,r*1.15,'conduitBand','band',16);
 },
});

export const GEN_CRANERAIL=defineGenerator({
 id:'GEN-CRANERAIL-01',label:'顶棚维修吊轨',
 params:{length:{type:'number',default:50,min:4,max:120},hangerSpacing:{type:'number',default:6,min:1,max:20},hangerHeight:{type:'number',default:1.6,min:0,max:6},parkedHook:{type:'number',default:0,min:-60,max:60}},
 slots:['rail','hanger','trolley'],
 adapt(raw,ctx){const out={...raw};if(typeof raw.parkedHookY==='number'&&ctx)out.parkedHook=-(raw.parkedHookY-ctx.position[1]);return out;},
 build(m:Model,p){
  const L=p.length;
  m.box({size:[0.3,0.03,L],center:[0,0.2,0],material:'rail',label:'flange-top'});m.box({size:[0.3,0.03,L],center:[0,-0.2,0],material:'rail',label:'flange-bottom'});
  m.box({size:[0.025,0.4,L],center:[0,0,0],material:'rail',label:'web'});
  for(let z=-L/2;z<=L/2+1e-6;z+=p.hangerSpacing)if(p.hangerHeight>0)m.box({size:[0.08,p.hangerHeight,0.08],center:[0,0.2+p.hangerHeight/2,z],material:'hanger',label:'hanger'});
  const z=Math.max(-L/2+0.6,Math.min(L/2-0.6,p.parkedHook));
  m.box({size:[0.7,0.45,1.0],center:[0,-0.45,z],material:'trolley',label:'trolley'});
  rod(m,[0,-0.7,z],[0,-2.2,z],0.015,'hanger','hook-cable',6);m.box({size:[0.18,0.3,0.06],center:[0,-2.35,z],material:'trolley',label:'hook'});
 },
});
