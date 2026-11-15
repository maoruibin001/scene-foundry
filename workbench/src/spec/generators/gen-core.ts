/**
 * GEN-CORE-01(规格 FAM-CORE-SPHERE;叶资产 COR-001..004、COR-012):核心球。局部原点在球心。
 * panelFrequency>0(默认):Goldberg 多面体分区(测地球的对偶:12 个五边形 + 其余六边形),每块面板是独立的平板,
 * 按 seamWidth 留缝、抬出 panelRaise 厚度;缝里露出内壳,内壳即能量缝材质(概念图"黑色六边形光面球 + 冷光细缝")。
 * 当 coreScale<0.96 且 innerLattice=true 时,在外装甲板与内核之间以及内核内部构建多层测地肋环、南北极机械孔径环与中心反应堆芯,
 * 使宽装甲缝隙与 ClippingPlanes 剖切视口均展现真实多层内部反应堆结构。
 * panelFrequency=0:旧的经纬分区(每格收边成盖板),保留给需要经纬网格的规格。
 * 两道检修环带在 ±bandLatitude 纬度贴球面,带发光槽与灯钉;内约束场是略大的半透明外壳,可关。
 */
import {sel,type Model} from '@forgeax/engine/modeling';
import {defineGenerator,rad} from './kit.ts';
import {bar,rod} from './parts.ts';

const norm=(v:number[])=>{const l=Math.hypot(...v);return v.map(x=>x/l);};
/** 测地球(二十面体每边 f 等分)的对偶面:每个测地顶点周围的三角形中心按环序排成一个五/六边形,朝外逆时针。 */
export function goldbergFaces(f:number):number[][][]{
 const t=(1+Math.sqrt(5))/2,V=[[-1,t,0],[1,t,0],[-1,-t,0],[1,-t,0],[0,-1,t],[0,1,t],[0,-1,-t],[0,1,-t],[t,0,-1],[t,0,1],[-t,0,-1],[-t,0,1]].map(norm);
 const F=[[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]];
 const verts:number[][]=[],key=new Map<string,number>(),tris:number[][]=[];
 // 顶点按 1e-5 网格取整去重(toFixed 会把 -0/0 和舍入边界分成两个顶点,运行时之间结果还不一致)。
 const id=(p:number[])=>{const q=norm(p),k=q.map(x=>Math.round(x*1e5)+0).join(',');let i=key.get(k);if(i===undefined){i=verts.length;verts.push(q);key.set(k,i);}return i;};
 for(const [a,b,c] of F){const A=V[a]!,B=V[b]!,C=V[c]!,P=(i:number,j:number)=>id(A.map((x,k)=>x+(B[k]!-x)*i/f+(C[k]!-x)*j/f));
  for(let i=0;i<f;i++)for(let j=0;j<f-i;j++){tris.push([P(i,j),P(i+1,j),P(i,j+1)]);if(i+j<f-1)tris.push([P(i+1,j),P(i+1,j+1),P(i,j+1)]);}}
 const around=verts.map(()=>[] as number[]);tris.forEach((tr,i)=>tr.forEach(v=>around[v]!.push(i)));
 const center=(tr:number[])=>norm(tr.reduce((a,v)=>a.map((x,k)=>x+verts[v]![k]!),[0,0,0]));
 return verts.map((n,v)=>{
  const cs=around[v]!.map(i=>center(tris[i]!)),u=norm(Math.abs(n[1]!)<0.9?[n[2]!,0,-n[0]!]:[0,-n[2]!,n[1]!]),w=[n[1]!*u[2]!-n[2]!*u[1]!,n[2]!*u[0]!-n[0]!*u[2]!,n[0]!*u[1]!-n[1]!*u[0]!];
  return cs.map(c=>({c,a:Math.atan2(c.reduce((s,x,k)=>s+x*w[k]!,0),c.reduce((s,x,k)=>s+x*u[k]!,0))})).sort((x,y)=>x.a-y.a).map(x=>x.c);
 });
}
const rect=(r0:number,r1:number,y0:number,y1:number):[number,number][]=>[[r0,y0],[r1,y0],[r1,y1],[r0,y1],[r0,y0]];

