import { watch, openSync, closeSync, fstatSync, readSync, type FSWatcher } from 'node:fs';
import { dirname, basename } from 'node:path';
import type { Source } from './source';

const WINDOW = 128 * 1024;
const DONE = new Set(['completed','failed','timed_out','cancelled','interrupted','end_turn','stop']);

// Observe existing append-only output. This module never writes to or owns the producer.
export function liveOutput(source: Source, key: string, call: string, channel: string, signal: AbortSignal) {
  if (!['log','stdout'].includes(channel)) throw Error('实时输出只支持执行日志和标准输出');
  const detail = source.detail(key);
  if (!detail.calls.some((c: any) => c.id === call)) throw Error('调用不属于当前记录');
  const {base} = source.locate(key);
  const rel = `${base}/${call}-${channel === 'log' ? 'cli.log' : 'stdout.log'}`;
  const parent = source.reader.path(dirname(rel));
  let watcher: FSWatcher | undefined, timer: ReturnType<typeof setInterval> | undefined;
  let stopped = false, offset = 0, inode = '', initialized = false, lastStatus = '', missing = false;
  let decoder = new TextDecoder();
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const encode = new TextEncoder();
  const cleanup = () => { watcher?.close(); if(timer)clearInterval(timer); signal.removeEventListener('abort', close); };
  const close = () => { if(stopped)return; stopped=true; cleanup(); try{controller.close();}catch{} };
  const send = (event: string, value: unknown) => {
    if(stopped)return false;
    const bytes=encode.encode(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`);
    // Never let a slow/disconnected viewer apply backpressure to generation.
    if ((controller.desiredSize ?? 0) < bytes.length) { close(); return false; }
    controller.enqueue(bytes); return true;
  };
  const update = () => {
    if(stopped)return;
    try {
      let fd: number | undefined;
      try {
        fd = openSync(source.reader.path(rel),'r');
        const stat = fstatSync(fd);
        if(!stat.isFile())throw Error('输出不是普通文件');
        const identity = `${stat.dev}:${stat.ino}`;
        let reset = !initialized || identity!==inode || stat.size<offset;
        if(reset) {
          decoder=new TextDecoder();offset=Math.max(0,stat.size-WINDOW);inode=identity;initialized=true;
          send('reset',{file:basename(rel),bytes:stat.size,truncated:offset>0,channel});
        }
        missing=false;
        if(stat.size-offset>WINDOW){reset=true;offset=stat.size-WINDOW;decoder=new TextDecoder();send('reset',{file:basename(rel),bytes:stat.size,truncated:true,channel});}
        if(stat.size>offset){
          const raw=Buffer.alloc(Math.min(WINDOW,stat.size-offset));
          const n=readSync(fd,raw,0,raw.length,offset);
          let skip=0;if(reset&&offset>0)while(skip<n&&(raw[skip]&0xc0)===0x80)skip++;
          offset+=n;const text=decoder.decode(raw.subarray(skip,n),{stream:true});
          if(text)send('output',{text,offset});
        }
      } catch(error: any) {
        if(error.code!=='ENOENT')throw error;
        if(!missing){send('missing',{file:basename(rel)});missing=true;}
      } finally { if(fd!==undefined)closeSync(fd); }
      const current=source.detail(key);
      const selected=current.calls.find((c: any)=>c.id===call);
      const status=selected?.status??'unknown';
      if(status!==lastStatus){send('state',{status,terminal:current.terminal,file:basename(rel),observedAt:new Date().toISOString()});lastStatus=status;}
      if(current.terminal||DONE.has(status)){const tail=decoder.decode();if(tail)send('output',{text:tail,offset});send('end',{status,bytes:offset,missing});close();}
    } catch(error) {send('observer-error',{error:String(error)});close();}
  };
  const body=new ReadableStream<Uint8Array>({
    start(c){
      controller=c;
      if(signal.aborted){close();return;}
      signal.addEventListener('abort',close,{once:true});
      try {
        watcher=watch(parent,(_event,file)=>{if(!file||String(file)===basename(rel)||String(file).endsWith('-execution.json'))update();});
        watcher.on('error',()=>{send('observer-error',{error:'输出监听中断，请重新连接'});close();});
        // Reconcile missed filesystem events and keep proxies/connections alive.
        timer=setInterval(()=>{update();send('heartbeat',{at:Date.now()});},1000);
        update();
      } catch(error){send('observer-error',{error:String(error)});close();}
    },
    cancel(){stopped=true;cleanup();},
  },{highWaterMark:512*1024,size:chunk=>chunk.byteLength});
  return new Response(body,{headers:{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no','X-Content-Type-Options':'nosniff'}});
}
