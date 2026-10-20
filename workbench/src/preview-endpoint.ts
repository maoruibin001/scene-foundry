import {createServer} from 'node:net';
import {createHash} from 'node:crypto';
import {mkdirSync,openSync,writeSync,closeSync,readFileSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const reserved=new Set<number>();
function available(port:number,host:string){return new Promise<boolean>(resolve=>{const server=createServer();server.once('error',()=>resolve(false));server.listen(port,host,()=>server.close(()=>resolve(true)));});}
const alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch(e:any){return e?.code==='EPERM';}};
/**
 * The bind probe frees the port before the CLI binds it, so two workbench processes (the ordinary and voxel backends) could both pick it:
 * workshop 78854713 (2026-10-20) failed its runtime stage on "Port 19775 is already in use". A lock file per port, owned by a live pid,
 * holds the reservation across processes until release.
 */
function lockPort(port:number,dir:string){
 const file=join(dir,port+'.lock');
 for(let n=0;n<2;n++){
  try{const fd=openSync(file,'wx');writeSync(fd,String(process.pid));closeSync(fd);return ()=>{try{if(readFileSync(file,'utf8')===String(process.pid))unlinkSync(file);}catch{}};}
  catch(e:any){if(e?.code!=='EEXIST')throw e;let owner=NaN;try{owner=Number(readFileSync(file,'utf8'));}catch{}if(Number.isInteger(owner)&&owner>0&&alive(owner))return null;try{unlinkSync(file);}catch{}}
 }
 return null;
}
/** localhost can resolve to either family. Hold the reservation through CLI startup. */
export async function reservePreviewPort(start=19775,end=19800,dir=join(tmpdir(),'scene-foundry-preview-ports')){
 mkdirSync(dir,{recursive:true});
 for(let port=start;port<end;port++){
  if(reserved.has(port))continue;reserved.add(port);
  const unlock=lockPort(port,dir);
  if(unlock&&await available(port,'127.0.0.1')&&await available(port,'::1'))return {port,release:()=>{unlock();reserved.delete(port);}};
  unlock?.();reserved.delete(port);
 }
 throw Error('无可用预览端口');
}
/** A workbench HTTP 200 or another scene must never be accepted as this preview. */
export async function previewMatches(url:string,expectedManifest:string){
 try{const response=await fetch(new URL('forgeax-dist.json',url),{signal:AbortSignal.timeout(1000),cache:'no-store'});if(!response.ok){await response.body?.cancel();return false;}return createHash('sha256').update(new Uint8Array(await response.arrayBuffer())).digest('hex')===expectedManifest;}catch{return false;}
}
