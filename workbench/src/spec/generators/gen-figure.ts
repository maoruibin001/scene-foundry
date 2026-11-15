/**
 * GEN-FIGURE-01(调研 2026-11-07:比例参照与雾片):
 * kind=0 人形剪影 1.8m(头、躯干、手臂、腿,站立朝 +Z);kind=1 雾片/光束片:width×height 的竖直薄片(配半透明材质);
 * kind=2 门:宽 doorWidth、高 doorHeight 的门框 + 门扇 + 门顶灯条。
 */
import type {Model} from '@forgeax/engine/modeling';
import {defineGenerator} from './kit.ts';

export const GEN_FIGURE=defineGenerator({
 id:'GEN-FIGURE-01',label:'比例参照/雾片',
 params:{
  kind:{type:'int',default:0,min:0,max:2},
  height:{type:'number',default:1.8,min:0.5,max:200},
  width:{type:'number',default:10,min:0.1,max:200},
  doorWidth:{type:'number',default:1.4,min:0.5,max:10},
  doorHeight:{type:'number',default:2.4,min:1,max:12},
 },
 slots:['body','glow'],
 build(m:Model,p){
  if(p.kind===0){const s=p.height/1.8;
   m.box({size:[0.24*s,0.26*s,0.24*s],center:[0,1.66*s,0],material:'body',label:'head'});
   m.box({size:[0.46*s,0.62*s,0.26*s],center:[0,1.22*s,0],material:'body',label:'torso'});
   for(const sx of [-1,1]){m.box({size:[0.11*s,0.62*s,0.12*s],center:[sx*0.3*s,1.2*s,0],material:'body',label:'arm'});m.box({size:[0.17*s,0.9*s,0.2*s],center:[sx*0.12*s,0.45*s,0],material:'body',label:'leg'});}
   m.box({size:[0.2*s,0.03*s,0.02*s],center:[0,1.62*s,0.125*s],material:'glow',label:'visor'});
  }else if(p.kind===1){m.box({size:[p.width,p.height,0.02],center:[0,p.height/2,0],material:'body',label:'card'});}
  else{const w=p.doorWidth,h=p.doorHeight;
   for(const sx of [-1,1])m.box({size:[0.25,h+0.25,0.4],center:[sx*(w/2+0.125),(h+0.25)/2,0],material:'body',label:'jamb'});
   m.box({size:[w+0.5,0.25,0.4],center:[0,h+0.125,0],material:'body',label:'head'});
   m.box({size:[w,h,0.08],center:[0,h/2,-0.1],material:'body',label:'leaf'});
   m.box({size:[w+0.3,0.06,0.05],center:[0,h+0.3,0.2],material:'glow',label:'lamp'});
   m.box({size:[0.04,h*0.8,0.03],center:[0,h/2,-0.04],material:'glow',label:'seam'});}
 },
});
