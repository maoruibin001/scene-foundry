/**
 * 程序化表面贴图(确定性,无外部图片):每种纹样生成一组 法线 / 金属粗糙度(G=粗糙度,B=金属度)/ 底色调制 贴图。
 * - panel   墙面铆接钢板:矩形板缝 + 角部铆钉 + 竖向锈水流痕
 * - plate   地面金属板:方板缝 + 菱形防滑纹 + 水渍斑块(粗糙度低处即湿)
 * - grate   格栅:密集方孔
 * - concrete 混凝土:颗粒与斑驳
 * 贴图值是因子的乘数(glTF 语义):底色 0.55..1、粗糙度 0.35..1,材质标量决定整体量级。
 */
export type SurfacePattern='panel'|'plate'|'grate'|'concrete';
export const SURFACE_PATTERNS:readonly SurfacePattern[]=['panel','plate','grate','concrete'];
export type SurfaceMaps={size:number;normal:Uint8Array;metallicRoughness:Uint8Array;baseColor:Uint8Array};

const hash=(x:number,y:number,s:number)=>{let h=(x*374761393+y*668265263+s*982451653)|0;h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967295;};
/** 可平铺的值噪声:格点按周期取模。 */
function noise(u:number,v:number,cells:number,seed:number){
 const x=u*cells,y=v*cells,x0=Math.floor(x),y0=Math.floor(y),fx=x-x0,fy=y-y0,sx=fx*fx*(3-2*fx),sy=fy*fy*(3-2*fy);
 const g=(i:number,j:number)=>hash(((i%cells)+cells)%cells,((j%cells)+cells)%cells,seed);
 return (g(x0,y0)*(1-sx)+g(x0+1,y0)*sx)*(1-sy)+(g(x0,y0+1)*(1-sx)+g(x0+1,y0+1)*sx)*sy;
}
const fbm=(u:number,v:number,seed:number)=>noise(u,v,4,seed)*0.5+noise(u,v,8,seed+1)*0.3+noise(u,v,16,seed+2)*0.2;
const smooth=(e0:number,e1:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-e0)/(e1-e0)));return t*t*(3-2*t);};

/** 每像素返回 高度(0..1)、粗糙度乘数、底色乘数。 */
function sample(p:SurfacePattern,u:number,v:number):[number,number,number]{
 const grime=fbm(u,v,7);
 if(p==='panel'){
  // 一个贴图周期 = 2×1 块板;板缝 1.2%,四角铆钉,竖向锈痕从板上沿往下流。
  const pu=(u*2)%1,pv=v%1,seam=Math.min(pu,1-pu,pv*2,(1-pv)*2);
  let h=smooth(0.004,0.014,seam)*0.6+0.4;
  for(const cu of [0.04,0.96])for(const cv of [0.08,0.92]){const d=Math.hypot((pu-cu)*2,(pv-cv)*1);if(d<0.025)h=Math.max(h,1-d/0.025*0.4);}
  const streak=noise(u*6,0,24,3)*smooth(0.3,1,1-pv)*0.6;
  return [h,0.55+0.45*grime,1-0.35*streak-0.15*(1-grime)];
 }
 if(p==='plate'){
  // 4×4 方板,板内菱形防滑凸纹;大块水渍斑(低粗糙度)。
  const pu=(u*4)%1,pv=(v*4)%1,seam=Math.min(pu,1-pu,pv,1-pv),dia=Math.abs(((u*48+v*48)%1)-0.5)<0.12&&Math.abs(((u*48-v*48+100)%1)-0.5)<0.35?0.08:0;
  const h=smooth(0.006,0.02,seam)*0.7+0.3+dia,wet=smooth(0.55,0.68,fbm(u,v,21));
  return [h,1-0.62*wet,1-0.25*wet-0.12*(1-grime)];
 }
 if(p==='grate'){
  const gu=(u*24)%1,gv=(v*24)%1,hole=gu>0.18&&gu<0.82&&gv>0.18&&gv<0.82;
  return [hole?0.1:1,0.7+0.3*grime,hole?0.35:1-0.2*(1-grime)];
 }
 const pits=hash(Math.floor(u*256),Math.floor(v*256),9)>0.92?0.85:1;
 return [0.5+0.3*fbm(u,v,13)*pits,0.8+0.2*grime,0.75+0.25*grime*pits];
}

export function surfaceMaps(p:SurfacePattern,size=256):SurfaceMaps{
 const H=new Float32Array(size*size),normal=new Uint8Array(size*size*4),mr=new Uint8Array(size*size*4),bc=new Uint8Array(size*size*4),strength=p==='concrete'?2:6;
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){const [h,r,c]=sample(p,x/size,y/size),i=y*size+x;H[i]=h;
  mr[i*4]=255;mr[i*4+1]=Math.round(255*Math.max(0,Math.min(1,r)));mr[i*4+2]=255;mr[i*4+3]=255;
  const g=Math.round(255*Math.max(0,Math.min(1,c)));bc[i*4]=g;bc[i*4+1]=g;bc[i*4+2]=g;bc[i*4+3]=255;}
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const at=(xx:number,yy:number)=>H[((yy+size)%size)*size+((xx+size)%size)];
  const dx=(at(x+1,y)-at(x-1,y))*strength,dy=(at(x,y+1)-at(x,y-1))*strength,l=Math.hypot(dx,dy,1),i=(y*size+x)*4;
  normal[i]=Math.round((-dx/l*0.5+0.5)*255);normal[i+1]=Math.round((-dy/l*0.5+0.5)*255);normal[i+2]=Math.round((1/l*0.5+0.5)*255);normal[i+3]=255;}
 return {size,normal,metallicRoughness:mr,baseColor:bc};
}
