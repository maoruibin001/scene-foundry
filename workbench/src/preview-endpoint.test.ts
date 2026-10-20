import {test,expect} from 'bun:test';
import {createServer} from 'node:net';
import {createHash} from 'node:crypto';
import {reservePreviewPort,previewMatches} from './preview-endpoint';
test('an IPv4-only UI listener and concurrent preview startups cannot share a port',async()=>{
 const ui=createServer();await new Promise<void>(resolve=>ui.listen(0,'127.0.0.1',resolve));const port=(ui.address() as any).port;let a:any,b:any;
 try{[a,b]=await Promise.all([reservePreviewPort(port,port+8),reservePreviewPort(port,port+8)]);expect(a.port).not.toBe(port);expect(b.port).not.toBe(port);expect(a.port).not.toBe(b.port);}finally{a?.release();b?.release();await new Promise<void>(resolve=>ui.close(()=>resolve()));}
});
test('readiness requires the exact built manifest, not merely HTTP 200 or an unrelated scene',async()=>{
 const manifest='{"project":"expected candidate"}',sha=createHash('sha256').update(manifest).digest('hex');let body='<html>workbench UI</html>';
 const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>new Response(body)});
 try{expect(await previewMatches(server.url.toString(),sha)).toBe(false);body='{"project":"another scene"}';expect(await previewMatches(server.url.toString(),sha)).toBe(false);body=manifest;expect(await previewMatches(server.url.toString(),sha)).toBe(true);}finally{server.stop(true);}
});

test('a port another live workbench process locked is skipped; a lock left by a dead process is reclaimed',async()=>{
 const {mkdtempSync,writeFileSync,existsSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const dir=mkdtempSync(join(tmpdir(),'sf-port-lock-')),start=21375;
 try{
  writeFileSync(join(dir,start+'.lock'),'1'); // pid 1 is alive and not ours
  const a=await reservePreviewPort(start,start+4,dir);expect(a.port).not.toBe(start);expect(existsSync(join(dir,a.port+'.lock'))).toBe(true);
  a.release();expect(existsSync(join(dir,a.port+'.lock'))).toBe(false);
  writeFileSync(join(dir,start+'.lock'),'99999999'); // no such process
  const b=await reservePreviewPort(start,start+4,dir);expect(b.port).toBe(start);b.release();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