function buildInnerReactorLattice(m:Model,r:number,coreScale:number):void{
 const rHull=r*coreScale;
 const gap=Math.max(0.015,r*0.985-rHull);
 const rRib=rHull+gap*0.52;
 const ribThick=Math.max(0.012,Math.min(gap*0.38,r*0.024));
 const ribHalfW=Math.max(0.016,r*0.022);

 // 1) 壳间正交测地大圆肋环(赤道 + 两条正交子午肋环,宽面板缝隙可直接窥见)
 const greatAxes:[string,'x'|'z',number][]=[
  ['eq','x',0],
  ['mer-x','z',90],
  ['mer-z','x',90],
 ];
 for(const [tag,axis,ang] of greatAxes){
  const lbl=`lat-rib-${tag}`;
  m.revolve({points:rect(rRib-ribThick*0.5,rRib+ribThick*0.5,-ribHalfW,ribHalfW),segments:64,material:'serviceBand',label:lbl});
  if(ang)m.rotate(sel.createdBy(lbl),axis,ang);
  const glbl=`lat-glow-${tag}`;
  m.revolve({points:rect(rRib+ribThick*0.5,rRib+ribThick*0.72,-ribHalfW*0.36,ribHalfW*0.36),segments:64,material:'serviceBandGlow',label:glbl});
  if(ang)m.rotate(sel.createdBy(glbl),axis,ang);
 }

 // 2) 南北双极机械孔径环(阶梯法兰环 + 发光内沿 + 径向锁销凸耳)
 for(const s of [-1,1] as const){
  const tag=s>0?'npole':'spole';
  const lat=rad(68);
  const py=s*rRib*Math.sin(lat);
  const pr=rRib*Math.cos(lat);
  const pThick=Math.max(0.014,ribThick*1.15);
  const pHalfH=Math.max(0.015,r*0.02);
  m.revolve({points:rect(Math.max(0.02,pr*0.72),pr+pThick,py-pHalfH,py+pHalfH),segments:48,material:'serviceBand',label:`aperture-${tag}`});
  m.revolve({points:rect(Math.max(0.015,pr*0.66),Math.max(0.022,pr*0.73),py-pHalfH*0.55,py+pHalfH*0.55),segments:48,material:'serviceBandGlow',label:`aperture-glow-${tag}`});
  for(let k=0;k<8;k++){
   const a=k*45,lug=`aperture-lug-${tag}-${k}`;
   m.box({size:[pThick*1.3,pHalfH*1.5,Math.max(0.018,r*0.018)],center:[pr+pThick*0.6,py,0],material:'vertexStud',label:lug});
   if(a)m.rotate(sel.createdBy(lug),'y',a);
  }
 }

 // 3) 内核剖切腔内部反应堆结构(中心高能约束核 + 轴向注入柱 + 双层磁约束环 + 径向支撑桁架)
 const rCore=Math.max(0.05,rHull*0.48);
 m.sphere({radius:rCore,widthSegments:32,heightSegments:16,material:'serviceBandGlow',label:'reactor-seed'});
 rod(m,[0,-rHull*0.94,0],[0,rHull*0.94,0],Math.max(0.016,rHull*0.075),'shell','reactor-axis',20);

 const rMag=rHull*0.74;
 const magT=Math.max(0.014,rHull*0.055);
 m.revolve({points:rect(rMag-magT,rMag+magT,-magT*0.9,magT*0.9),segments:56,material:'serviceBand',label:'reactor-mag-eq'});
 m.revolve({points:rect(rMag+magT,rMag+magT*1.28,-magT*0.38,magT*0.38),segments:56,material:'serviceBandGlow',label:'reactor-mag-glow'});

 for(let k=0;k<6;k++){
  const a=k*Math.PI/3;
  const strutR=Math.max(0.012,rHull*0.035);
  bar(
   m,
   [Math.cos(a)*rCore*0.92,0,Math.sin(a)*rCore*0.92],
   [Math.cos(a)*rRib*0.99,0,Math.sin(a)*rRib*0.99],
   strutR,
   strutR,
   'shell',
   `reactor-spoke-${k}`,
  );
 }
}

