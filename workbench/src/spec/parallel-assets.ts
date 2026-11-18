/**
 * Bun Worker 线程池、二进制网格/表面贴图编解码与等轴缩略图光栅器。
 * 池大小默认 Math.min(jobs.length, Math.min(8, os.availableParallelism?.() ?? 4)),
 * 单次批处理内跨任务复用 Worker,并在 finally 中全部 terminate(),确保 0 泄漏线程阻塞进程退出。
 */
import {createHash} from 'node:crypto';
import * as os from 'node:os';
import {deflateSync} from 'node:zlib';
import type {MeshAsset} from '@forgeax/engine/types';
import type {WorkerRequest,WorkerResponse} from './asset-worker';

export type CookedDType='f32'|'u16'|'u32'|'u8';
export type CookedSlice={dtype:CookedDType;byteOffset:number;length:number};
export type CookedMeshMeta={
 byteLength:number;
 sha256:string;
 vertices:CookedSlice;
 indices:CookedSlice;
 aabb:CookedSlice;
 attributes:Record<string,CookedSlice>;
 submeshes:unknown[];
 materialSlots:{slotName:string}[];
};

export type PreviewSlotColor={c:number[];e:number;skip:boolean};
export type PreviewSubmeshDraw={start:number;count:number;c:number[];e:number;skip:boolean};

export interface ParallelAssetStats{
 meshWorkerRuns:number;
 meshMainThreadRuns:number;
 meshCacheHits:number;
 surfaceWorkerRuns:number;
 surfaceMainThreadRuns:number;
 surfaceCacheHits:number;
 previewWorkerRuns:number;
 previewGeneratorFallbacks:number;
 lastPoolWorkers:number;
 lastDurationMs:number;
}

const stats:ParallelAssetStats={
 meshWorkerRuns:0,
 meshMainThreadRuns:0,
 meshCacheHits:0,
 surfaceWorkerRuns:0,
 surfaceMainThreadRuns:0,
 surfaceCacheHits:0,
 previewWorkerRuns:0,
 previewGeneratorFallbacks:0,
 lastPoolWorkers:0,
 lastDurationMs:0,
};

let activeWorkerCount=0;

export const getActiveWorkerCount=()=>activeWorkerCount;
export const getParallelAssetStats=():ParallelAssetStats=>({...stats});
export function resetParallelAssetStats(){
 for(const k of Object.keys(stats) as (keyof ParallelAssetStats)[])stats[k]=0;
}
export function bumpParallelStat<K extends keyof ParallelAssetStats>(key:K,delta=1){
 stats[key]+=delta;
}
export function setLastPoolTelemetry(workers:number,durationMs:number){
 stats.lastPoolWorkers=workers;
 stats.lastDurationMs=durationMs;
}

export function defaultWorkerConcurrency():number{
 const avail=typeof os.availableParallelism==='function'?os.availableParallelism():4;
 return Math.max(1,Math.min(8,avail||4));
}

export function encodeCookedMesh(asset:MeshAsset):{ab:ArrayBuffer;bin:Buffer;meta:CookedMeshMeta}{
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
 const bin=Buffer.from(ab);
 const sha256=createHash('sha256').update(u8).digest('hex').slice(0,16);
 return {ab,bin,meta:{byteLength:total,sha256,vertices,indices,aabb,attributes,submeshes:raw.submeshes??[],materialSlots:(raw.materialSlots??[]).map((s:any)=>({slotName:s.slotName}))}};
}

export function decodeCookedMesh(ab:ArrayBuffer,meta:CookedMeshMeta):MeshAsset{
 const view=(s:CookedSlice)=>
  s.dtype==='f32'?new Float32Array(ab,s.byteOffset,s.length)
  :s.dtype==='u16'?new Uint16Array(ab,s.byteOffset,s.length)
  :s.dtype==='u32'?new Uint32Array(ab,s.byteOffset,s.length)
  :new Uint8Array(ab,s.byteOffset,s.length);
 const attributes:Record<string,unknown>={};
 for(const [k,s] of Object.entries(meta.attributes))attributes[k]=view(s);
 return {
  kind:'mesh',
  vertices:view(meta.vertices) as Float32Array,
  indices:view(meta.indices) as Uint16Array|Uint32Array,
  aabb:view(meta.aabb) as Float32Array,
  attributes:attributes as any,
  submeshes:meta.submeshes as any,
  materialSlots:meta.materialSlots as any,
 } as MeshAsset;
}

export function bufferToStandaloneArrayBuffer(raw:Buffer):ArrayBuffer{
 return raw.byteOffset===0&&raw.byteLength===raw.buffer.byteLength
  ?(raw.buffer as ArrayBuffer)
  :raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength);
}

