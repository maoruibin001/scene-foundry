/**
 * 工业 CAD Trim Sheet 与标准机械件工具包:
 * 1) 基于 @forgeax/engine/modeling 的 trimSheet + stamp + bakeTrimSheet 生成字节确定性科幻工业 Trim 贴图并内存缓存;
 * 2) 基于 recipes (hexBolt / hydraulicCylinder / clevis) 与 pipeNetwork 向 Model 装配标准紧固件、液压作动筒与圆角弯管。
 */
import {
 bakeTrimSheet,
 metric,
 model,
 recipes,
 sel,
 stamp,
 trimSheet,
 type BakeSlot,
 type MetricSize,
 type Model,
 type TrimSheet,
} from '@forgeax/engine/modeling';
import type {Result} from '@forgeax/engine/types';
import {pipeRun,rod,type P3} from './parts.ts';
import type {SurfaceMaps} from './textures.ts';

let partSerial=0;
const nextLabel=(prefix:string)=>`${prefix}-${++partSerial}`;

function unwrap<T>(res:Result<T,{code?:string;expected?:string;hint?:string}>,ctx:string):T{
 if(!res.ok)throw Error(`TRIM_KIT_FAILED(${ctx}): ${res.error.code??'error'} ${res.error.expected??''} ${res.error.hint??''}`);
 return res.value;
}

const clamp01=(v:number)=>Math.max(0,Math.min(1,v));
const byte=(v:number)=>Math.max(0,Math.min(255,Math.round(v)));

const TRIM_SLOTS:Readonly<Record<string,BakeSlot>>={
 '*':{baseColor:[0.88,0.9,0.92,1],roughness:0.65,metallic:1},
 'trim-base':{baseColor:[0.88,0.9,0.92,1],roughness:0.65,metallic:1},
 groove:{baseColor:[0.48,0.5,0.55,1],roughness:0.86,metallic:0.85},
 weld:{baseColor:[0.76,0.79,0.83,1],roughness:0.78,metallic:1},
 tread:{baseColor:[0.94,0.95,0.97,1],roughness:0.46,metallic:1},
 hole:{baseColor:[0.24,0.26,0.3,1],roughness:0.94,metallic:0.55},
 bolt:{baseColor:[0.95,0.96,0.98,1],roughness:0.42,metallic:1},
 rivet:{baseColor:[0.92,0.94,0.96,1],roughness:0.45,metallic:1},
 text:{baseColor:[0.58,0.62,0.68,1],roughness:0.82,metallic:0.9},
};

const sheetCache=new Map<number,TrimSheet>();
const mapsCache=new Map<number,SurfaceMaps>();
const boltSnapCache=new Map<string,Uint8Array>();
const orientedBoltCache=new Map<string,Uint8Array>();
const clevisSnapCache=new Map<string,{snap:Uint8Array;hole:number;slot:number;wall:number}>();

/** 清空 Trim Sheet 与标准件快照缓存(供确定性回归测试使用)。 */
export function clearScifiTrimCache():void{
 sheetCache.clear();
 mapsCache.clear();
}

/**
 * 构建并缓存科幻工业 Trim Sheet 布局:
 * 包含 4 条横向连续平铺带(groove / weldBead / treadPlate / perforation)与 3 个高密构件格(boltHex / rivet / text)。
 */
export function getScifiTrimSheet(size=512):TrimSheet{
 if(!Number.isInteger(size)||size<32||size>4096)throw Error(`TRIM_KIT_INVALID_SIZE: size=${size} 须为 32..4096 整数`);
 const cached=sheetCache.get(size);
 if(cached)return cached;

 const grooveMod=unwrap(stamp.groove({width:0.016,depth:0.008,profile:'v',band:0.064,length:0.64,material:'groove'}),'stamp.groove');
 const weldMod=unwrap(stamp.weldBead({width:0.024,height:0.006,band:0.064,ripple:{pitch:0.016,depth:0.22},length:0.64,material:'weld'}),'stamp.weldBead');
 const treadMod=unwrap(stamp.treadPlate({pitch:0.08,height:0.005,rows:2,length:0.64,material:'tread'}),'stamp.treadPlate');
 const perfMod=unwrap(stamp.perforation({diameter:0.022,pitch:0.04,depth:0.012,pattern:'staggered',rows:3,length:0.64,material:'hole'}),'stamp.perforation');
 const boltMod=unwrap(stamp.boltHex({across:0.024,height:0.01,chamfer:0.002,washer:{diameter:0.036,height:0.003},margin:0.15,material:'bolt'}),'stamp.boltHex');
 const rivetMod=unwrap(stamp.rivet({diameter:0.02,height:0.008,margin:0.15,material:'rivet'}),'stamp.rivet');
 const textMod=unwrap(stamp.text({text:'SF-01',height:0.028,depth:-0.004,margin:0.25,material:'text'}),'stamp.text');

 const block=size%4===0?4:1;
 const padding=Math.min(4,Math.floor(size/8)*2);
 const sheet=unwrap(
  trimSheet({
   key:'scifi-industrial-trim',
   size,
   density:Math.max(64,size*1.25),
   block,
   padding,
   inset:0.5,
   fill:{grow:1.5},
   modules:[
    {id:'panel-groove',...grooveMod},
    {id:'weld-seam',...weldMod},
    {id:'tread-strip',...treadMod},
    {id:'vent-perf',...perfMod},
    {id:'hex-bolt',...boltMod},
    {id:'dome-rivet',...rivetMod},
    {id:'serial-tag',...textMod},
   ],
  }),
  'trimSheet',
 );
 sheetCache.set(size,sheet);
 return sheet;
}

