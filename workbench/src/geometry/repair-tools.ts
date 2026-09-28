import {surfaceAudit} from './surface-audit';
import {inspectVisualRegion,validateRegion} from './visual-region';
import {mkdirSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {ROOT,DATA,save,digest} from '../store';
import {stable} from '../validated-cache';
import type {CodexToolKit,ToolContent} from '../codex-tools';
import {sceneVisibility,visibilityContext} from './visibility';
import {cameraPreflight} from './camera-preflight';
import {renderRepairPreview} from './repair-engine-preview';
import {reviewedCandidates,REVIEWED_SELECTION_SCHEMA} from './reviewed-candidates';
import {previewPerformance} from './preview-performance';

export const REPAIR_TOOL_VERSION='repair-feedback-v5';
export const REPAIR_TOOL_PROMPT='本次提供 scene_feedback 专用工具。可以查询已有部件，用 check_scene_patch 计算完整候选补丁的结构、机位净空和所有机位的投影；用 render_scene_patch 查看同一候选在 ForgeaX Engine 中的真实画面。首次检查或直接预览时提交完整 scene-refinement-v5 JSON 字符串，均相对原始场景应用，不累积上次修改。check_scene_patch返回patchSha256后，render_scene_patch优先仅传patchSha256引用本轮已检查补丁，无需重写大型JSON；只有候选改变时再传完整patchJson，两者不能同时提供。观察工具返回画面后可改进，最终只输出 {"selectedPatchSha256":"成功预览返回的64位摘要","reason":"中文选择理由"}，不重复输出完整补丁；管线按摘要取回原始补丁，重新校验后继续。可用 inspect_visual_region 选择某参考图及对应渲染区域，按顺序查看原图、来源场景、最近一次成功预览的局部像素与明暗分布。坐标分别基于完整原图和完整渲染图，包含原图黑边，不能照抄同一矩形假定对应物体；源图和候选同区域也未自动对齐。主要破损、布褶、纹理与日光层次难以判断时，先放大检查，再修改。灰度统计不是质量分，不能靠匹配亮度冒充还原。最多查询部件8次、局部看图6次、几何检查6次、真实预览2次；不要求用完。工具图不代表验收通过；不得调评分、删除需求或调用其他工具。';
const patchInput={type:'object',properties:{patchJson:{type:'string',description:'完整 scene-refinement-v5 补丁的 JSON 字符串；相对原始场景应用。'}},required:['patchJson'],additionalProperties:false};
const renderInput={type:'object',properties:{patchJson:{type:'string',description:'新候选完整JSON；与patchSha256二选一。'},patchSha256:{type:'string',pattern:'^[a-f0-9]{64}$',description:'本轮已通过检查或预览的候选摘要；避免重写相同补丁。'}},additionalProperties:false,anyOf:[{required:['patchJson']},{required:['patchSha256']}]};
const text=(value:any):ToolContent=>({type:'text',text:JSON.stringify(value)});
export function createRepairTools(options:{source:any;textures:any;folder:string;signal:AbortSignal;images:{path:string;mime:string}[];refs:string[];validate:(patch:any)=>any;apply:(patch:any)=>any;render?:typeof renderRepairPreview;sourceFrames?:{referenceIndex:number;path:string}[];inspectRegion?:typeof inspectVisualRegion;onEvent?:(message:string)=>void}){
 const {source,textures,folder,signal}=options;mkdirSync(folder,{recursive:true});
 const counts={inspect_visual_region:0,inspect_scene_parts:0,check_scene_patch:0,render_scene_patch:0,enginePreviews:0},limits={inspect_visual_region:6,inspect_scene_parts:8,check_scene_patch:6,render_scene_patch:8};
 const audited:any[]=[],reviewed=reviewedCandidates({folder,validate:options.validate,apply:options.apply});let busy=false;let latestFrames:{referenceIndex:number;path:string}[]=[];
 const auditFile=join(folder,'tool-audit.json');
 if(existsSync(auditFile)){
  const prior=JSON.parse(readFileSync(auditFile,'utf8'));
  if(prior.sourceSha256!==digest(stable(source)))throw Error('工具恢复来源场景发生变化');
  for(const key of Object.keys(counts) as (keyof typeof counts)[]){if(!Number.isInteger(prior.counts?.[key])||prior.counts[key]<0)throw Error('工具恢复额度无效');counts[key]=prior.counts[key];}
  audited.push(...prior.attempts);
  for(const row of audited.filter(r=>r.name==='render_scene_patch'&&r.status==='passed')){
   reviewed.add(row,true);
   const dir=join(folder,String(row.index)),receipt=JSON.parse(readFileSync(join(dir,'engine-preview-receipt.json'),'utf8'));
   latestFrames=receipt.frames.filter((f:any)=>Number.isInteger(f.referenceIndex)&&f.referenceIndex>0).map((f:any)=>({referenceIndex:f.referenceIndex,path:join(dir,'capture',f.file)}));
  }
 }
 const persist=()=>save(auditFile,{version:REPAIR_TOOL_VERSION,sourceSha256:digest(stable(source)),counts,limits,attempts:audited,renderedPatchHashes:reviewed.hashes(),quality:'not-assessed'});
 const regionSchema={type:'array',items:{type:'number',minimum:0,maximum:1},minItems:4,maxItems:4};
 const definitions=[
  {name:'inspect_visual_region',description:'放大比较原始参考图、来源场景和最近成功候选的对应区域；只读真实像素，明暗统计不参与评分。',inputSchema:{type:'object',properties:{referenceIndex:{type:'integer',minimum:1},referenceRect:regionSchema,frameRect:regionSchema},required:['referenceIndex','referenceRect','frameRect'],additionalProperties:false}},
  {name:'inspect_scene_parts',description:'读取原场景指定模板/部件的真实数据和所在实例；partIds为空按offset分页返回16项，带nextOffset。不修改内容。',inputSchema:{type:'object',properties:{templateId:{type:'string'},partIds:{type:'array',items:{type:'string'},maxItems:16},offset:{type:'integer',minimum:0}},required:['templateId','partIds'],additionalProperties:false}},
  {name:'check_scene_patch',description:'先验证完整补丁，再计算各机位真实三角形的遮挡与净空，返回编号诊断图；不模拟颜色或光照。',inputSchema:patchInput},
  {name:'render_scene_patch',description:'验证并构建候选，在固定 ForgeaX Engine 中采集全部参考机位。可仅传已检查的patchSha256。大约1至3分钟；这是修改反馈，不是最终评分。',inputSchema:renderInput}
 ];
 for(const tool of definitions)(tool as any).annotations={readOnlyHint:false,destructiveHint:false,openWorldHint:false,idempotentHint:false};
 const kit:CodexToolKit={version:REPAIR_TOOL_VERSION,instructions:REPAIR_TOOL_PROMPT,definitions,outputSchema:REVIEWED_SELECTION_SCHEMA,resolveOutput:reviewed.resolve,continuation:()=>{
  const saved=reviewed.context();return {text:JSON.stringify({counts,limits,enginePreviewsRemaining:Math.max(0,2-counts.enginePreviews),candidates:saved.candidates,instructions:'以下附图依候选顺序排列。恢复不会重置额度。已有候选必须比较其实际画面；若额度用完，选择现有候选，不重新生成或重复提交大补丁。最终只输出selectedPatchSha256与中文reason，管线取回原始补丁并重新校验。尚未独立评分，不宣称提分。'}),images:saved.images};
 },async call(name,args){
  signal.throwIfAborted();if(!(name in limits))throw Error('未知修复工具');if(busy)throw Error('前一次工具尚未结束，请等候结果');
  const key=name as keyof typeof limits;if(counts[key]>=limits[key])throw Error('本轮该工具已达上限；停止该尝试，保留已通过预览的候选');counts[key]++;busy=true;
  const row:any={index:audited.length+1,name,startedAt:Date.now(),status:'running'};audited.push(row);persist();options.onEvent?.(({inspect_visual_region:'对照局部真实像素',inspect_scene_parts:'查询原始部件',check_scene_patch:'检查候选几何',render_scene_patch:'请求候选预览'})[key]+' · 开始');
  const dir=join(folder,String(row.index));mkdirSync(dir,{recursive:true});
  try{
   if(name==='inspect_visual_region'){
    row.query={referenceIndex:args.referenceIndex,referenceRect:args.referenceRect,frameRect:args.frameRect};persist();
    if(!Number.isInteger(args.referenceIndex)||args.referenceIndex<1||args.referenceIndex>options.images.length)throw Error('参考图编号不存在');
    const referenceRect=validateRegion(args.referenceRect),frameRect=validateRegion(args.frameRect),sourceFrame=options.sourceFrames?.find(f=>f.referenceIndex===args.referenceIndex),latestFrame=latestFrames.find(f=>f.referenceIndex===args.referenceIndex);
    if(!sourceFrame)throw Error('此参考图缺少来源场景实际机位截图，不猜测机位对应');
    const selected=[{label:'原始参考图',path:options.images[args.referenceIndex-1].path,rect:referenceRect},{label:'修复前实际场景',path:sourceFrame.path,rect:frameRect},...(latestFrame?[{label:'最近一次成功候选',path:latestFrame.path,rect:frameRect}]:[])];
    const content=await(options.inspectRegion??inspectVisualRegion)(selected,dir,signal);row.status='passed';return {content};
   }
   if(name==='inspect_scene_parts'){
    row.query={templateId:args.templateId,partIds:args.partIds,offset:args.offset??0};persist();
    if(typeof args.templateId!=='string')throw Error('templateId必须是字符串');
    if(!Array.isArray(args.partIds)||!args.partIds.every((x:any)=>typeof x==='string'))throw Error('partIds必须是字符串数组');
    if(args.partIds.length>16)throw Error('partIds最多16项；可用空数组和offset分页查询');
    const offset=args.offset??0;if(!Number.isInteger(offset)||offset<0)throw Error('offset必须为非负整数');
    const template=source.program.templates.find((t:any)=>t.id===args.templateId);if(!template)throw Error('模板不存在');
    if(args.partIds.some((id:string)=>!template.parts.some((p:any)=>p.id===id)))throw Error('查询了不存在的部件');
    const paged=!args.partIds.length,parts=paged?template.parts.slice(offset,offset+16):template.parts.filter((p:any)=>args.partIds.includes(p.id));
    const content=[text({templateId:template.id,partIds:template.parts.map((p:any)=>p.id),parts,nextOffset:paged&&offset+16<template.parts.length?offset+16:null,instances:source.program.instances.filter((i:any)=>i.template===template.id)})];row.status='passed';return {content};
   }
   let patchJson=args.patchJson;
   if(args.patchSha256!==undefined){
    if(name!=='render_scene_patch'||patchJson!==undefined||typeof args.patchSha256!=='string'||!/^[a-f0-9]{64}$/.test(args.patchSha256))throw Error('仅预览可引用摘要，且不能同时传入补丁');
    const prior=audited.find(r=>r.index<row.index&&['check_scene_patch','render_scene_patch'].includes(r.name)&&r.status==='passed'&&r.patchSha256===args.patchSha256);
    if(!prior)throw Error('摘要不属于本轮已通过检查的候选');
    patchJson=readFileSync(join(folder,String(prior.index),'patch.json'),'utf8');
    if(digest(stable(JSON.parse(patchJson)))!==args.patchSha256)throw Error('已检查候选内容发生变化');
    row.reusedCheckedPatch={index:prior.index,sha256:args.patchSha256};
   }
   if(typeof patchJson!=='string'||patchJson.length>1500000)throw Error('补丁必须为有限大小的完整JSON字符串');
   const patch=JSON.parse(patchJson);row.patchSha256=digest(stable(patch));save(join(dir,'patch.json'),patch);
   options.validate(patch);const next=options.apply(patch);row.sceneSha256=digest(stable(next));save(join(dir,'scene.json'),next);
   let content:ToolContent[];
   if(name==='check_scene_patch'){
    const report=sceneVisibility(next,textures);save(join(dir,'visibility.json'),report);
    const p=Bun.spawnSync([join(DATA,'reconstruction-env/bin/python'),join(ROOT,'src/geometry/visibility-map.py'),join(dir,'visibility.json')],{stdout:'pipe',stderr:'pipe',timeout:30000});
    if(p.exitCode)throw Error('投影图绘制失败：'+new TextDecoder().decode(p.stderr).slice(-1000));
    content=[text({kind:'geometry-diagnostic',surfaceAudit:surfaceAudit(next,textures),patchSha256:row.patchSha256,cameras:cameraPreflight(next),...visibilityContext(report)}),...report.views.map((_,i)=>({type:'image' as const,mimeType:'image/png',data:readFileSync(join(dir,`visibility-${i+1}.png`)).toString('base64')}))];
   }else{
    if(counts.enginePreviews>=2)throw Error('本轮真实Engine预览已达2次上限，请返回已预览候选');counts.enginePreviews++;row.enginePreview=counts.enginePreviews;persist();
    content=[text({kind:'ForgeaX Engine实际候选预览',patchSha256:row.patchSha256,views:next.cameras.map((c:any)=>({name:c.name,referenceIndex:c.referenceIndex})),quality:'未评分，最终只提交此候选摘要与选择理由，不要重复输出完整补丁'}),...await(options.render??renderRepairPreview)(next,options.images,options.refs,dir,signal)];reviewed.add(row);
    const receiptFile=join(dir,'engine-preview-receipt.json');
    if(existsSync(receiptFile)){const receipt=JSON.parse(readFileSync(receiptFile,'utf8'));const performance=previewPerformance(receipt.frames);save(join(dir,'preview-performance.json'),performance);content.push(text({performance}));latestFrames=receipt.frames.filter((f:any)=>Number.isInteger(f.referenceIndex)&&f.referenceIndex>0).map((f:any)=>({referenceIndex:f.referenceIndex,path:join(dir,'capture',f.file)}));}

   }
   row.status='passed';return {content};
  }catch(error){row.status='failed';row.error=String(error);return {content:[text({error:String(error),counts,limits,quality:'not-assessed'})],isError:true};}
  finally{row.endedAt=Date.now();row.durationMs=row.endedAt-row.startedAt;busy=false;persist();options.onEvent?.('修复反馈 '+name+' · '+(row.status==='passed'?'完成':'未通过：'+row.error)+' · '+Math.round(row.durationMs/1000)+'秒');}
 }};
 return {kit,assertReviewed(patch:any){if(!reviewed.has(patch))throw Error('REPAIR_PREVIEW_REQUIRED：最终补丁与成功的 Engine 候选预览不一致。先预览该补丁，或选择已成功预览的候选，不可声称未执行的自检。');},counts};
}