const PREVIEW_W=360,PREVIEW_H=270;
const CRC_TABLE=new Uint32Array(256).map((_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});

export function buildPreviewDrawList(asset:any,colorOf:(slot:string)=>PreviewSlotColor):PreviewSubmeshDraw[]{
 const idx:Uint32Array|Uint16Array=asset.indices;
 const subs:{start:number;count:number;slot:string}[]=(asset.submeshes??[]).map((s:any,i:number)=>({
  start:s.indexOffset??s.indexStart??0,
  count:s.indexCount??0,
  slot:asset.materialSlots?.[s.materialSlot??i]?.slotName??'',
 }));
 const list=subs.length?subs:[{start:0,count:idx.length,slot:''}];
 return list.map(sm=>{const {c,e,skip}=colorOf(sm.slot);return {start:sm.start,count:sm.count,c,e,skip:Boolean(skip)};});
}

export function rasterizePreviewPng(pos:Float32Array,idx:Uint32Array|Uint16Array,drawList:readonly PreviewSubmeshDraw[]):Uint8Array{
 const crc=(b:Uint8Array)=>{let c=0xffffffff;for(const x of b)c=CRC_TABLE[(c^x)&255]!^(c>>>8);return (c^0xffffffff)>>>0;};
 const chunk=(t:string,d:Uint8Array)=>{
  const o=new Uint8Array(12+d.length),v=new DataView(o.buffer);
  v.setUint32(0,d.length);
  o.set(new TextEncoder().encode(t),4);
  o.set(d,8);
  v.setUint32(8+d.length,crc(o.subarray(4,8+d.length)));
  return o;
 };
 const az=Math.PI*0.25,el=0.55,ca=Math.cos(az),sa=Math.sin(az),ce=Math.cos(el),se=Math.sin(el);
 const P=(i:number)=>{const x=pos[i*3]!,y=pos[i*3+1]!,z=pos[i*3+2]!;const rx=x*ca-z*sa,rz=x*sa+z*ca;return [rx,y*ce-rz*se,y*se+rz*ce];};
 let mnx=Infinity,mny=Infinity,mxx=-Infinity,mxy=-Infinity;
 for(let i=0;i<pos.length/3;i++){const p=P(i);mnx=Math.min(mnx,p[0]!);mxx=Math.max(mxx,p[0]!);mny=Math.min(mny,p[1]!);mxy=Math.max(mxy,p[1]!);}
 const s=0.9*Math.min(PREVIEW_W/(mxx-mnx||1),PREVIEW_H/(mxy-mny||1)),ox=PREVIEW_W/2-(mnx+mxx)/2*s,oy=PREVIEW_H/2+(mny+mxy)/2*s;
 const rgb=new Uint8Array(PREVIEW_W*PREVIEW_H*3),zb=new Float32Array(PREVIEW_W*PREVIEW_H).fill(-Infinity);
 for(let y=0;y<PREVIEW_H;y++)for(let x=0;x<PREVIEW_W;x++){const g=24+Math.round(14*y/PREVIEW_H);rgb.set([g,g+3,g+7],(y*PREVIEW_W+x)*3);}
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
   const x0=Math.max(0,Math.floor(Math.min(...X))),x1=Math.min(PREVIEW_W-1,Math.ceil(Math.max(...X))),y0=Math.max(0,Math.floor(Math.min(...Y))),y1=Math.min(PREVIEW_H-1,Math.ceil(Math.max(...Y)));
   const den=(Y[1]!-Y[2]!)*(X[0]!-X[2]!)+(X[2]!-X[1]!)*(Y[0]!-Y[2]!);if(Math.abs(den)<1e-9)continue;
   for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
    const w0=((Y[1]!-Y[2]!)*(x-X[2]!)+(X[2]!-X[1]!)*(y-Y[2]!))/den,w1=((Y[2]!-Y[0]!)*(x-X[2]!)+(X[0]!-X[2]!)*(y-Y[2]!))/den,w2=1-w0-w1;
    if(w0<0||w1<0||w2<0)continue;const z=w0*Z[0]!+w1*Z[1]!+w2*Z[2]!,k=y*PREVIEW_W+x;if(z<=zb[k]!)continue;zb[k]=z;rgb.set(col,k*3);
   }
  }
 }
 const raw=new Uint8Array(PREVIEW_H*(PREVIEW_W*3+1));
 for(let y=0;y<PREVIEW_H;y++){raw[y*(PREVIEW_W*3+1)]=0;raw.set(rgb.subarray(y*PREVIEW_W*3,(y+1)*PREVIEW_W*3),y*(PREVIEW_W*3+1)+1);}
 const ihdr=new Uint8Array(13),v=new DataView(ihdr.buffer);
 v.setUint32(0,PREVIEW_W);v.setUint32(4,PREVIEW_H);ihdr[8]=8;ihdr[9]=2;
 const parts=[new Uint8Array([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',new Uint8Array())];
 const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));
 let o=0;for(const p of parts){out.set(p,o);o+=p.length;}
 return out;
}

