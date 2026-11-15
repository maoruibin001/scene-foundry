/** cbc4 ImageGen 是可选的独立生图入口；只收集隔离目录中真实工具回执对应的图片。 */
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,relative,isAbsolute} from 'node:path';
import {captureCodexProcess} from './codex-process';

export function cbc4ImageAvailable(){return Boolean(Bun.which(process.env.PIPELINE_CBC4_BIN?.trim()||'cbc4'));}
export function cbc4ImageToolPaths(stdout:string,root:string){
 let events:any[];try{const value=JSON.parse(stdout);events=Array.isArray(value)?value:[value];}catch{events=stdout.trim().split('\n').filter(Boolean).map(x=>JSON.parse(x));}
 const hits:any[]=[];const visit=(v:any,depth:number)=>{if(depth>12||v==null)return;if(typeof v==='string'){if(v.length<200000&&v.trim().startsWith('{')){try{visit(JSON.parse(v),depth+1)}catch{}}return;}if(Array.isArray(v)){for(const x of v)visit(x,depth+1);return;}if(typeof v!=='object')return;if(v.type==='image_gen_tool_result'&&v.status==='completed'&&Array.isArray(v.images)){hits.push(v);return;}for(const x of Object.values(v))visit(x,depth+1);};
 for(const event of events)visit(event,0);
 if(hits.length!==1||hits[0].images.length!==1)throw Error('CBC4_IMAGE_RESULT_INVALID：需要恰好一次成功生图及一张图片');
 const file=hits[0].images[0]?.localPath;if(typeof file!=='string'||!isAbsolute(file))throw Error('CBC4_IMAGE_RESULT_INVALID：缺少图片路径');
 const canonical=realpathSync(file),rel=relative(realpathSync(root),canonical);if(!rel||rel==='..'||rel.startsWith('../')||isAbsolute(rel))throw Error('CBC4_IMAGE_RESULT_INVALID：图片不在本次隔离目录');
 return [canonical];
}
export async function generateCbc4ReferenceImage(prompt:string,count:number,imageModel?:string,auditDir?:string){
 if(count!==1)throw Error('cbc4 生图目前每次仅允许一张，避免未核实的批量调用');
 const bin=Bun.which(process.env.PIPELINE_CBC4_BIN?.trim()||'cbc4');if(!bin)throw Error('IMAGE_SERVICE_NOT_CONFIGURED：找不到 cbc4');
 if(imageModel&&!/^[A-Za-z0-9._:/-]{1,120}$/.test(imageModel))throw Error('生图模型 ID 无效');
 const dir=mkdtempSync(join(tmpdir(),'scene-cbc4-image-'));
 const args=[bin,'--permission-mode','dontAsk','--print','--output-format','stream-json','--verbose','--max-turns','2','--no-session-persistence','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--tools','ImageGen','--allowedTools','ImageGen',...(imageModel?['--text-to-image-model',imageModel]:[])];
 const env=Object.fromEntries(['PATH','HOME','TMPDIR','LANG','LC_ALL','USER','LOGNAME','CBC4_BIN','CODEBUDDY_CONFIG_DIR'].filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]!]));
 try{
  const started=Date.now(),result=await captureCodexProcess({args,cwd:dir,env,input:'仅调用一次 ImageGen 工具，生成一张参考图；将工具 output_dir 设为 '+dir+'。完成后结束。场景描述：'+prompt,prefix:join(dir,'cbc4-'),timeoutMs:300000,maxTimeoutMs:300000});
  const durationMs=Date.now()-started;
  if(result.timedOut)throw Error('CBC4_IMAGE_TIMEOUT：生图超时');if(result.code!==0)throw Error('CBC4_IMAGE_FAILED：'+result.stderr.slice(-600));
  const out=cbc4ImageToolPaths(result.stdout,dir).map(path=>{const bytes=readFileSync(path),png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;if(!png&&!jpg)throw Error('CBC4_IMAGE_RESULT_INVALID：不是 PNG 或 JPEG');return {bytes,mime:png?'image/png':'image/jpeg'};});
  if(auditDir){
   mkdirSync(auditDir,{recursive:true});
   const sha256s=out.map(item=>createHash('sha256').update(item.bytes).digest('hex'));
   writeFileSync(join(auditDir,'cbc4-image-receipt.json'),JSON.stringify({provider:'cbc4',requestedImageModel:imageModel??null,durationMs,imageCount:out.length,sha256s},null,2));
  }
  return out;
 }finally{rmSync(dir,{recursive:true,force:true});}
}
