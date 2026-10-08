import {assertProceduralBudget} from './procedural-handoff';
import {assetTriangleBudget} from './triangle-budget';
import {mkdirSync,existsSync,readFileSync} from 'node:fs';
import {join,basename} from 'node:path';
import {read,save,digest} from '../store';
import {stable} from '../validated-cache';
import type {CodexToolKit,ToolContent} from '../codex-tools';
import {bindReferenceFrames} from './reference-framing';
import {readableBlockout} from './blockout-presentation';
import {assertVisibilityCamera} from './visibility-evidence';
import {renderRepairPreview} from './repair-engine-preview';
import {assertGrayboxPartHandoff,applyGrayboxLocalParts} from './graybox-local-parts';
import {referenceComposition,compositionContext,COMPOSITION_PROMPT} from './reference-composition';

export const GRAYBOX_SPACE_PREVIEW='graybox-space-preview-v8';
export const GRAYBOX_SPACE_PREVIEW_PROMPT='空间修正必须先调用 preview_graybox_space 查看候选的实际 ForgeaX Engine 画面。直接按工具输入字段提交完整局部补丁对象，不把JSON再编码为patchJson字符串；每个候选相对原始来源，不累积上一候选。最多两次实际预览，校验失败不耗预览次数，相同成功候选复用证据。templates必须为空，模板简报、UV、材质和身份数量冻结；parts最多4模板24部件，可调已有部件姿态，最多2模板6部件允许替换完整粗轮廓shape，其余shape省略或null。实际编译边界、净空、开口和预算仍检查；共享模板的轮廓会影响其全部实例，不能只看一个实例。不能只改简报而仍预览旧几何。先观察通道、占幅和纵深，不以大块填满画面冒充围合。看到候选后可再调整一次，最终只输出 selectedPatchSha256 和中文 reason，选择真实预览过的原始补丁；不能编造摘要或宣布独立评分通过。允许groups重建最多3个已有模板的内部粗结构（家具、建筑、机械或自然形体均使用相同几何契约，不强制使用枝冠），每模板最多8部件，保持原bounds/实体/预算；不能与parts重复修改同一模板。不手工逐叶逐花、不用背景板或隐藏主体，不假造未渲染几何。';
const selection={type:'object',properties:{selectedPatchSha256:{type:'string',pattern:'^[a-f0-9]{64}$'},reason:{type:'string',minLength:10,maxLength:1800}},required:['selectedPatchSha256','reason'],additionalProperties:false};
const text=(v:any):ToolContent=>({type:'text',text:JSON.stringify(v)});

