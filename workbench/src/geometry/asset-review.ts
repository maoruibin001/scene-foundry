import {assertProceduralHandoff} from './procedural-handoff';
import {join,dirname} from 'node:path';
import {mkdirSync,existsSync,readFileSync} from 'node:fs';
import {save,read,digest,runDir} from '../store';
import {stable} from '../validated-cache';
import type {CodexToolKit} from '../codex-tools';
import {contactSummary} from './contacts';
import {validateAllocatedAsset} from './asset-validation';
import {assetSchema} from './layout';
import {surfaceAudit} from './surface-audit';
import {renderRepairPreview} from './repair-engine-preview';
import {assetInspectionCameras} from './asset-inspection-cameras';
import {assetContextContract,assetContextScene,type AssetSceneContext} from './asset-scene-context';
function verifyReceipt(file:string,sha256:string,minimumFrames:number){
 if(digest(readFileSync(file))!==sha256)return false;
 const receipt=read(file);return receipt.frames?.length>=minimumFrames&&receipt.frames.every((f:any)=>digest(readFileSync(join(dirname(file),'capture',f.file)))===f.sha256);
}
export function verifyAssetReview(value:any,record:any,expectedContext?:string){
 try{
  if(!record||record.assetSha256!==digest(stable(value))||!verifyReceipt(record.receipt,record.receiptSha256,2))return false;
  if(expectedContext&&record.context?.contract!==expectedContext)return false;
  return !record.context||verifyReceipt(record.context.receipt,record.context.receiptSha256,1);
 }catch{return false;}
}
/** 独立资产真实预览；不拼造未生成的其余场景，不冒充整场景验收。 */
export function assetPreviewScene(value:any,brief:any,layout:any){
 const used=new Set(value.template.parts.map((p:any)=>p.material)),materials=layout.program.materials.filter((m:any)=>used.has(m.id)),textures=new Set(materials.map((m:any)=>m.textureId).filter(Boolean));
 const program={version:'geometry-v1',name:brief.label,materials,templates:[value.template],instances:[{id:'asset',label:brief.label,template:brief.id,position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],requirementIds:[]}]},inspection=assetInspectionCameras(program,brief);
 return {version:'scene-v1',program,entities:[{instanceId:'asset',role:'subject',category:'asset-inspection'}],spatialOpenings:[],textures:layout.textures.filter((t:any)=>textures.has(t.id)),textureReuse:(layout.textureReuse??[]).filter((t:any)=>textures.has(t.textureId)),cameras:inspection.cameras,lighting:{direction:[.4,-.6,-.7],color:[1,1,1],intensity:1.8,ambientColor:[1,1,1],ambientIntensity:.5,points:[]},assumptions:['独立资产检查机位和辅助照明，不是参考图机位或最终场景效果',...(inspection.detail?['稀疏细长构件使用两个局部细节机位；整体关系仍须在完整场景验收中判断']:[])]};
}
export function createAssetReview(options:{brief:any;layout:any;textures:any;images:any[];folder:string;signal:AbortSignal;context?:AssetSceneContext;acceptedScene?:any;voxel?:boolean;render?:typeof renderRepairPreview}){
 const {brief,layout,textures,folder,signal}=options;mkdirSync(folder,{recursive:true});
 const validate=(value:any)=>{assertProceduralHandoff(value,options.acceptedScene??options.context?.scene);return validateAllocatedAsset(value,brief,layout,textures);};
 const contextContract=options.context?assetContextContract(layout,options.context):null;
 const contractInputs:any[]=[brief,layout.program.materials,options.images.map(i=>digest(readFileSync(i.path)))];if(contextContract)contractInputs.push(contextContract);
 const file=join(folder,'asset-preview-audit.json'),contract=digest(stable(contractInputs));
 const audit=existsSync(file)?read(file):{contract,attempts:[],used:0};if(audit.contract!==contract)throw Error('资产预览恢复契约发生变化');
 let busy=false;
 const find=(hash:string)=>audit.attempts.find((a:any)=>a.sha256===hash&&a.status==='rendered');
 const resolve=(v:any)=>{const row=find(v?.selectedAssetSha256);if(!row||!v.reason?.trim())throw Error('必须选择本轮已真实预览的资产并说明依据；可用摘要：'+JSON.stringify(audit.attempts.filter((a:any)=>a.status==='rendered').map((a:any)=>a.sha256))+'。没有候选时须先成功调用 preview_asset，不得编造摘要。');const value=read(join(folder,String(row.index),'asset.json'));if(digest(stable(value))!==row.sha256)throw Error('资产预览候选摘要变化');validate(value);return value;};
 const kit:CodexToolKit={version:contextContract?'asset-preview-context-v2':'asset-preview-v1',instructions:'先调用 preview_asset 查看本次资产在 ForgeaX Engine 的两个独立检查机位。assetJson 是完整 asset-geometry-v1 JSON。预览前检查与最终保存相同的三角形分配额度；校验失败不消耗实际预览次数。最多两次实际预览，按原图局部依据修正可见轮廓、厚度、曲面、UV与磨损；检查图使用辅助照明，不代表整场景构图或最终评分。最终只输出 selectedAssetSha256 和中文 reason，说明选择依据和残留，不要宣称通过独立视觉验收。'+(contextContract?' 每次候选还追加一张原参考机位的场景上下文，放在两张独立图之后：彩色部分为当前资产的实际实例，其余是已验收灰模。保持原位、实例表面配置与计划灯光，用于发现相对尺度、遮挡和轮廓不足；灰模邻居不等于最终成品，不能凭此宣布全场通过。最多仍是两个候选，不增加模型调用。':''),outputSchema:{type:'object',properties:{selectedAssetSha256:{type:'string',pattern:'^[a-f0-9]{64}$'},reason:{type:'string'}},required:['selectedAssetSha256','reason'],additionalProperties:false},resolveOutput:resolve,definitions:[{name:'preview_asset',description:'验证指定资产，在固定 ForgeaX Engine 中看真实形态与材质；不修改共享布局或原图。',inputSchema:{type:'object',properties:{assetJson:{type:'string',description:'将完整资产对象编码为 JSON 字符串，严格遵守以下几何契约：'+JSON.stringify(assetSchema(options.voxel))}},required:['assetJson'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}}],continuation:()=>({text:JSON.stringify({used:audit.used,limit:2,candidates:audit.attempts.filter((a:any)=>a.status==='rendered').map((a:any)=>({sha256:a.sha256})),scope:'恢复不会重置预览额度'}),images:audit.attempts.filter((a:any)=>a.status==='rendered').flatMap((a:any)=>[...a.frames.map((f:any)=>({path:join(folder,String(a.index),'capture',f.file),mime:'image/png'})),...(a.context?read(a.context.receipt).frames.map((f:any)=>({path:join(dirname(a.context.receipt),'capture',f.file),mime:'image/png'})):[])])}),async call(name,args){
  if(name!=='preview_asset')throw Error('未知资产工具');signal.throwIfAborted();if(busy)throw Error('资产预览仍在进行');if(audit.used>=2)throw Error('资产预览上限已到，选择已查看候选');
  if(typeof args.assetJson!=='string'||args.assetJson.length>1500000)throw Error('资产 JSON 无效或过大');
  const value=JSON.parse(args.assetJson),measured=validate(value),contacts=contactSummary(measured.contacts);const sha256=digest(stable(value)),existing=find(sha256);if(existing)return {content:[{type:'text',text:JSON.stringify({sha256,triangles:measured.triangles,triangleBudget:measured.budget,contacts,scope:'复用本轮已看过的相同资产；不重复构建'})}]};
  busy=true;const row:any={index:audit.attempts.length+1,sha256,status:'running',startedAt:Date.now()};audit.used++;audit.attempts.push(row);save(file,audit);
  const dir=join(folder,String(row.index));mkdirSync(dir,{recursive:true});save(join(dir,'asset.json'),value);
  try{const scene=assetPreviewScene(value,brief,layout),surfaces=surfaceAudit(scene,textures);save(join(dir,'surface-audit.json'),surfaces);save(join(dir,'spatial-contacts.json'),measured.contacts);const images=await(options.render??renderRepairPreview)(scene,options.images,options.images.map(i=>digest(readFileSync(i.path))),dir,signal);const receipt=read(join(dir,'engine-preview-receipt.json'));row.frames=receipt.frames;row.receiptSha256=digest(readFileSync(join(dir,'engine-preview-receipt.json')));
   let contextEvidence:any=null;
   if(options.context){
    const context=assetContextScene(value,brief,layout,options.context),contextDir=join(dir,'context');mkdirSync(contextDir,{recursive:true});
    save(join(contextDir,'scene.json'),context.scene);save(join(contextDir,'handoff.json'),context.handoff);
    const frames=await(options.render??renderRepairPreview)(context.scene,options.images,options.images.map(i=>digest(readFileSync(i.path))),contextDir,signal);
    const receiptFile=join(contextDir,'engine-preview-receipt.json');row.context={contract:contextContract,receipt:receiptFile,receiptSha256:digest(readFileSync(receiptFile))};
    if(!verifyReceipt(receiptFile,row.context.receiptSha256,1))throw Error('资产上下文预览证据无效');
    images.push(...frames);contextEvidence={...context.handoff,placeholderTemplateIds:context.placeholderTemplateIds,imageOrder:'前两张为独立辅助照明检查；最后一张是参考机位中的真实资产实例和灰模邻居，尚未完整验收'};
   }
   row.status='rendered';return {content:[{type:'text',text:JSON.stringify({sha256,triangles:measured.triangles,triangleBudget:measured.budget,surfaces,contacts,context:contextEvidence,quality:'未独立评分，仅证明真实预览可用'})},...images]};}
  catch(e){row.status='failed';row.error=String(e);return {content:[{type:'text',text:row.error}],isError:true};}
  finally{busy=false;row.endedAt=Date.now();save(file,audit);}
 }};
 return {kit,async restoreFailedPreview(job:any){
  // Reuse only the immediately recorded recovery source and identical frozen
  // layout. This does not accept the old failed preview or invent a verdict:
  // render it again, then give the actual new images to the model for selection.
  if(audit.attempts.length||!job.recoverySourceJobId)return false;
  const sourceDir=runDir(job.recoverySourceJobId),source=read(join(sourceDir,'job.json'));
  if((source.executionRecoveryRoot??source.id)!==(job.executionRecoveryRoot??job.id)||source.reuseMode!==job.reuseMode||source.prompt!==job.prompt||stable(source.images)!==stable(job.images)||stable(source.modelSettings)!==stable(job.modelSettings))return false;
  const generation=join(sourceDir,'generation'),layoutFile=join(generation,'layout.json');
  if(!existsSync(layoutFile)||stable(read(layoutFile))!==stable(layout))return false;
  const priorFolder=join(generation,'assets',brief.id,'visual-check'),priorFile=join(priorFolder,'asset-preview-audit.json');
  if(!existsSync(priorFile))return false;
  const prior=read(priorFile);if(prior.contract!==contract)return false;
  const row=[...prior.attempts].reverse().find((a:any)=>a.status==='failed'&&String(a.error).includes('browser-capture-runtime-failed'));
  if(!row||!Number.isInteger(row.index)||row.index<1)return false;
  const value=read(join(priorFolder,String(row.index),'asset.json'));
  if(digest(stable(value))!==row.sha256)throw Error('待恢复资产预览数据摘要变化');
  validate(value);
  const result=await kit.call('preview_asset',{assetJson:JSON.stringify(value)});
  if(result.isError)throw Error('ASSET_PREVIEW_RESTORE_FAILED：'+result.content.filter(c=>c.type==='text').map(c=>(c as any).text).join('\n'));
  save(join(folder,'restored-preview.json'),{sourceJobId:source.id,sourceVersion:source.pipelineVersion,sourceAttempt:row.index,assetSha256:row.sha256,renderedAt:Date.now(),modelSelection:'pending',scope:'复用已有几何并重新实际预览；仍须本轮模型依据真实检查图选择'});
  return true;
 },assertReviewed(value:any){
  validate(value);const hash=digest(stable(value)),row=find(hash);if(!row)throw Error('重要资产缺少与最终数据一致的实际预览');
  const receiptFile=join(folder,String(row.index),'engine-preview-receipt.json');
  const record={assetSha256:hash,scope:'实际预览已核对，最终独立验收尚未进行',receipt:receiptFile,receiptSha256:row.receiptSha256,...(row.context?{context:row.context}:{})};
  if(!verifyAssetReview(value,record,contextContract??undefined))throw Error('资产预览证据已改变或缺少当前场景上下文');
  return record;
 }};
}
