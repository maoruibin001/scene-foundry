/**
 * Bun Worker 线程:并行执行程序化网格生成(runGenerator)、程序化表面贴图(surfaceMaps)与等轴 PNG 缩略图光栅化。
 * 所有大体积二进制结果装入独立 ArrayBuffer,通过 postMessage transfer list 零拷贝回传协调线程。
 */
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import type {MeshAsset} from '@forgeax/engine/types';
import {GENERATORS} from './generators/index';
import {runGenerator,type ParamValue} from './generators/kit';
import {surfaceMaps,type SurfacePattern} from './generators/textures';

declare var self:Worker;

type CookedDType='f32'|'u16'|'u32'|'u8';
type CookedSlice={dtype:CookedDType;byteOffset:number;length:number};
type CookedMeshMeta={
 byteLength:number;
 sha256:string;
 vertices:CookedSlice;
 indices:CookedSlice;
 aabb:CookedSlice;
 attributes:Record<string,CookedSlice>;
 submeshes:unknown[];
 materialSlots:{slotName:string}[];
};

type SubmeshDraw={start:number;count:number;c:number[];e:number;skip:boolean};
type SlotColor={c:number[];e:number;skip:boolean};

export type WorkerRequest=
 |{id:number;kind:'mesh';meshKey:string;generatorId:string;params:Record<string,ParamValue>}
 |{id:number;kind:'surface';pattern:string;size:number}
 |{id:number;kind:'preview';position:Float32Array;indices:Uint32Array|Uint16Array;drawList:SubmeshDraw[]}
 |{id:number;kind:'preview-generate';meshKey:string;generatorId:string;params:Record<string,ParamValue>;slotColors:Record<string,SlotColor>;defaultColor:SlotColor};

export type WorkerResponse=
 |{kind:'ready'}
 |{id:number;ok:true;kind:'mesh';ab:ArrayBuffer;meta:CookedMeshMeta;rawAabb:number[];triangles:number}
 |{id:number;ok:true;kind:'surface';ab:ArrayBuffer;size:number;sha256:string}
 |{id:number;ok:true;kind:'preview';ab:ArrayBuffer}
 |{id:number;ok:false;error:string};

const W=360,H=270;
const CRC_TABLE=new Uint32Array(256).map((_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});