const WORKER_SCRIPT_URL=new URL('./asset-worker.ts',import.meta.url).href;

export type DistributiveOmit<T,K extends keyof any>=T extends any?Omit<T,K>:never;
export type WorkerTaskPayload=DistributiveOmit<WorkerRequest,'id'>;
export type WorkerTaskResult=Exclude<WorkerResponse,{kind:'ready'}>;

/**
 * 在 Bun Worker 池上并行执行一批任务,单 Worker 顺序拉取队列直到耗尽,最后在 finally 中彻底终止全部 Worker。
 */
export async function runWorkerTasks(
 tasks:readonly WorkerTaskPayload[],
 opts?:{concurrency?:number;watchdogMs?:number},
):Promise<{results:WorkerTaskResult[];workersUsed:number;durationMs:number}>{
 const t0=performance.now();
 if(!tasks.length){
  setLastPoolTelemetry(0,0);
  return {results:[],workersUsed:0,durationMs:0};
 }
 const maxWorkers=Math.max(1,Math.floor(opts?.concurrency??defaultWorkerConcurrency()));
 const poolSize=Math.min(tasks.length,maxWorkers);
 const results=new Array<WorkerTaskResult>(tasks.length);
 let nextIndex=0;
 const workers:{worker:Worker;terminated:boolean}[]=[];

 try{
  const terminateHandle=(h:{worker:Worker;terminated:boolean})=>{
   if(!h.terminated){
    h.terminated=true;
    try{h.worker.terminate();}finally{activeWorkerCount=Math.max(0,activeWorkerCount-1);}
   }
  };

  const runSlot=async()=>{
   const handle={worker:new Worker(WORKER_SCRIPT_URL),terminated:false};
   activeWorkerCount++;
   workers.push(handle);
   const w=handle.worker;
   let watchdog:ReturnType<typeof setTimeout>|undefined;
   try{
    await new Promise<void>((resolveReady,rejectReady)=>{
     let ready=false;
     let currentTaskId=-1;
     // 单个 Worker 既不回消息也不报错时，Promise 永不 settle，finally 也不会执行、线程不会回收。
     // 看门狗保证整批任务有上界；超时按失败处理，不允许静默留下半批结果。
     const watchdogMs=Math.max(50,Math.floor(opts?.watchdogMs??120000));
     watchdog=setTimeout(()=>rejectReady(new Error(`ASSET_WORKER_WATCHDOG_TIMEOUT：Worker 在 ${watchdogMs}ms 内未完成任务 ${currentTaskId}`)),watchdogMs);
     const finish=()=>{if(watchdog)clearTimeout(watchdog);resolveReady();};
     const step=()=>{
      if(nextIndex>=tasks.length){finish();return;}
      const idx=nextIndex++;
      currentTaskId=idx;
      const payload={...tasks[idx]!,id:idx} as WorkerRequest;
      w.postMessage(payload);
     };
     w.onmessage=(ev:MessageEvent<WorkerResponse>)=>{
      const msg=ev.data;
      if(!ready){
       if('kind' in msg&&msg.kind==='ready'){
        ready=true;
        step();
       }
       return;
      }
      if('id' in msg){
       results[msg.id]=msg;
       currentTaskId=-1;
       step();
      }
     };
     w.onerror=(err:ErrorEvent)=>{
      const reason=err?.message||String(err)||'Asset worker crashed';
      if(currentTaskId>=0&&!results[currentTaskId]){
       results[currentTaskId]={id:currentTaskId,ok:false,error:reason};
      }
      rejectReady(new Error(reason));
     };
    });
   }finally{
    if(watchdog)clearTimeout(watchdog);
    terminateHandle(handle);
   }
  };

  await Promise.all(Array.from({length:poolSize},()=>runSlot()));
 }finally{
  for(const h of workers){
   if(!h.terminated){
    h.terminated=true;
    try{h.worker.terminate();}finally{activeWorkerCount=Math.max(0,activeWorkerCount-1);}
   }
  }
 }

 const durationMs=Math.round(performance.now()-t0);
 setLastPoolTelemetry(poolSize,durationMs);
 return {results,workersUsed:poolSize,durationMs};
}

export {planSpecExportParallel,getCachedMeshAsset,clearMeshCaches} from './export-pack';
export {writeAssetPreviewsParallel} from './asset-previews';
