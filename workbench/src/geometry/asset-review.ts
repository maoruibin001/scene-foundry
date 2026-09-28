import {join,dirname} from 'node:path';
import {mkdirSync,existsSync,readFileSync} from 'node:fs';
import {save,read,digest} from '../store';
import {stable} from '../validated-cache';
import type {CodexToolKit} from '../codex-tools';
import {validateAsset} from './layout';
import {surfaceAudit} from './surface-audit';
import {renderRepairPreview} from './repair-engine-preview';
export function verifyAssetReview(value:any,record:any){try{if(!record||record.assetSha256!==digest(stable(value))||digest(readFileSync(record.receipt))!==record.receiptSha256)return false;const receipt=read(record.receipt);return receipt.frames?.length>=2&&receipt.frames.every((f:any)=>digest(readFileSync(join(dirname(record.receipt),'capture',f.file)))===f.sha256);}catch{return false;}}
/** 独立资产真实预览；不拼造未生成的其余场景，不冒充整场景验收。 */
export function assetPreviewScene(value:any,brief:any,layout:any){
 const center=brief.bounds.min.map((v:number,k:number)=>(v+brief.bounds.max[k])/2),radius=Math.hypot(...brief.bounds.max.map((v:number,k:number)=>(v-brief.bounds.min[k])/2)),distance=Math.max(.5,radius/Math.sin(.65/2)*1.2);
 const used=new Set(value.template.parts.map((p:any)=>p.material)),materials=layout.program.materials.filter((m:any)=>used.has(m.id)),textures=new Set(materials.map((m:any)=>m.textureId).filter(Boolean));
 return {version:'scene-v1',program:{version:'geometry-v1',name:brief.label,materials,templates:[value.template],instances:[{id:'asset',label:brief.label,template:brief.id,position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],requirementIds:[]}]},entities:[{instanceId:'asset',role:'subject',category:'asset-inspection'}],spatialOpenings:[],textures:layout.textures.filter((t:any)=>textures.has(t.id)),textureReuse:(layout.textureReuse??[]).filter((t:any)=>textures.has(t.textureId)),cameras:[[1,-1,.6],[-1,1,.8]].map((direction,i)=>({name:'资产检查 '+(i+1),referenceIndex:null,position:center.map((v:number,k:number)=>v+distance*direction[k]/Math.hypot(...direction)),target:center,fov:.65})),lighting:{direction:[.4,-.6,-.7],color:[1,1,1],intensity:1.8,ambientColor:[1,1,1],ambientIntensity:.5,points:[]},assumptions:['独立资产检查机位和辅助照明，不是参考图机位或最终场景效果']};
}
export function createAssetReview(options:{brief:any;layout:any;textures:any;images:any[];folder:string;signal:AbortSignal;render?:typeof renderRepairPreview}){
 const {brief,layout,textures,folder,signal}=options;mkdirSync(folder,{recursive:true});
 const file=join(folder,'asset-preview-audit.json'),contract=digest(stable([brief,layout.program.materials,options.images.map(i=>digest(readFileSync(i.path)))]));
 const audit=existsSync(file)?read(file):{contract,attempts:[],used:0};if(audit.contract!==contract)throw Error('资产预览恢复契约发生变化');
 let busy=false;
 const find=(hash:string)=>audit.attempts.find((a:any)=>a.sha256===hash&&a.status==='rendered');
 const resolve=(v:any)=>{const row=find(v?.selectedAssetSha256);if(!row||!v.reason?.trim())throw Error('必须选择本轮已真实预览的资产并说明依据');const value=read(join(folder,String(row.index),'asset.json'));if(digest(stable(value))!==row.sha256)throw Error('资产预览候选摘要变化');validateAsset(value,brief,layout,textures);return value;};
 const kit:CodexToolKit={version:'asset-preview-v1',instructions:'先调用 preview_asset 查看本次资产在 ForgeaX Engine 的两个独立检查机位。assetJson 是完整 asset-geometry-v1 JSON。最多两次实际预览，按原图局部依据修正可见轮廓、厚度、曲面、UV与磨损；检查图使用辅助照明，不代表整场景构图或最终评分。最终只输出 selectedAssetSha256 和中文 reason，说明选择依据和残留，不要宣称通过独立视觉验收。',outputSchema:{type:'object',properties:{selectedAssetSha256:{type:'string',pattern:'^[a-f0-9]{64}$'},reason:{type:'string'}},required:['selectedAssetSha256','reason'],additionalProperties:false},resolveOutput:resolve,definitions:[{name:'preview_asset',description:'验证指定资产，在固定 ForgeaX Engine 中看真实形态与材质；不修改共享布局或原图。',inputSchema:{type:'object',properties:{assetJson:{type:'string'}},required:['assetJson'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}}],continuation:()=>({text:JSON.stringify({used:audit.used,limit:2,candidates:audit.attempts.filter((a:any)=>a.status==='rendered').map((a:any)=>({sha256:a.sha256})),scope:'恢复不会重置预览额度'}),images:audit.attempts.filter((a:any)=>a.status==='rendered').flatMap((a:any)=>a.frames.map((f:any)=>({path:join(folder,String(a.index),'capture',f.file),mime:'image/png'})))}),async call(name,args){
  if(name!=='preview_asset')throw Error('未知资产工具');signal.throwIfAborted();if(busy)throw Error('资产预览仍在进行');if(audit.used>=2)throw Error('资产预览上限已到，选择已查看候选');
  if(typeof args.assetJson!=='string'||args.assetJson.length>1500000)throw Error('资产 JSON 无效或过大');
  const value=JSON.parse(args.assetJson);validateAsset(value,brief,layout,textures);const sha256=digest(stable(value)),existing=find(sha256);if(existing)return {content:[{type:'text',text:JSON.stringify({sha256,scope:'复用本轮已看过的相同资产；不重复构建'})}]};
  busy=true;const row:any={index:audit.attempts.length+1,sha256,status:'running',startedAt:Date.now()};audit.used++;audit.attempts.push(row);save(file,audit);
  const dir=join(folder,String(row.index));mkdirSync(dir,{recursive:true});save(join(dir,'asset.json'),value);
  try{const scene=assetPreviewScene(value,brief,layout),surfaces=surfaceAudit(scene,textures);save(join(dir,'surface-audit.json'),surfaces);const images=await(options.render??renderRepairPreview)(scene,options.images,options.images.map(i=>digest(readFileSync(i.path))),dir,signal);const receipt=read(join(dir,'engine-preview-receipt.json'));row.frames=receipt.frames;row.receiptSha256=digest(readFileSync(join(dir,'engine-preview-receipt.json')));row.status='rendered';return {content:[{type:'text',text:JSON.stringify({sha256,surfaces,quality:'未独立评分，仅证明真实预览可用'})},...images]};}
  catch(e){row.status='failed';row.error=String(e);return {content:[{type:'text',text:row.error}],isError:true};}
  finally{busy=false;row.endedAt=Date.now();save(file,audit);}
 }};
 return {kit,assertReviewed(value:any){const hash=digest(stable(value)),row=find(hash);if(!row)throw Error('重要资产缺少与最终数据一致的实际预览');const dir=join(folder,String(row.index)),receiptFile=join(dir,'engine-preview-receipt.json');if(digest(readFileSync(receiptFile))!==row.receiptSha256||row.frames.some((f:any)=>digest(readFileSync(join(dir,'capture',f.file)))!==f.sha256))throw Error('资产预览证据已改变');return {assetSha256:hash,scope:'实际预览已核对，最终独立验收尚未进行',receipt:receiptFile,receiptSha256:row.receiptSha256};}};
}