function encodePng(w:number,h:number,rgb:Uint8Array):ArrayBuffer{
 const crc=(b:Uint8Array)=>{let c=0xffffffff;for(const x of b)c=CRC_TABLE[(c^x)&255]!^(c>>>8);return (c^0xffffffff)>>>0;};
 const chunk=(t:string,d:Uint8Array)=>{
  const o=new Uint8Array(12+d.length),v=new DataView(o.buffer);
  v.setUint32(0,d.length);
  o.set(new TextEncoder().encode(t),4);
  o.set(d,8);
  v.setUint32(8+d.length,crc(o.subarray(4,8+d.length)));
  return o;
 };
 const raw=new Uint8Array(h*(w*3+1));
 for(let y=0;y<h;y++){raw[y*(w*3+1)]=0;raw.set(rgb.subarray(y*w*3,(y+1)*w*3),y*(w*3+1)+1);}
 const ihdr=new Uint8Array(13),v=new DataView(ihdr.buffer);
 v.setUint32(0,w);v.setUint32(4,h);ihdr[8]=8;ihdr[9]=2;
 const parts=[new Uint8Array([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',new Uint8Array())];
 const total=parts.reduce((n,p)=>n+p.length,0);
 const ab=new ArrayBuffer(total),out=new Uint8Array(ab);
 let o=0;for(const p of parts){out.set(p,o);o+=p.length;}
 return ab;
}

function rasterize(pos:Float32Array,idx:Uint32Array|Uint16Array,drawList:SubmeshDraw[]):ArrayBuffer{
 const az=Math.PI*0.25,el=0.55,ca=Math.cos(az),sa=Math.sin(az),ce=Math.cos(el),se=Math.sin(el);
 const P=(i:number)=>{const x=pos[i*3]!,y=pos[i*3+1]!,z=pos[i*3+2]!;const rx=x*ca-z*sa,rz=x*sa+z*ca;return [rx,y*ce-rz*se,y*se+rz*ce];};
 let mnx=Infinity,mny=Infinity,mxx=-Infinity,mxy=-Infinity;
 for(let i=0;i<pos.length/3;i++){const p=P(i);mnx=Math.min(mnx,p[0]!);mxx=Math.max(mxx,p[0]!);mny=Math.min(mny,p[1]!);mxy=Math.max(mxy,p[1]!);}
 const s=0.9*Math.min(W/(mxx-mnx||1),H/(mxy-mny||1)),ox=W/2-(mnx+mxx)/2*s,oy=H/2+(mny+mxy)/2*s;
 const rgb=new Uint8Array(W*H*3),zb=new Float32Array(W*H).fill(-Infinity);
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){const g=24+Math.round(14*y/H);rgb.set([g,g+3,g+7],(y*W+x)*3);}
 const L=[0.45,0.8,0.4],ln=Math.hypot(...L);
 for(const sm of drawList){
  const {c,e,skip}=sm;if(skip)continue;
  for(let t=sm.start;t<sm.start+sm.count;t+=3){
   const a=idx[t]!,b=idx[t+1]!,d=idx[t+2]!;const A=P(a),B=P(b),C=P(d);
   const ux=B[0]!-A[0]!,uy=B[1]!-A[1]!,uz=B[2]!-A[2]!,vx=C[0]!-A[0]!,vy=C[1]!-A[1]!,vz=C[2]!-A[2]!;
   let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;const nl=Math.hypot(nx,ny,nz)||1;nx/=nl;ny/=nl;nz/=nl;if(nz<0){nx=-nx;ny=-ny;nz=-nz;}
   const lit=e>0?1:0.28+0.72*Math.max(0,(nx*L[0]!+ny*L[1]!+nz*L[2]!)/ln);
   const col=c.map(v=>Math.min(255,Math.round(255*Math.pow(Math.min(1,v*(e>0?Math.min(2.2,0.6+e*0.15):1)*lit+(e>0?0:0.04)),1/2.2))));
   const X=[A,B,C].map(p=>ox+p[0]!*s),Y=[A,B,C].map(p=>oy-p[1]!*s),Z=[A,B,C].map(p=>p[2]!);
   const x0=Math.max(0,Math.floor(Math.min(...X))),x1=Math.min(W-1,Math.ceil(Math.max(...X))),y0=Math.max(0,Math.floor(Math.min(...Y))),y1=Math.min(H-1,Math.ceil(Math.max(...Y)));
   const den=(Y[1]!-Y[2]!)*(X[0]!-X[2]!)+(X[2]!-X[1]!)*(Y[0]!-Y[2]!);if(Math.abs(den)<1e-9)continue;
   for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
    const w0=((Y[1]!-Y[2]!)*(x-X[2]!)+(X[2]!-X[1]!)*(y-Y[2]!))/den,w1=((Y[2]!-Y[0]!)*(x-X[2]!)+(X[0]!-X[2]!)*(y-Y[2]!))/den,w2=1-w0-w1;
    if(w0<0||w1<0||w2<0)continue;const z=w0*Z[0]!+w1*Z[1]!+w2*Z[2]!,k=y*W+x;if(z<=zb[k]!)continue;zb[k]=z;rgb.set(col,k*3);
   }
  }
 }
 return encodePng(W,H,rgb);
}

function packMesh(asset:MeshAsset):{ab:ArrayBuffer;meta:CookedMeshMeta}{
 const pending:{view:ArrayBufferView;slice:CookedSlice}[]=[];let cursor=0;
 const dtypeOf=(v:ArrayBufferView):CookedDType=>v instanceof Float32Array?'f32':v instanceof Uint16Array?'u16':v instanceof Uint32Array?'u32':'u8';
 const add=(v:ArrayBufferView):CookedSlice=>{
  cursor=(cursor+3)&~3;
  const slice:CookedSlice={dtype:dtypeOf(v),byteOffset:cursor,length:(v as unknown as {length:number}).length};
  pending.push({view:v,slice});cursor+=v.byteLength;return slice;
 };
 const raw=asset as any;
 const vertices=add(raw.vertices??new Float32Array(0));
 const indices=add(raw.indices??new Uint32Array(0));
 const aabb=add(raw.aabb instanceof Float32Array?raw.aabb:new Float32Array(raw.aabb??[0,0,0,0,0,0]));
 const attributes:Record<string,CookedSlice>={};
 for(const [k,v] of Object.entries(raw.attributes??{}))if(ArrayBuffer.isView(v))attributes[k]=add(v);
 const total=(cursor+3)&~3;
 const ab=new ArrayBuffer(total),u8=new Uint8Array(ab);
 for(const p of pending)u8.set(new Uint8Array(p.view.buffer,p.view.byteOffset,p.view.byteLength),p.slice.byteOffset);
 const sha256=createHash('sha256').update(u8).digest('hex').slice(0,16);
 return {ab,meta:{byteLength:total,sha256,vertices,indices,aabb,attributes,submeshes:raw.submeshes??[],materialSlots:(raw.materialSlots??[]).map((s:any)=>({slotName:s.slotName}))}};
}

self.onmessage=(ev:MessageEvent<WorkerRequest>)=>{
 const msg=ev.data;
 try{
  if(msg.kind==='mesh'){
   const gen=GENERATORS[msg.generatorId];
   if(!gen)throw Error(`未知生成器 ${msg.generatorId}`);
   const asset=runGenerator(gen,msg.params as any,msg.meshKey);
   const triangles=(asset.indices?.length??0)/3;
   const rawAabb=Array.from(asset.aabb as ArrayLike<number>);
   const {ab,meta}=packMesh(asset);
   const res:WorkerResponse={id:msg.id,ok:true,kind:'mesh',ab,meta,rawAabb,triangles};
   self.postMessage(res,[ab]);
  }else if(msg.kind==='surface'){
   let t:ReturnType<typeof surfaceMaps>;
   try{t=surfaceMaps(msg.pattern as SurfacePattern,msg.size);if(!t?.normal)throw 0;}
   catch{t=surfaceMaps('panel' as SurfacePattern,msg.size);}
   const plane=t.size*t.size*4;
   const ab=new ArrayBuffer(plane*3),u8=new Uint8Array(ab);
   u8.set(t.normal,0);
   u8.set(t.metallicRoughness,plane);
   u8.set(t.baseColor,plane*2);
   const sha256=createHash('sha256').update(u8).digest('hex').slice(0,16);
   const res:WorkerResponse={id:msg.id,ok:true,kind:'surface',ab,size:t.size,sha256};
   self.postMessage(res,[ab]);
  }else if(msg.kind==='preview'){
   const ab=rasterize(msg.position,msg.indices,msg.drawList);
   const res:WorkerResponse={id:msg.id,ok:true,kind:'preview',ab};
   self.postMessage(res,[ab]);
  }else if(msg.kind==='preview-generate'){
   const gen=GENERATORS[msg.generatorId];
   if(!gen)throw Error(`未知生成器 ${msg.generatorId}`);
   const asset:any=runGenerator(gen,msg.params as any,msg.meshKey);
   const pos:Float32Array=asset.attributes.position,idx:Uint32Array|Uint16Array=asset.indices;
   const subs:{start:number;count:number;slot:string}[]=(asset.submeshes??[]).map((s:any,i:number)=>({start:s.indexOffset??s.indexStart??0,count:s.indexCount??0,slot:asset.materialSlots?.[s.materialSlot??i]?.slotName??''}));
   const list=subs.length?subs:[{start:0,count:idx.length,slot:''}];
   const drawList:SubmeshDraw[]=list.map(sm=>{
    const col=msg.slotColors[sm.slot]??msg.defaultColor;
    return {start:sm.start,count:sm.count,c:col.c,e:col.e,skip:col.skip};
   });
   const ab=rasterize(pos,idx,drawList);
   const res:WorkerResponse={id:msg.id,ok:true,kind:'preview',ab};
   self.postMessage(res,[ab]);
  }
 }catch(error){
  const text=msg.kind==='mesh'?String(error):String((error as Error)?.message??error);
  const res:WorkerResponse={id:msg.id,ok:false,error:text};
  self.postMessage(res);
 }
};

self.postMessage({kind:'ready'} satisfies WorkerResponse);
