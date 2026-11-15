/**
 * GEN-FLOOR-01(规格化新增):大厅完成地面。局部原点在完成地面中心(顶面 y=0),宽沿 X、长沿局部 Z(规格 Y 取反)。
 * 混凝土基底整板 + 按 panelSize 拼的金属地板(留缝),中央池洞按 poolCutout 扣除;沿池洞四周与主通路边线铺黄色标线;
 * 排水格栅按间距沿长边布置;湿地面只是零星的薄覆层(wetMaskCoverage 是面积比例,不铺满)。
 * 面板顶面高出基底 2 cm,覆层再高 2 mm,避免共面闪烁。
 */
import {sel,type Model} from '@forgeax/engine/modeling';
import {defineGenerator,nums} from './kit.ts';

export const GEN_FLOOR=defineGenerator({
 id:'GEN-FLOOR-01',label:'大厅地面',assembly:true,
 params:{
  width:{type:'number',default:48,min:4,max:120},
  length:{type:'number',default:55,min:4,max:120},
  poolCutout:{type:'vec3',default:[20,24,0],min:0,max:120},
  panelSize:{type:'number',default:2,min:0.5,max:8},
  seamWidth:{type:'number',default:0.02,min:0.002,max:0.2},
  drainGrateSpacing:{type:'number',default:8,min:0,max:40},
  wetMaskCoverage:{type:'number',default:0.08,min:0,max:0.4},
  markingWidth:{type:'number',default:0.12,min:0.02,max:0.5},
  walkwayInset:{type:'number',default:10,min:0,max:60},
  roundCutout:{type:'bool',default:false},
  clutter:{type:'number',default:0,min:0,max:400},
 },
 slots:['substrate','metalPanel','wetOverlay','drainGrate','markingStripe'],
 adapt(raw){
  const out={...raw},ext=nums(raw.extentXY,4),cut=nums(raw.poolCutoutXY,4),panel=nums(raw.panelSize);
  if(ext){out.width=ext[1]-ext[0];out.length=ext[3]-ext[2];}
  if(cut)out.poolCutout=[cut[1]-cut[0],cut[3]-cut[2],0];
  if(Array.isArray(raw.poolCutout)&&raw.poolCutout.length===2)out.poolCutout=[...raw.poolCutout,0];
  if(panel)out.panelSize=panel[0];                                            // 面板按方格铺,取长边
  return out;
 },
 build(m:Model,p){
  const W=p.width,L=p.length,[cw,cl]=p.poolCutout,ps=p.panelSize,g=p.seamWidth,top=0.02;
  if(cw>=W-1||cl>=L-1)throw Error('GEN-FLOOR-01: 池洞必须小于地面');
  // 基底:池洞四周四块,池洞内不铺。
  const sub=0.3;
  m.box({size:[W,sub,(L-cl)/2],center:[0,-sub/2,-(cl/2+(L-cl)/4)],material:'substrate',label:'substrate'});
  m.box({size:[W,sub,(L-cl)/2],center:[0,-sub/2,cl/2+(L-cl)/4],material:'substrate',label:'substrate'});
  if(cl>0)for(const s of [-1,1])m.box({size:[(W-cw)/2,sub,cl],center:[s*(cw/2+(W-cw)/4),-sub/2,0],material:'substrate',label:'substrate'});
  // 金属地板:按网格铺,和池洞相交的格子跳过(格子与池洞对齐到面板网格)。
  const nx=Math.floor(W/ps),nz=Math.floor(L/ps),x0=-nx*ps/2,z0=-nz*ps/2;
  // 椭圆池洞:有任一角落在椭圆内的板跳过,椭圆外缘与整板之间的锯齿由池边环形平台盖住。
  const inEllipse=(x:number,z:number)=>(x/(cw/2))**2+(z/(cl/2))**2<1;
  for(let i=0;i<nx;i++)for(let k=0;k<nz;k++){
   const a=x0+i*ps,b=z0+k*ps;
   if(p.roundCutout?[[a,b],[a+ps,b],[a,b+ps],[a+ps,b+ps]].some(([x,z])=>inEllipse(x,z)):a+ps>-cw/2&&a<cw/2&&b+ps>-cl/2&&b<cl/2)continue;
   m.box({size:[ps-g,top,ps-g],center:[a+ps/2,top/2,b+ps/2],material:'metalPanel',label:'panel'});
  }
  // 黄色标线:池洞外圈 + 主通路边线(距池洞 walkwayInset 的矩形环)。
  const mw=p.markingWidth,y=top+0.002;
  const ring=(hw:number,hl:number,label:string)=>{
   for(const s of [-1,1]){
    m.box({size:[2*hw+mw,0.004,mw],center:[0,y,s*hl],material:'markingStripe',label});
    m.box({size:[mw,0.004,2*hl],center:[s*hw,y,0],material:'markingStripe',label});
   }
  };
  if(p.roundCutout){
   // 池边环形平台(内缘贴椭圆池洞,宽度盖住整板锯齿)+ 外缘一圈黄色标线;旋转出圆环后沿 Z 拉成椭圆。
   const r=cw/2,deck=ps*1.5+0.3,k=cl/cw,ring=(r0:number,r1:number,y0:number,y1:number,material:string,label:string)=>{m.revolve({points:[[r0,y0],[r1,y0],[r1,y1],[r0,y1],[r0,y0]],segments:96,material,label});if(k!==1)m.scale(sel.createdBy(label),[1,1,k],[0,0,0]);};
   ring(r,r+deck,-0.3,top,'metalPanel','pool-deck');ring(r+deck-0.25,r+deck-0.1,top,top+0.004,'markingStripe','marking-pool');
  }else ring(cw/2+0.6,cl/2+0.6,'marking-pool');
  const rw=cw/2+p.walkwayInset/2,rl=cl/2+p.walkwayInset/2;
  if(p.walkwayInset>0&&rw<W/2-0.5&&rl<L/2-0.5)ring(rw,rl,'marking-walkway');
  // 贴地杂物(clutter>0):线缆束、检修盖板、排水沟格栅条、散落螺栓板、地面接线盒——
  // 概念图地面的高频细节主要来自这些贴地小件,不是贴图。确定性排布,避开池洞。
  if(p.clutter>0){const clutterCount=p.clutter<1?Math.round((W*L-cw*cl)*p.clutter/4):Math.round(p.clutter);let sd=7;const rr=()=>{sd=(sd*16807)%2147483647;return sd/2147483647;};
   for(let i=0;i<clutterCount;i++){const x=(rr()-0.5)*(W-2),z=(rr()-0.5)*(L-2),k=rr();
    if(p.roundCutout?(x/(cw/2+2.4))**2+(z/(cl/2+2.4))**2<1:Math.abs(x)<cw/2+2&&Math.abs(z)<cl/2+2)continue;
    if(k<0.3){const a=rr()*Math.PI,len=1.5+rr()*5;for(let j=0;j<2+Math.floor(rr()*3);j++){const o=j*0.06;m.box({size:[len,0.035,0.035],center:[x+Math.sin(a)*o,top+0.018,z+Math.cos(a)*o],material:'substrate',label:'cable'});m.rotate(sel.createdBy('cable'),'y',0);}}
    else if(k<0.5){m.box({size:[0.9,0.02,0.9],center:[x,top+0.01,z],material:'drainGrate',label:'hatch'});for(const [dx,dz] of [[-0.38,-0.38],[0.38,-0.38],[-0.38,0.38],[0.38,0.38]])m.box({size:[0.05,0.012,0.05],center:[x+dx,top+0.026,z+dz],material:'metalPanel',label:'hatch-bolt'});}
    else if(k<0.7){for(let j=0;j<10;j++)m.box({size:[0.05,0.02,1.4],center:[x-0.25+j*0.055,top+0.01,z],material:'drainGrate',label:'gutter-bar'});}
    else if(k<0.85){m.box({size:[0.35,0.12,0.25],center:[x,top+0.06,z],material:'substrate',label:'junction'});m.box({size:[0.06,0.03,0.02],center:[x+0.1,top+0.1,z+0.13],material:'markingStripe',label:'junction-tag'});}
    else m.box({size:[0.5+rr()*0.8,0.015,0.3+rr()*0.5],center:[x,top+0.008,z],material:'wetOverlay',label:'puddle'});
   }}
  // 排水格栅:沿两条长边,间距 drainGrateSpacing。
  if(p.drainGrateSpacing>0)for(let z=-L/2+p.drainGrateSpacing/2;z<L/2;z+=p.drainGrateSpacing)for(const s of [-1,1])
   m.box({size:[0.4,0.03,1.2],center:[s*(W/2-1),top+0.015,z],material:'drainGrate',label:'drain'});
  // 湿覆层:确定性地放在池洞四角外侧的零星斑块,总面积约为可铺面积 × coverage。
  const area=(W*L-cw*cl)*p.wetMaskCoverage,n=8,side=Math.sqrt(area/n);
  if(side>0.2)for(let i=0;i<n;i++){
   const ang=(i/n)*Math.PI*2+0.4,r=1+(i%3)*0.35;
   const cx=Math.cos(ang)*(cw/2+side*r),cz=Math.sin(ang)*(cl/2+side*r);
   if(Math.abs(cx)+side/2>W/2-0.5||Math.abs(cz)+side/2>L/2-0.5)continue;
   m.box({size:[side*(0.8+0.15*(i%2)),0.002,side*(0.6+0.2*(i%3))],center:[cx,top+0.001,cz],material:'wetOverlay',label:'wet'});
  }
 },
});
