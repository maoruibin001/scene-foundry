import {mkdirSync,existsSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DATA,UPLOADS,read,save,digest} from './store';
import {referenceImageIds} from './reference-input';

/** 图片与描述构成不可变版本；确认不等于启动，启动采用同一同步事务去重。 */
export class ReferenceBaselines {
 constructor(readonly root:string,readonly uploads:string){mkdirSync(root,{recursive:true});}
 path(id:string){if(!/^[a-f0-9-]{36}$/.test(id))throw Error('参考方案 ID 无效');return join(this.root,id+'.json');}
 get(id:string){return read(this.path(id));}
 list(){return readdirSync(this.root).filter(f=>f.endsWith('.json')).map(f=>read(join(this.root,f))).sort((a,b)=>b.createdAt-a.createdAt);}
 images(ids:string[]){return ids.map(id=>{const m=read(join(this.uploads,id+'.json'));if(digest(readFileSync(join(this.uploads,m.file)))!==id)throw Error('参考图内容摘要不一致');return m;});}
 create(input:any,parentId?:string){const ids=referenceImageIds(input),prompt=String(input.prompt??'').trim();if(!prompt&&!ids.length)throw Error('请先提供描述或图片');if(prompt.length>8000)throw Error('描述最多 8000 字符');
  const parent=parentId?this.get(parentId):null;if(parent&&!['rejected','failed'].includes(parent.status))throw Error('请先驳回当前方案');
  const id=randomUUID(),images=this.images(ids),v={id,prompt,imageIds:ids,images,generationSettings:input.generationSettings??parent?.generationSettings??{},parentId:parent?.id??null,createdAt:Date.now(),status:ids.length?'awaiting_confirmation':'awaiting_images',origin:ids.length?'uploaded':'generated',revision:(parent?.revision??0)+1,jobId:null,approval:null,batches:[]};save(this.path(id),v);return v;
 }
 approve(id:string){const v=this.get(id);if(v.status==='approved')return v;if(v.status!=='awaiting_confirmation'||!v.imageIds.length)throw Error('需要 1–5 张待确认的参考图');this.images(v.imageIds);v.status='approved';v.approval={at:Date.now(),method:'explicit-ui-confirmation',digest:digest(JSON.stringify([v.prompt,v.imageIds]))};save(this.path(id),v);return v;}
 reject(id:string,reason:string){const v=this.get(id);if(v.jobId)throw Error('已启动的参考基准不能改写，请创建新方案');if(!['approved','awaiting_confirmation','failed','awaiting_images'].includes(v.status))throw Error('当前状态不可驳回');v.status='rejected';v.rejection={at:Date.now(),reason:String(reason??'').slice(0,8000)};v.approval=null;save(this.path(id),v);return v;}
 assert(input:any){if(!input.baselineId)throw Error('REFERENCE_APPROVAL_REQUIRED：请先确认参考图片，再开始场景生成');const v=this.get(input.baselineId),ids=referenceImageIds(input);if(v.status!=='approved'||!v.approval||v.approval.digest!==digest(JSON.stringify([String(input.prompt??'').trim(),ids])))throw Error('REFERENCE_APPROVAL_REQUIRED：描述或参考图发生变化，需要重新确认');this.images(ids);return v;}
 start(input:any,create:()=>any){const v=this.assert(input);if(v.jobId)return {id:v.jobId,reused:true};const j=create();v.jobId=j.id;v.startedAt=Date.now();save(this.path(v.id),v);return j;}
 async generate(id:string,count:number,generate:(prompt:string,count:number)=>Promise<{bytes:Uint8Array;mime:string}[]>){const v=this.get(id);if(!Number.isInteger(count)||count<1||count>5)throw Error('每批生成 1–5 张图');if(v.status!=='awaiting_images')throw Error('当前方案不能重复生成，请驳回后创建修订');v.status='generating_images';v.batches.push({count,startedAt:Date.now(),status:'running'});save(this.path(id),v);
  try{const outputs=await generate(v.prompt,count);if(outputs.length!==count)throw Error('生图服务返回数量不符，未自动补调用');const metas=outputs.map((o,i)=>{const png=Array.from(o.bytes.slice(0,8)).join(',')==='137,80,78,71,13,10,26,10',jpg=o.bytes[0]===255&&o.bytes[1]===216&&o.bytes[2]===255;if((!png&&!jpg)||o.bytes.length>20*1024*1024)throw Error('生图服务未返回有效 PNG/JPEG');const hash=digest(o.bytes),m={id:hash,file:hash+(png?'.png':'.jpg'),mime:png?'image/png':'image/jpeg',name:'候选参考图 '+(i+1),size:o.bytes.length};writeFileSync(join(this.uploads,m.file),o.bytes);save(join(this.uploads,hash+'.json'),m);return m;});if(new Set(metas.map(m=>m.id)).size!==count)throw Error('生成图片重复，请驳回并补充说明');v.images=metas;v.imageIds=metas.map(m=>m.id);v.status='awaiting_confirmation';Object.assign(v.batches.at(-1),{status:'completed',endedAt:Date.now()});}
  catch(e){v.status='failed';v.error=String(e);Object.assign(v.batches.at(-1),{status:'failed',endedAt:Date.now(),error:String(e)});}
  save(this.path(id),v);return v;
 }
 recover(){for(const v of this.list())if(v.status==='generating_images'){v.status='failed';v.error='服务中断，未自动重复生图；可驳回后重新生成或上传已有图片';save(this.path(v.id),v);}}
}
export const references=new ReferenceBaselines(join(DATA,'references'),UPLOADS);
export function imageService(){return {configured:!!(process.env.PIPELINE_IMAGE_URL&&process.env.PIPELINE_IMAGE_API_KEY&&process.env.PIPELINE_IMAGE_MODEL),model:process.env.PIPELINE_IMAGE_MODEL??null,reason:'自动生图需要配置工作台可调用的生图服务；可上传已有图片进入确认。'};}
/** 明确配置的兼容图片接口，不借用 codex6 凭证、不静默切换供应商。 */
export async function generateReferenceImages(prompt:string,count:number){if(!imageService().configured)throw Error('IMAGE_SERVICE_NOT_CONFIGURED：'+imageService().reason);const r=await fetch(process.env.PIPELINE_IMAGE_URL!,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+process.env.PIPELINE_IMAGE_API_KEY},body:JSON.stringify({model:process.env.PIPELINE_IMAGE_MODEL,prompt:'为同一个可建造的三维场景生成参考图。遵守用户描述，构图清晰，结构一致，无界面、文字水印。多张时展示同一空间的不同视角。用户描述：'+prompt,n:count,response_format:'b64_json'}),signal:AbortSignal.timeout(300000)});if(!r.ok){await r.body?.cancel();throw Error('IMAGE_SERVICE_HTTP_'+r.status);}const v:any=await r.json();if(!Array.isArray(v.data)||v.data.length!==count||v.data.some((i:any)=>typeof i.b64_json!=='string'))throw Error('生图服务须返回对应数量的 base64 图像');return v.data.map((i:any)=>({bytes:Buffer.from(i.b64_json,'base64'),mime:'image/png'}));}