export const GEN_CORE=defineGenerator({
 id:'GEN-CORE-01',label:'核心球',assembly:true,
 params:{
  diameter:{type:'number',default:8,min:1,max:30},
  panelFrequency:{type:'int',default:5,min:0,max:10},
  panelColumns:{type:'int',default:16,min:6,max:48},
  panelRows:{type:'int',default:10,min:4,max:32},
  seamWidth:{type:'number',default:0.07,min:0.01,max:0.5},
  panelRaise:{type:'number',default:0.035,min:0,max:1},
  coreScale:{type:'number',default:0.995,min:0.3,max:0.999},
  innerLattice:{type:'bool',default:true},
  bandLatitude:{type:'number',default:28,min:0,max:70},
  bandWidth:{type:'number',default:0.32,min:0.05,max:2},
  studsPerBand:{type:'int',default:16,min:0,max:64},
  bands:{type:'int',default:2,min:0,max:2},
  field:{type:'bool',default:true},
  fieldScale:{type:'number',default:1.1,min:1.01,max:1.6},
 },
 slots:['shell','panel','panelSeam','serviceBand','serviceBandGlow','vertexStud','constraintField'],
 build(m:Model,p){
  const r=p.diameter/2;
  if(p.panelFrequency>0){
   // 内壳在缝里可见,用能量缝材质;面板是外层独立平板,厚度 panelRaise,缝宽 seamWidth。
   // coreScale<0.99 时内核缩进,缝里露出面板侧壁与纵深(装甲球"缝里透出内核光")。
   m.sphere({radius:r*p.coreScale,widthSegments:48,heightSegments:24,material:'panelSeam',label:'hull'});
   if(p.coreScale<0.96&&p.innerLattice){
    buildInnerReactorLattice(m,r,p.coreScale);
   }
   const t=Math.max(p.panelRaise,0.02);
   goldbergFaces(p.panelFrequency).forEach((face,i)=>{
    const c=norm(face.reduce((a,v)=>a.map((x,k)=>x+v[k]!),[0,0,0]));
    // 每块面板:顶点向面中心收 seamWidth/2,投到球面后再沿法向抬高,保持平板(用面中心法向)。
    const pts=face.map(v=>{const w=norm(v),d=w.map((x,k)=>x-c[k]!),l=Math.hypot(...d)*r,k=l>0?Math.max(0,1-p.seamWidth/2/l):1;return norm(c.map((x,j)=>x+d[j]!*k)).map(x=>x*r) as [number,number,number];});
    // 挤出后补反向底面,每块面板是封闭实体(开口薄壳会让引擎几何距离场超预算,GI 无法使用)。
    const label='panel'+i;m.polygon({points:pts,material:'panel',label});
    m.extrude(sel.createdBy(label),{distance:t,region:'merged',label:label+'x'});
    m.polygon({points:[...pts].reverse(),material:'panel',label:label+'b'});
   });
  }else{
   m.sphere({radius:r,widthSegments:p.panelColumns,heightSegments:p.panelRows,material:'panelSeam',label:'hull'});
   m.inset(sel.createdBy('hull'),{thickness:p.seamWidth,region:'perFace',label:'panels'});
   m.assign(sel.createdBy('panels','inner'),'panel');
   m.assign(sel.createdBy('panels','rim'),'panelSeam');
   if(p.panelRaise>0)m.extrude(sel.createdBy('panels','inner'),{distance:p.panelRaise,region:'perFace',label:'raised'});
   if(p.panelRaise>0)m.assign(sel.createdBy('raised','top'),'panel');
   // 内壳:抬起的盖板之间露出的底面,避免缝里透光。
   m.sphere({radius:r*0.985,widthSegments:p.panelColumns,heightSegments:p.panelRows,material:'shell',label:'inner'});
  }
  for(const s of ([-1,1] as const).slice(0,p.bands)){
   const lat=rad(p.bandLatitude),y=s*r*Math.sin(lat),rr=r*Math.cos(lat),hw=p.bandWidth/2,tag=s<0?'south':'north';
   m.revolve({points:rect(rr-0.02,rr+0.16,y-hw,y+hw),segments:96,label:`band-${tag}`,material:'serviceBand'});
   m.revolve({points:rect(rr+0.16,rr+0.19,y-hw*0.3,y+hw*0.3),segments:96,label:`glow-${tag}`,material:'serviceBandGlow'});
   for(let i=0;i<p.studsPerBand;i++){
    const a=i*360/p.studsPerBand,label=`stud-${tag}-${i}`;
    m.box({size:[0.06,hw*1.4,0.12],center:[rr+0.2,y,0],material:'vertexStud',label});
    if(a)m.rotate(sel.createdBy(label),'y',a);
   }
  }
  if(p.field)m.sphere({radius:r*p.fieldScale,widthSegments:48,heightSegments:24,material:'constraintField',label:'field'});
 },
});