/** A reviewed local patch must be the exact geometry later used by the normal graybox gate. */
export function createGrayboxSpacePreview(options:{space:any;sourceScene:any;observation?:any;contractVersion?:string;images:{path:string;mime:string}[];folder:string;signal:AbortSignal;schema:any;apply:(patch:any)=>any;buildScene:(space:any,patch:any)=>any;render?:typeof renderRepairPreview}){
 const {folder,signal}=options;mkdirSync(folder,{recursive:true});
 const version=options.contractVersion??GRAYBOX_SPACE_PREVIEW,measured=[GRAYBOX_SPACE_PREVIEW,'graybox-space-preview-v7','graybox-space-preview-v6','graybox-space-preview-v5','graybox-space-preview-v4','graybox-space-preview-v3'].includes(version);
 if(!measured&&version!=='graybox-space-preview-v2')throw Error('未知灰模预览证据契约');
 const contract=digest(stable({version,space:options.space,scene:options.sourceScene,images:options.images.map(i=>digest(readFileSync(i.path))),...(measured?{observation:options.observation??null}:{})}));
 const auditFile=join(folder,'graybox-preview-audit.json'),audit=existsSync(auditFile)?read(auditFile):{version,contract,used:0,attempts:[],...(measured?{measured:0,measurements:[]}:{})};
 if(audit.contract!==contract||audit.version!==version||!Number.isInteger(audit.used)||audit.used<0||audit.used>2)throw Error('灰模预览恢复契约或额度发生变化');
 if(measured&&(!Number.isInteger(audit.measured)||audit.measured<0||audit.measured>4||!Array.isArray(audit.measurements)||audit.measurements.length!==audit.measured))throw Error('灰模量化测量恢复额度无效');
 const sourceComposition=measured?referenceComposition(bindReferenceFrames(readableBlockout(options.sourceScene),options.images),options.observation):null;
 const measurements=new Map<string,any>();
 const composition=(scene:any)=>{const key=digest(stable(scene));if(!measurements.has(key))measurements.set(key,compositionContext(referenceComposition(scene,options.observation),sourceComposition));return measurements.get(key);};
 let busy=false;
 const apply=(patch:any)=>{if(![GRAYBOX_SPACE_PREVIEW,'graybox-space-preview-v7','graybox-space-preview-v6'].includes(version)&&patch.groups?.length)throw Error('历史灰模预览契约不能重建组群');if(!Array.isArray(patch?.templates)||patch.templates.length)throw Error('GRAYBOX_PREVIEW_GEOMETRY_FROZEN：templates必须为空；不能用旧几何证明新简报');if(![GRAYBOX_SPACE_PREVIEW,'graybox-space-preview-v7','graybox-space-preview-v6','graybox-space-preview-v5','graybox-space-preview-v4'].includes(version)&&patch.parts?.some(p=>Object.hasOwn(p,'shape')))throw Error('旧预览证据契约不能替换轮廓');const applied=options.apply(patch);applied.changes.parts=applyGrayboxLocalParts(options.sourceScene,applied.value,patch.parts,patch.groups??[],version===GRAYBOX_SPACE_PREVIEW).changed;return applied;};
 const find=(sha256:string)=>audit.attempts.find((r:any)=>r.patchSha256===sha256&&r.status==='rendered');
 const persist=()=>save(auditFile,audit);
 const build=(space:any,patch:any)=>{const scene=options.buildScene(space,patch);assertGrayboxPartHandoff(options.sourceScene,space,patch,scene);if([GRAYBOX_SPACE_PREVIEW,'graybox-space-preview-v7'].includes(version))assertProceduralBudget(scene,space);if(stable([scene.program,scene.cameras,scene.spatialContacts])===stable([options.sourceScene.program,options.sourceScene.cameras,options.sourceScene.spatialContacts]))throw Error('NO_ACTIONABLE_CHANGE：局部部件与空间均没有实际改变');return scene;};
 const verify=(row:any)=>{
  const dir=join(folder,String(row.index)),patch=read(join(dir,'patch.json'));
  if(digest(stable(patch))!==row.patchSha256)throw Error('灰模预览补丁摘要变化');
  const applied=apply(patch),canonical=build(applied.value,patch),scene=bindReferenceFrames(readableBlockout(canonical),options.images);
  if(digest(stable(applied.value))!==row.spaceSha256||digest(stable(canonical))!==row.canonicalSceneSha256||digest(JSON.stringify(scene))!==row.renderSceneSha256)throw Error('灰模预览空间或实际几何变化');
  if(digest(readFileSync(join(dir,'engine-preview-receipt.json')))!==row.receiptSha256)throw Error('灰模预览回执摘要变化');
  const receipt=read(join(dir,'engine-preview-receipt.json'));
  if(receipt.sceneSha256!==row.renderSceneSha256||receipt.frames?.length!==scene.cameras.length||receipt.report?.consoleErrors?.length||receipt.report?.pageErrors?.length)throw Error('灰模预览实际场景或机位不完整');
  receipt.frames.forEach((f:any,i:number)=>{
   if(basename(f.file)!==f.file||!/^candidate-\d+\.png$/.test(f.file)||f.referenceIndex!==scene.cameras[i].referenceIndex)throw Error('灰模预览机位身份变化');
   const bytes=readFileSync(join(dir,'capture',f.file));if(digest(bytes)!==f.sha256||bytes.length<24||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('灰模预览图片摘要变化');
   assertVisibilityCamera(scene.cameras[i],f.pose,i,bytes.readUInt32BE(16),bytes.readUInt32BE(20));
  });
  if(measured){const file=join(dir,'reference-composition.json');if(!row.compositionSha256||digest(readFileSync(file))!==row.compositionSha256||stable(read(file))!==stable(composition(scene)))throw Error('灰模构图测量与实际预览或原图目标不一致');}
  return {patch,applied,receipt,dir};
 };
 audit.attempts.filter((r:any)=>r.status==='rendered').forEach(verify);
 const content=(row:any)=>{const v=verify(row);return [text({patchSha256:row.patchSha256,spaceSha256:row.spaceSha256,changes:row.changes,used:audit.used,limit:2,views:v.receipt.frames.map((f:any)=>({file:f.file,referenceIndex:f.referenceIndex})),...(measured?{referenceComposition:read(join(v.dir,'reference-composition.json'))}:{}),quality:'实际修改反馈，未独立评分；最终仅选择此补丁摘要，不重复输出补丁'}),...v.receipt.frames.map((f:any)=>({type:'image' as const,mimeType:'image/png',data:readFileSync(join(v.dir,'capture',f.file)).toString('base64')}))];};
 const assertReviewed=(patch:any)=>{const row=find(digest(stable(patch)));if(!row)throw Error('GRAYBOX_PREVIEW_REQUIRED：只能保存与本轮成功实际预览一致的局部补丁');verify(row);return {patchSha256:row.patchSha256,spaceSha256:row.spaceSha256,canonicalSceneSha256:row.canonicalSceneSha256,renderSceneSha256:row.renderSceneSha256,receipt:join(folder,String(row.index),'engine-preview-receipt.json'),receiptSha256:row.receiptSha256,...(measured?{compositionSha256:row.compositionSha256}:{}),scope:'提交前真实灰模预览；独立空间及完整basic70仍待验证'};};
 const patchSchema={...options.schema,properties:{...options.schema.properties,templates:{...options.schema.properties.templates,maxItems:0}}};
 const patchInput=[GRAYBOX_SPACE_PREVIEW,'graybox-space-preview-v7','graybox-space-preview-v6','graybox-space-preview-v5'].includes(version)?patchSchema:{type:'object',properties:{patchJson:{type:'string',description:'完整局部补丁JSON字符串，templates必须为空。契约：'+JSON.stringify(patchSchema)}},required:['patchJson'],additionalProperties:false};
 const measureContent=(r:any)=>{const {patch,...summary}=r;return summary;};
 for(const r of audit.measurements??[]){const applied=apply(r.patch),canonical=build(applied.value,r.patch),scene=bindReferenceFrames(readableBlockout(canonical),options.images);if(digest(stable(r.patch))!==r.patchSha256||digest(stable(canonical))!==r.canonicalSceneSha256||stable(composition(scene))!==stable(r.referenceComposition))throw Error('灰模几何测量的来源或候选证据变化');}
 const kit:CodexToolKit={version,instructions:GRAYBOX_SPACE_PREVIEW_PROMPT+([GRAYBOX_SPACE_PREVIEW,'graybox-space-preview-v7'].includes(version)?'\n保留枝冠还必须满足每类详细资产额度（含实例倍率），细化不能删枝缩冠绕过；先在空间阶段留出细节余量。各模板额度：'+JSON.stringify(options.space.program.templates.map((b:any)=>({templateId:b.id,...assetTriangleBudget(options.space,b)}))):'')+(measured?'\n'+COMPOSITION_PROMPT+'\n可先调用measure_graybox_space，对同一完整补丁最多四个不同几何候选作零Engine构建的可见范围测量，检查冻结边界及较来源的变化；这只是编译几何预测，没有实际截图，不可最终选择。再选有依据的候选调用preview_graybox_space。两种工具都相对来源独立，不累积补丁。':''),outputSchema:selection,
  definitions:[{name:'preview_graybox_space',description:'按结构化完整补丁校验已有部件姿态与有界粗轮廓，在固定ForgeaX Engine查看参考及检查机位，最多两次。',inputSchema:patchInput,annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}},...(measured?[{name:'measure_graybox_space',description:'相同完整补丁契约；最多四个不同候选的编译几何可见范围测量，不构建Engine、不提供实际截图、不可最终选择。',inputSchema:patchInput,annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}}]:[])],
  resolveOutput(value:any){if(typeof value?.reason!=='string'||value.reason.trim().length<10)throw Error('需说明真实候选的选择依据与残留');const row=find(value.selectedPatchSha256);if(!row)throw Error('GRAYBOX_PREVIEW_REQUIRED：最终摘要不属于本轮真实预览，请调用preview_graybox_space，不能编造');const v=verify(row);return v.patch;},
  continuation:()=>({text:JSON.stringify({used:audit.used,limit:2,...(measured?{measurements:audit.measurements.map(measureContent),measurementUsed:audit.measured,measurementLimit:4}:{}),candidates:audit.attempts.filter((r:any)=>r.status==='rendered').map((r:any)=>{const v=verify(r);return {patchSha256:r.patchSha256,changes:r.changes,...(measured?{referenceComposition:read(join(v.dir,'reference-composition.json'))}:{})};}),recentAttempts:audit.attempts.slice(-2).map((r:any)=>({status:r.status,error:r.error??null,patchSha256:r.patchSha256})),instructions:'新CLI过程复用已有候选及图像，实际预览额度不重置；最终选择成功候选，仍非独立验收。'}),images:audit.attempts.filter((r:any)=>r.status==='rendered').flatMap((row:any)=>{const v=verify(row);return v.receipt.frames.map((f:any)=>({path:join(v.dir,'capture',f.file),mime:'image/png'}));})}),
  async call(name,args){
   signal.throwIfAborted();if(name!=='preview_graybox_space'&&!(measured&&name==='measure_graybox_space'))throw Error('未知灰模工具');if(busy)throw Error('灰模预览仍在运行');
   let patch;
   if([GRAYBOX_SPACE_PREVIEW,'graybox-space-preview-v7','graybox-space-preview-v6','graybox-space-preview-v5'].includes(version)){if(!args||typeof args!=='object'||Array.isArray(args)||JSON.stringify(args).length>100000)throw Error('灰模补丁须为结构化对象且不超过100000字符');patch=args;}
   else{if(typeof args.patchJson!=='string'||args.patchJson.length>100000)throw Error('灰模补丁JSON无效或过大');patch=JSON.parse(args.patchJson);}
   const applied=apply(patch),canonical=build(applied.value,patch),patchSha256=digest(stable(patch)),spaceSha256=digest(stable(applied.value)),canonicalSceneSha256=digest(stable(canonical)),prior=find(patchSha256)??audit.attempts.find((r:any)=>r.canonicalSceneSha256===canonicalSceneSha256&&r.status==='rendered');
   if(name==='measure_graybox_space'){
    let row=audit.measurements.find((r:any)=>r.canonicalSceneSha256===canonicalSceneSha256);
    if(!row){if(audit.measured>=4)throw Error('灰模几何测量已达四个候选上限；没有额外Engine预览或最终选择资格');const scene=bindReferenceFrames(readableBlockout(canonical),options.images);row={patch,patchSha256,canonicalSceneSha256,referenceComposition:composition(scene),quality:'geometry-prediction-only',images:0};audit.measured++;audit.measurements.push(row);persist();}
    return {content:[text({...measureContent(row),used:audit.measured,limit:4,instructions:'只有几何预测；必须再调用preview_graybox_space查看真实截图才可选择。'})]};
   }
   if(prior)return {content:content(prior)};
   if(audit.attempts.some((r:any)=>r.canonicalSceneSha256===canonicalSceneSha256&&r.status==='failed'))throw Error('GRAYBOX_PREVIEW_NO_NEW_CHANGE：相同空间候选已经失败，没有改变几何或运行条件，不重复预览');
   if(audit.used>=2)throw Error('灰模真实预览已达2次上限，选择已有成功候选或停止');
   const scene=bindReferenceFrames(readableBlockout(canonical),options.images),row:any={index:audit.attempts.length+1,status:'running',startedAt:Date.now(),patchSha256,spaceSha256,canonicalSceneSha256:digest(stable(canonical)),renderSceneSha256:digest(JSON.stringify(scene)),changes:applied.changes};
   busy=true;audit.used++;audit.attempts.push(row);persist();const dir=join(folder,String(row.index));mkdirSync(dir,{recursive:true});save(join(dir,'patch.json'),patch);save(join(dir,'space.json'),applied.value);save(join(dir,'scene.json'),canonical);save(join(dir,'render-scene.json'),scene);
   try{await(options.render??renderRepairPreview)(scene,options.images,options.images.map(i=>digest(readFileSync(i.path))),dir,signal);signal.throwIfAborted();row.receiptSha256=digest(readFileSync(join(dir,'engine-preview-receipt.json')));if(measured){save(join(dir,'reference-composition.json'),composition(scene));row.compositionSha256=digest(readFileSync(join(dir,'reference-composition.json')));}verify(row);row.status='rendered';persist();return {content:content(row)};}
   catch(e){row.status='failed';row.error=String(e);if(signal.aborted)throw e;return {isError:true,content:[text({error:row.error,used:audit.used,limit:2,quality:'未通过实际预览，不可选择此候选'})]};}
   finally{busy=false;row.endedAt=Date.now();row.durationMs=row.endedAt-row.startedAt;persist();}
  }};
 return {kit,assertReviewed};
}
