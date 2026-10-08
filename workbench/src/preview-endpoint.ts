import {createServer} from 'node:net';
import {createHash} from 'node:crypto';
const reserved=new Set<number>();
function available(port:number,host:string){return new Promise<boolean>(resolve=>{const server=createServer();server.once('error',()=>resolve(false));server.listen(port,host,()=>server.close(()=>resolve(true)));});}
/** localhost can resolve to either family. Hold the reservation through CLI startup. */
export async function reservePreviewPort(start=19775,end=19800){
 for(let port=start;port<end;port++){
  if(reserved.has(port))continue;reserved.add(port);
  if(await available(port,'127.0.0.1')&&await available(port,'::1'))return {port,release:()=>reserved.delete(port)};
  reserved.delete(port);
 }
 throw Error('无可用预览端口');
}
/** A workbench HTTP 200 or another scene must never be accepted as this preview. */
export async function previewMatches(url:string,expectedManifest:string){
 try{const response=await fetch(new URL('forgeax-dist.json',url),{signal:AbortSignal.timeout(1000),cache:'no-store'});if(!response.ok){await response.body?.cancel();return false;}return createHash('sha256').update(new Uint8Array(await response.arrayBuffer())).digest('hex')===expectedManifest;}catch{return false;}
}
