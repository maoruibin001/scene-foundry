/**
 * GEN-GLASS-01(手册卷三 §3 玻璃):整块玻璃板 + 四边橡胶压条。局部原点在板中心,板面法线沿局部 +Z,宽沿 X、高沿 Y。
 * 静态场景只输出完整板;裂纹/破片属于运行时破坏状态,不在这里生成。
 */
import type {Model} from '@forgeax/engine/modeling';
import {defineGenerator,nums} from './kit.ts';

export const GEN_GLASS=defineGenerator({
 id:'GEN-GLASS-01',label:'玻璃板',
 params:{
  width:{type:'number',default:3,min:0.2,max:10},
  height:{type:'number',default:3,min:0.2,max:10},
  thickness:{type:'number',default:0.05,min:0.005,max:0.3},
  gasket:{type:'number',default:0.03,min:0,max:0.2,toggle:0.03},
 },
 slots:['glass','edgeGasket'],
 adapt(raw){const v=nums(raw.widthHeightThickness,3);return v?{...raw,width:v[0],height:v[1],thickness:v[2]}:raw;},
 build(m:Model,p){
  const w=p.width,h=p.height,t=p.thickness,g=p.gasket;
  m.box({size:[w-2*g,h-2*g,t],center:[0,0,0],material:'glass',label:'pane'});
  if(g>0)for(const s of [-1,1]){
   m.box({size:[w,g,t*1.4],center:[0,s*(h/2-g/2),0],material:'edgeGasket',label:'gasket-h'});
   m.box({size:[g,h-2*g,t*1.4],center:[s*(w/2-g/2),0,0],material:'edgeGasket',label:'gasket-v'});
  }
 },
});