/**
 * 烘焙并缓存科幻工业 Trim Sheet 到 SurfaceMaps(RGBA8):
 * - normal: 切线空间法线 RGBA8
 * - metallicRoughness: R=AO, G=Roughness(由槽粗糙度+曲率磨损+AO 调制), B=Metallic, A=255
 * - baseColor: Albedo × AO(含凸脊微提亮), A=255
 */
export function bakeScifiTrimMaps(size=512):SurfaceMaps{
 const cached=mapsCache.get(size);
 if(cached)return cached;

 const sheet=getScifiTrimSheet(size);
 const baked=unwrap(
  bakeTrimSheet(sheet,{
   maps:['normal','ao','curvature','baseColor'],
   samples:1,
   mips:false,
   slots:TRIM_SLOTS,
  }),
  'bakeTrimSheet',
 );
 const texLen=size*size*4;
 const normalSrc=baked.textures.normal?.data;
 const aoSrc=baked.textures.ao?.data;
 const curvSrc=baked.textures.curvature?.data;
 const bcSrc=baked.textures.baseColor?.data;
 if(!normalSrc||!aoSrc||!curvSrc||!bcSrc)throw Error('TRIM_KIT_FAILED(bakeTrimSheet): 缺少烘焙通道输出');

 const normal=new Uint8Array(normalSrc.subarray(0,texLen));
 const metallicRoughness=new Uint8Array(texLen);
 const baseColor=new Uint8Array(texLen);

 for(let o=0;o<texLen;o+=4){
  const aoByte=aoSrc[o]!;
  const ao=aoByte/255;
  const curv=curvSrc[o]!/255;
  const hasSlot=bcSrc[o+3]!>0;
  const r=hasSlot?bcSrc[o]!/255:0.88;
  const g=hasSlot?bcSrc[o+1]!/255:0.9;
  const b=hasSlot?bcSrc[o+2]!/255:0.92;
  const lum=(r+g+b)/3;

  const baseRough=lum<0.42?0.9:lum>0.92?0.44:lum<0.68?0.8:0.65;
  const rough=clamp01(baseRough-0.28*(curv-0.5)+0.24*(1-ao));
  const metalByte=lum<0.42?160:255;

  metallicRoughness[o]=aoByte;
  metallicRoughness[o+1]=byte(rough*255);
  metallicRoughness[o+2]=metalByte;
  metallicRoughness[o+3]=255;

  const aoMod=0.45+0.55*ao;
  const edgeLift=1+0.12*Math.max(0,curv-0.5)*2;
  baseColor[o]=byte(r*aoMod*edgeLift*255);
  baseColor[o+1]=byte(g*aoMod*edgeLift*255);
  baseColor[o+2]=byte(b*aoMod*edgeLift*255);
  baseColor[o+3]=255;
 }

 const out:SurfaceMaps={size,normal,metallicRoughness,baseColor};
 mapsCache.set(size,out);
 return out;
}

/** 将局部 +Y 轴对齐到目标方向 dir(围绕原点旋转)。 */
function orientPlusY(m:Model,dir:P3):void{
 const len=Math.hypot(dir[0],dir[1],dir[2]);
 if(len<1e-8)return;
 const nx=dir[0]/len,ny=dir[1]/len,nz=dir[2]/len;
 const theta=Math.acos(Math.max(-1,Math.min(1,ny)))*180/Math.PI;
 const beta=Math.atan2(-nz,nx)*180/Math.PI;
 if(Math.abs(theta)>1e-6)m.rotate(sel.all(),'z',-theta,[0,0,0]);
 if(Math.abs(theta)>1e-6&&Math.abs(theta-180)>1e-6&&Math.abs(beta)>1e-6)m.rotate(sel.all(),'y',beta,[0,0,0]);
}

