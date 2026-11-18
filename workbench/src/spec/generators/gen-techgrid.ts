/**
 * GEN-TECHGRID-01(科幻调研 2026-11-07 杠杆 2/3/10):
 * mode=0 天花格栅:width×length 的深色格栅梁网格,每个格子中心一个发光小方灯(点彩光点),主梁下沿一条发光线;
 *        局部 Y 向下为室内(网格挂在 y=0,向下伸出梁高)。
 * mode=1 径向地面光线:以原点为中心,rays 条从 innerRadius 到 outerRadius 的发光细条 + 同心发光环,指向核心;贴地。
 */
import {sel,type Model} from '@forgeax/engine/modeling';
import {defineGenerator} from './kit.ts';

export const GEN_TECHGRID=defineGenerator({
 id:'GEN-TECHGRID-01',label:'科技格栅/径向光线',
 params:{
  mode:{type:'int',default:0,min:0,max:1},
  width:{type:'number',default:40,min:2,max:200},
  length:{type:'number',default:80,min:2,max:200},
  cell:{type:'number',default:4,min:0.5,max:20},
  beamDepth:{type:'number',default:0.8,min:0.05,max:5},
  rays:{type:'int',default:24,min:2,max:64},
  innerRadius:{type:'number',default:9,min:0,max:100},
  outerRadius:{type:'number',default:19,min:1,max:200},
  rings:{type:'int',default:3,min:0,max:12},
 },
 slots:['frame','glow','dot'],
 // 同一资产族里天花格栅与地面径向光线共用生成器:对象 ID 含 RAY/RADIAL 时取径向模式及其默认尺寸。
 adapt(raw,ctx){const out:any={...raw};if(/RAY|RADIAL/i.test(ctx?.id??'')){out.mode=1;for(const k of ['width','length','cell','beamDepth'])delete out[k];}return out;},
 build(m:Model,p){
  if(p.mode===0){
   const nx=Math.max(1,Math.round(p.width/p.cell)),nz=Math.max(1,Math.round(p.length/p.cell)),cx=p.width/nx,cz=p.length/nz,d=p.beamDepth;
   for(let i=0;i<=nx;i++){const x=-p.width/2+i*cx,main=i%2===0;m.box({size:[main?0.35:0.18,main?d:d*0.6,p.length],center:[x,-(main?d:d*0.6)/2,0],material:'frame',label:'g-beam-x'});
    if(main)m.box({size:[0.06,0.04,p.length],center:[x,-d-0.02,0],material:'glow',label:'g-line'});}
   for(let k=0;k<=nz;k++){const z=-p.length/2+k*cz;m.box({size:[p.width,d*0.6,0.18],center:[0,-d*0.3,z],material:'frame',label:'g-beam-z'});}
   for(let i=0;i<nx;i++)for(let k=0;k<nz;k++)m.box({size:[0.35,0.06,0.35],center:[-p.width/2+cx*(i+0.5),-d*0.6-0.03,-p.length/2+cz*(k+0.5)],material:'dot',label:'g-dot'});
  }else{
   // 每条沿 +Z 建好后绕 Y 转到自己的角度,指向中心
   for(let i=0;i<p.rays;i++){const len=p.outerRadius-p.innerRadius,mid=(p.innerRadius+p.outerRadius)/2,l='r-ray'+i;
    m.box({size:[0.09,0.012,len],center:[0,0.006,mid],material:'glow',label:l});m.rotate(sel.createdBy(l),'y',i*360/p.rays);}
   for(let k=0;k<p.rings;k++){const r=p.innerRadius+(p.outerRadius-p.innerRadius)*(k+1)/(p.rings+1);
    m.revolve({points:[[r-0.05,0],[r+0.05,0],[r+0.05,0.012],[r-0.05,0.012],[r-0.05,0]],segments:96,material:'glow',label:'r-ring'+k});}
  }
 },
});
