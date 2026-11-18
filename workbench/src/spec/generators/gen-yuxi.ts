/**
 * 榆溪坊古风构件包（题材泛化验证用）。
 *
 * 现有生成器库全部面向高科工业大厅，无法表达中式木构坊市。这里用一个带 kind 的
 * 参数化构件包补齐：民居/铺面、摊棚、石桥、河面、石板路、药园、堤坡、河埠、
 * 公井、院落、水闸小屋、田畦。全部只用建模内核的 box / rod / bar，与生成器库同源，
 * 同一份源码在 workbench 与 game 工程里运行。
 *
 * 坐标约定：生成器局部为引擎 Y-up。跨全场的折线（河、路、堤）由规格在 path 里
 * 直接给出已换算好的引擎坐标，实例放在原点；其余构件局部原点在脚底中心。
 */
import type {Model} from '@forgeax/engine/modeling';
import {defineGenerator} from './kit.ts';
import {bar,rod,type P3} from './parts.ts';

const box=(m:Model,size:[number,number,number],center:P3,material:string,label:string)=>{
 m.box({size,center,material,label});
};
const pointsOf=(path:number[]):P3[]=>{
 const out:P3[]=[];
 for(let i=0;i+2<path.length;i+=3)out.push([path[i]!,path[i+1]!,path[i+2]!]);
 return out;
};
/** 折线按固定步长细分，用轴对齐薄片串成连续带，避免依赖旋转原语的方向语义。 */
const tilesAlong=(pts:P3[],step:number):P3[]=>{
 const out:P3[]=[];
 for(let i=0;i+1<pts.length;i++){
  const a=pts[i]!,b=pts[i+1]!,len=Math.hypot(b[0]-a[0],b[1]-a[1],b[2]-a[2]),n=Math.max(1,Math.ceil(len/step));
  for(let k=0;k<n;k++)out.push([a[0]+(b[0]-a[0])*k/n,a[1]+(b[1]-a[1])*k/n,a[2]+(b[2]-a[2])*k/n]);
 }
 out.push(pts[pts.length-1]!);
 return out;
};
/** 阶梯式坡屋顶：递缩瓦片层，鸟瞰下可读出双坡轮廓，不依赖旋转 box。 */
const tiledRoof=(m:Model,w:number,d:number,h:number,baseY:number,material:string)=>{
 const layers=4,rise=Math.min(1.2,h*0.55);
 for(let i=0;i<layers;i++){
  const t=i/layers,ww=w*(1-t*0.72),dd=d*(1-t*0.72),t2=0.09;
  box(m,[ww,t2,dd],[0,baseY+rise*t,0],material,'tileRoof');
 }
};
const post=(m:Model,x:number,z:number,h:number,material='timber')=>box(m,[0.12,h,0.12],[x,h/2,z],material,'post');

