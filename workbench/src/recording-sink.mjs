import {createServer} from 'node:http';
import {createWriteStream} from 'node:fs';
import {rename,rm} from 'node:fs/promises';
import {randomBytes,createHash} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
/** One-use, origin-bound loopback receiver. Video bytes never cross the automation RPC. */
export async function recordingSink(destination, origin, {maxBytes=64*1024*1024,timeoutMs=20000}={}) {
 const token=randomBytes(24).toString('hex'),temporary=destination+'.partial';let accepted=false,settled=false,resolveReceipt,rejectReceipt;
 const receipt=new Promise((resolve,reject)=>{resolveReceipt=resolve;rejectReceipt=reject;});receipt.catch(()=>{});
 const fail=error=>{if(!settled){settled=true;rejectReceipt(error);}};
 const server=createServer(async(req,res)=>{
  if(req.headers.origin!==origin||req.url!=='/recording/'+token){res.writeHead(403).end();return;}
  res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS'){res.writeHead(204).end();return;}
  if(req.method!=='POST'||accepted){res.writeHead(409).end();return;}accepted=true;
  let bytes=0;const hash=createHash('sha256'),header=[];
  const meter=new Transform({transform(chunk,_,done){bytes+=chunk.length;if(bytes>maxBytes){done(Error('录屏超过接收大小上限'));return;}if(header.length<4)for(const b of chunk){if(header.length<4)header.push(b);else break;}hash.update(chunk);done(null,chunk);}});
  try{await pipeline(req,meter,createWriteStream(temporary,{flags:'wx'}));if(bytes<1024||header.join(',')!=='26,69,223,163')throw Error('录屏不是有效 WebM');await rename(temporary,destination);const result={bytes,sha256:hash.digest('hex'),transport:'origin-bound one-use loopback stream'};settled=true;resolveReceipt(result);res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(result));}
  catch(error){fail(error);res.writeHead(400).end('Recording rejected');await rm(temporary,{force:true});}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const timer=setTimeout(()=>{fail(Error('录屏流式传输超时'));server.closeAllConnections();},timeoutMs);
 return {url:'http://127.0.0.1:'+server.address().port+'/recording/'+token,receipt,async close(){clearTimeout(timer);await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});await rm(temporary,{force:true});}};
}
