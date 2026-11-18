import {test,expect} from 'bun:test';
import {mkdtempSync,existsSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {captureShutdown,closeCaptureResources} from './capture-shutdown.mjs';
test('采集会话拥有浏览器关闭权，不先等待可能阻塞的页面关闭',async()=>{
 let pageCalls=0,sessionCalls=0,sinkCalls=0;const steps:string[]=[];
 const session={page:{close:()=>{pageCalls++;return new Promise(()=>{});}},close:async()=>{sessionCalls++;}};
 await closeCaptureResources(session,{close:async()=>{sinkCalls++;}},s=>steps.push(s));
 expect(pageCalls).toBe(0);expect(sessionCalls).toBe(1);expect(sinkCalls).toBe(1);expect(steps.at(-1)).toBe('采集资源已关闭');
});
test('录屏接收器关闭失败仍关闭Engine会话且保留失败',async()=>{
 let closed=false;await expect(closeCaptureResources({close:async()=>{closed=true;}},{close:async()=>{throw Error('sink failed');}})).rejects.toThrow('sink failed');expect(closed).toBe(true);
});
test('并发正常关闭只清理一次',async()=>{
 let calls=0;const c=captureShutdown(async()=>{await Bun.sleep(10);calls++;});
 c.ready();await Promise.all([c.close(),c.close()]);expect(calls).toBe(1);
});
test('实际终止信号等待清理完成',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'capture-shutdown-test-')),marker=join(dir,'closed'),ready=join(dir,'ready');
 const script=`import {captureShutdown} from ${JSON.stringify(join(import.meta.dirname,'capture-shutdown.mjs'))};import{writeFileSync}from'node:fs';const c=captureShutdown(async()=>{await Bun.sleep(30);writeFileSync(${JSON.stringify(marker)},'closed');});c.ready();writeFileSync(${JSON.stringify(ready)},'ready');setInterval(()=>{},1000);`;
 const p=Bun.spawn([process.execPath,'--eval',script],{stdout:'pipe',stderr:'pipe'});
 try{const deadline=Date.now()+4000;while(!existsSync(ready)&&Date.now()<deadline&&p.exitCode===null)await Bun.sleep(10);expect(existsSync(ready)).toBe(true);p.kill('SIGTERM');expect(await p.exited).toBe(143);expect(readFileSync(marker,'utf8')).toBe('closed');}finally{if(p.exitCode===null){p.kill('SIGKILL');await p.exited;}rmSync(dir,{recursive:true,force:true});}
});

test('会话关闭不返回时明确失败，不吞掉超时或伪造关闭成功',async()=>{
 const steps:string[]=[];await expect(closeCaptureResources({close:()=>new Promise(()=>{})},null,s=>steps.push(s),{timeoutMs:10})).rejects.toThrow('CAPTURE_CLEANUP_TIMEOUT');expect(steps).not.toContain('采集资源已关闭');
});

test('Engine owns private and borrowed teardown; pipeline never navigates before official close',async()=>{
 const order:string[]=[];
 await closeCaptureResources({report:()=>({carrier:'private-browser'}),page:{goto:()=>{throw Error('must not navigate a closing GPU owner');}},close:async()=>{order.push('close');}},null);
 expect(order).toEqual(['close']);
 await closeCaptureResources({report:()=>({carrier:'borrowed'}),page:{goto:async()=>{throw Error('不能触碰借用页面');}},close:async()=>{}},null);
 await expect(closeCaptureResources({report:()=>({carrier:'private-browser'}),page:{goto:async()=>{}},close:async()=>{throw Error('close failed');}},null)).rejects.toThrow('close failed');
});
test('an authoritative Engine close requires its actual closedAt receipt',async()=>{
 const report:any={schemaVersion:'3.0.0',carrier:'private-browser'};
 await expect(closeCaptureResources({report:()=>report,close:async()=>{}},null)).rejects.toThrow('CAPTURE_CLOSE_UNCONFIRMED');
 await closeCaptureResources({report:()=>report,close:async()=>{report.closedAt=new Date().toISOString();}},null);
});
test('close timeout preserves exact phase and only the capture process tree instead of passing the gate',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'capture-close-diag-'));try{
 await expect(closeCaptureResources({close:()=>new Promise(()=>{})},null,()=>{},{timeoutMs:15,outputDir:dir})).rejects.toThrow('CAPTURE_CLEANUP_TIMEOUT');
 const d=JSON.parse(readFileSync(join(dir,'capture-close-diag.json'),'utf8'));expect(d.phaseAtTimeout).toBe('session');expect(d.closedAt).toBeNull();expect(d.sinkCloseMs).toBeNumber();expect(d.processTree.some((p:any)=>p.pid===process.pid)).toBe(true);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('media references must be released and the SDK still owns actual closure',async()=>{
 let closed=false;const d=await closeCaptureResources({page:{isClosed:()=>false},close:async()=>{closed=true;}},null,()=>{},{releaseMedia:async()=>({chunks:0,objectUrlActive:false,recorderActive:false,channelClosed:true})});expect(closed).toBe(true);expect(d.mediaReleaseMs).toBeNumber();
 closed=false;await expect(closeCaptureResources({page:{isClosed:()=>false},close:async()=>{closed=true;}},null,()=>{},{releaseMedia:async()=>({chunks:1})})).rejects.toThrow('MEDIA_RELEASE');expect(closed).toBe(true);
});