export const GEN_YUXI_KIT=defineGenerator({
 id:'GEN-YUXI-KIT-01',label:'榆溪坊古风构件',
 params:{
  kind:{type:'int',default:0,min:0,max:11},
  size:{type:'vec3',default:[8,12,4],min:0.1,max:400},
  path:{type:'list',default:[0,0,0,20,0,0,40,0,0],min:-400,max:400,minLength:6,maxLength:96,stride:3},
  width:{type:'number',default:6,min:0.1,max:120},
  count:{type:'int',default:1,min:1,max:24},
  style:{type:'int',default:0,min:0,max:2},
 },
 slots:['tileRoof','timber','plaster','stone','water','soil','crop','bridge','rail','stall','well','field','pump','pipe','bank','step','gate','ward'],
 build(m:Model,p){
  const [w,d,h]=p.size,pts=pointsOf(p.path as number[]),kind=p.kind;
  if(kind===0){ // 青瓦木构民居 / 铺面
   box(m,[w,h*0.82,d],[0,h*0.41,0],'plaster','wall');
   tiledRoof(m,w*1.08,d*1.08,h,h*0.84,'tileRoof');
   for(const x of [-w/2+0.08,w/2-0.08])post(m,x,-d/2-0.05,h*0.86);
   box(m,[w*0.28,h*0.5,0.06],[0,h*0.25,d/2+0.035],'timber','door');
   box(m,[w*0.5,0.12,0.08],[0,h*0.72,d/2+0.06],'timber','signboard');
   for(const x of [-w*0.3,w*0.3])box(m,[0.7,0.55,0.04],[x,h*0.5,d/2+0.04],'timber','window');
  }else if(kind===1){ // 敞口摊棚 / 旧器货棚
   for(const x of [-w/2,w/2])for(const z of [-d/2,d/2])post(m,x,z,h);
   box(m,[w*1.08,0.12,d*1.08],[0,h,0],'stall','canopy');
   tiledRoof(m,w*1.02,d*1.02,h,h+0.06,'tileRoof');
   for(let i=0;i<Math.min(p.count,8);i++){
    const z=-d/2+1+(d-2)*i/Math.max(1,Math.min(p.count,8)-1);
    box(m,[w*0.7,0.12,0.9],[0,0.7,z],'timber','stallTable');
    box(m,[0.5,0.35,0.5],[-w*0.2,0.95,z],'stall','goods');
   }
  }else if(kind===2){ // 石桥：桥面 + 桥墩 + 栏杆
   const span=Math.max(w,6),deck=Math.max(d,4),y=p.style===0?1.6:0.9;
   box(m,[span,0.35,deck],[0,y,0],'bridge','deck');
   for(let i=0;i<3;i++)box(m,[0.9,y-0.1,deck*0.9],[-(i-1)*span*0.3,(y-0.1)/2,0],'bridge','pier');
   for(const z of [-deck/2,deck/2]){
    for(let i=0;i<=4;i++)post(m,-span/2+span*i/4,z,y+0.55,'bridge');
    bar(m,[-span/2,y+0.62,z],[span/2,y+0.62,z],0.09,0.09,'rail','rail');
   }
  }else if(kind===3){ // 河面：沿中心线铺水面薄片
   const tiles=tilesAlong(pts,Math.max(3,p.width*0.35));
   for(const c of tiles)box(m,[p.width,0.06,p.width],[c[0],c[1]-0.02,c[2]],'water','river');
  }else if(kind===4){ // 石板路
   const tiles=tilesAlong(pts,Math.max(2,p.width*0.5));
   for(const c of tiles)box(m,[p.width,0.1,p.width],[c[0],c[1]+0.03,c[2]],'stone','road');
  }else if(kind===5){ // 药园：三条高畦、东侧沟、集水坑、泵棚、越堤铜管
   box(m,[w,0.08,d],[0,0.04,0],'soil','gardenBed');
   for(let i=0;i<3;i++){
    const x=-w/2+w*0.16+i*w*0.27;
    box(m,[w*0.2,0.18,d*0.72],[x,0.16,0],'soil','ridge');
    box(m,[w*0.18,0.05,d*0.68],[x,0.28,0],'crop','ginseng');
   }
   box(m,[0.35,0.05,d*0.8],[w*0.36,0.1,0],'water','ditch');
   box(m,[1.1,0.25,1.1],[w*0.38,-0.12,-d*0.36],'water','sump');
   box(m,[2.2,1.8,2.2],[w*0.34,0.9,d*0.33],'timber','pumpShed');
   tiledRoof(m,2.5,2.5,1.8,1.8,'tileRoof');
   const pipe:[P3,P3,P3]=[[w*0.34,1.2,d*0.33],[w*0.5,2.2,d*0.33],[w*0.62,1.35,d*0.33]];
   rod(m,pipe[0],pipe[1],0.09,'pipe','leveePipe',10);
   rod(m,pipe[1],pipe[2],0.09,'pipe','outletPipe',10);
  }else if(kind===6){ // 堤坡：沿折线堆土坡
   const tiles=tilesAlong(pts,Math.max(3,p.width*0.5));
   for(const c of tiles){
    box(m,[p.width,0.5,p.width*0.8],[c[0],c[1]+0.25,c[2]],'bank','levee');
    box(m,[p.width*0.55,0.35,p.width*0.55],[c[0],c[1]+0.67,c[2]],'bank','leveeCrest');
   }
  }else if(kind===7){ // 河埠：顺岸石阶 + 系缆桩
   for(let i=0;i<4;i++)box(m,[w,0.22,d*0.22],[0,0.11+i*0.22,-d/2+d*0.11+i*d*0.22],'step','quayStep');
   for(let i=0;i<3;i++)rod(m,[-w*0.35+i*w*0.35,0.9,-d*0.42],[-w*0.35+i*w*0.35,1.5,-d*0.42],0.1,'stone','bollard',8);
  }else if(kind===8){ // 坊心公井
   for(const [dx,dz] of [[-0.6,0],[0.6,0],[0,-0.6],[0,0.6]] as [number,number][])box(m,[0.25,0.9,0.25],[dx,0.45,dz],'well','wellWall');
   box(m,[1.5,0.12,1.5],[0,0.96,0],'well','wellCap');
   box(m,[0.9,0.04,0.9],[0,0.05,0],'water','wellWater');
   for(const x of [-0.8,0.8])post(m,x,0,1.8);
   bar(m,[-0.8,1.8,0],[0.8,1.8,0],0.1,0.1,'timber','windlass');
  }else if(kind===9){ // 院落：围墙 + 门 + 草料棚
   for(const z of [-d/2,d/2])box(m,[w,1.4,0.25],[0,0.7,z],'plaster','wall');
   for(const x of [-w/2,w/2])box(m,[0.25,1.4,d],[x,0.7,0],'plaster','wall');
   box(m,[2.2,2,0.2],[0,1,-d/2],'gate','gate');
   box(m,[w*0.45,0.12,d*0.35],[-w*0.2,1.6,-d*0.2],'stall','shedRoof');
   for(const x of [-w*0.4,-w*0.05])for(const z of [-d*0.35,-d*0.05])post(m,x,z,1.6);
  }else if(kind===10){ // 东溪取水闸 / 旧水廊检修口小屋
   box(m,[w,h,d],[0,h/2,0],'stone','sluiceHouse');
   tiledRoof(m,w*1.1,d*1.1,h,h,'tileRoof');
   box(m,[w*0.5,h*0.6,0.12],[0,h*0.35,d/2+0.06],'gate','sluiceGate');
   box(m,[w*1.3,0.1,d*1.6],[0,-0.05,d*0.7],'water','channel');
  }else{ // 农田 / 苗圃：平行畦
   box(m,[w,0.06,d],[0,0.03,0],'field','fieldSoil');
   const rows=Math.min(p.count,16);
   for(let i=0;i<rows;i++){
    const z=-d/2+d*(i+0.5)/rows;
    box(m,[w*0.9,0.12,d/rows*0.55],[0,0.12,z],'crop','fieldRow');
   }
  }
 },
});