function getHexBoltSnapshot(size:MetricSize,length:number,thread:number,segments:number):Uint8Array{
 const key=`${size}|${length.toFixed(5)}|${thread.toFixed(5)}|${segments}`;
 const hit=boltSnapCache.get(key);
 if(hit)return hit;
 const part=unwrap(recipes.hexBolt({name:'bolt',size,length,thread,segments}),'recipes.hexBolt');
 const snap=part.model.snapshot();
 boltSnapCache.set(key,snap);
 return snap;
}

export interface BoltPlacement{
 readonly position:P3;
 /** 螺帽朝外法向(默认 +Y);螺杆沿 -normal 伸入构件。 */
 readonly normal?:P3;
 readonly scale?:number;
}

export interface AppendHexBoltsOptions{
 readonly size?:MetricSize;
 readonly length?:number;
 readonly thread?:number;
 readonly segments?:number;
 readonly material:string;
 readonly scale?:number;
}

/** 批量装配真实 ISO 六角螺栓(recipes.hexBolt,按朝向与材质缓存快照并单次批量合并)。 */
export function appendHexBolts(m:Model,placements:readonly BoltPlacement[],options:AppendHexBoltsOptions):void{
 if(placements.length===0)return;
 const size=options.size??'M16';
 const d=metric(size).d;
 const length=options.length??d*2;
 const thread=options.thread??0;
 const segments=options.segments??12;
 const baseKey=`${size}|${length.toFixed(5)}|${thread.toFixed(5)}|${segments}`;
 const snap=getHexBoltSnapshot(size,length,thread,segments);

 const batch=model();
 for(const p of placements){
  const s=(p.scale??1)*(options.scale??1);
  const n=p.normal??[0,1,0];
  const nLen=Math.hypot(n[0],n[1],n[2])||1;
  const nx=n[0]/nLen,ny=n[1]/nLen,nz=n[2]/nLen;
  const oKey=`${baseKey}|${s.toFixed(4)}|${nx.toFixed(4)},${ny.toFixed(4)},${nz.toFixed(4)}|${options.material}`;
  let oriented=orientedBoltCache.get(oKey);
  if(!oriented){
   const sub=model();
   sub.append(snap);
   if(Math.abs(s-1)>1e-6)sub.scale(sel.all(),[s,s,s],[0,0,0]);
   orientPlusY(sub,[nx,ny,nz]);
   sub.assign(sel.all(),options.material);
   oriented=sub.snapshot();
   orientedBoltCache.set(oKey,oriented);
  }
  batch.append(oriented,{translate:p.position});
 }
 m.append(batch,{label:nextLabel('hex-bolts')});
}

export interface AppendClevisOptions{
 /** 销孔中心世界/局部位置。 */
 readonly position:P3;
 /** U 形耳板开口指向(默认 +Y)。 */
 readonly jawDir?:P3;
 /** 销轴孔公称直径(0.003..0.18m)。 */
 readonly pinDiameter:number;
 readonly material:string;
 readonly pinMaterial?:string;
}

/** 装配真实 U 形耳座(recipes.clevis)及可选横向穿销。 */
export function appendClevisMount(m:Model,options:AppendClevisOptions):void{
 const d=Math.max(0.004,Math.min(0.16,options.pinDiameter));
 const key=d.toFixed(5);
 let cached=clevisSnapCache.get(key);
 if(!cached){
  const part=unwrap(recipes.clevis({name:'clevis',d}),'recipes.clevis');
  cached={snap:part.model.snapshot(),hole:part.dimensions.hole!,slot:part.dimensions.slot!,wall:part.dimensions.wall!};
  clevisSnapCache.set(key,cached);
 }
 // recipes.clevis 默认销轴沿 +Y、耳口朝 +X;先绕 Z 转 +90° 再绕 Y 转 -90°,使耳口朝 +Y、销轴沿 +Z(与 hydraulicCylinder 耳孔一致)。
 const sub=model();
 sub.append(cached.snap);
 sub.rotate(sel.all(),'z',90,[0,0,0]);
 sub.rotate(sel.all(),'y',-90,[0,0,0]);
 orientPlusY(sub,options.jawDir??[0,1,0]);
 sub.assign(sel.all(),options.material);
 m.append(sub,{translate:options.position,label:nextLabel('clevis')});

 if(options.pinMaterial){
  const jaw=options.jawDir??[0,1,0];
  // 垂直于 jawDir 的横向销轴方向(优先沿 Z 或 X)
  const ref:P3=Math.abs(jaw[2])<0.85?[0,0,1]:[1,0,0];
  const ax:P3=[
   jaw[1]*ref[2]-jaw[2]*ref[1],
   jaw[2]*ref[0]-jaw[0]*ref[2],
   jaw[0]*ref[1]-jaw[1]*ref[0],
  ];
  const al=Math.hypot(ax[0],ax[1],ax[2])||1;
  const half=(cached.slot/2+cached.wall)*1.18;
  const u:P3=[ax[0]/al*half,ax[1]/al*half,ax[2]/al*half];
  const p=options.position;
  rod(m,[p[0]-u[0],p[1]-u[1],p[2]-u[2]],[p[0]+u[0],p[1]+u[1],p[2]+u[2]],d*0.48,options.pinMaterial,'clevis-pin',16);
 }
}

export interface AppendHydraulicStrutOptions{
 /** 缸底耳孔中心。 */
 readonly from:P3;
 /** 活塞杆端耳孔中心。 */
 readonly to:P3;
 /** 期望缸径(自动夹取到合法行程比区间 0.012..0.28m)。 */
 readonly bore?:number;
 readonly extension?:number;
 readonly segments?:number;
 readonly housingMaterial:string;
 readonly pistonMaterial:string;
 readonly mountMaterial?:string;
 /** 是否在两端自动补齐配套 recipes.clevis 支耳与销轴。 */
 readonly withClevis?:boolean;
}

/**
 * 在两点之间精确装配真实双作用液压缸(recipes.hydraulicCylinder):
 * 自动反算冲程使两端耳孔间距 pinToPin 精确等于 |to - from|,绝无拉伸变形。
 */
export function appendHydraulicStrut(m:Model,options:AppendHydraulicStrutOptions):void{
 const dx=options.to[0]-options.from[0];
 const dy=options.to[1]-options.from[1];
 const dz=options.to[2]-options.from[2];
 const L=Math.hypot(dx,dy,dz);
 if(L<0.08)return;

 const ext=Math.max(0.05,Math.min(0.95,options.extension??0.45));
 // pinToPin = 2.538 * bore + (1 + ext) * stroke,且 stroke 须在 [bore, 20 * bore]
 const minBore=Math.max(0.012,L/(2.538+19*(1+ext)));
 const maxBore=Math.min(0.28,L/(2.538+1.15*(1+ext)));
 const bore=Math.max(minBore,Math.min(maxBore,options.bore??L*0.13));
 const rodDia=bore*0.5;
 const stroke=Math.max(bore*1.05,Math.min(bore*19.5,(L-2.538*bore)/(1+ext)));
 const segments=options.segments??20;

 const part=unwrap(
  recipes.hydraulicCylinder({name:'hyd',bore,rod:rodDia,stroke,extension:ext,segments}),
  'recipes.hydraulicCylinder',
 );
 const sub=part.model;
 const baseEye=part.anchors.baseEye!;
 const mountMat=options.mountMaterial??options.housingMaterial;

 sub.assign(sel.createdBy('hyd-barrel'),options.housingMaterial);
 sub.assign(sel.createdBy('hyd-rod'),options.pistonMaterial);
 sub.assign(sel.createdBy('hyd-eye').or(sel.createdBy('hyd-rod-eye')),mountMat);
 sub.translate(sel.all(),[-baseEye[0],-baseEye[1],-baseEye[2]]);
 orientPlusY(sub,[dx,dy,dz]);
 m.append(sub,{translate:options.from,label:nextLabel('hyd-strut')});

 if(options.withClevis){
  const pinDia=part.dimensions.pin!;
  const dir:P3=[dx/L,dy/L,dz/L];
  appendClevisMount(m,{position:options.from,jawDir:dir,pinDiameter:pinDia,material:options.housingMaterial,pinMaterial:mountMat});
  appendClevisMount(m,{position:options.to,jawDir:[-dir[0],-dir[1],-dir[2]],pinDiameter:pinDia,material:options.housingMaterial,pinMaterial:mountMat});
 }
}

/**
 * 基于 m.pipeNetwork 生成带圆弧弯头与端头法兰箍的工业管路;
 * 若路径过短、共线退化或夹角过急被内核拒绝,自动无损回退到 polyRod。返回是否命中真实 pipeNetwork。
 */
export function truePipeRun(m:Model,pts:P3[],r:number,material:string,joint=material,segments=12):boolean{
 return pipeRun(m,pts,r,material,joint,segments);
}
