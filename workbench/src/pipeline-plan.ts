import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const compilerSha256=createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex');

export const PIPELINE_PLAN_VERSION='scene-pipeline-plan-v1';
export const PIPELINE_DIMENSIONS=[
 {id:'coverage',label:'需求完整'},{id:'spatial',label:'空间关系'},{id:'shape',label:'模型形态'},
 {id:'material',label:'材质表面'},{id:'lighting',label:'光照'},{id:'readability',label:'画面效果'},
] as const;
export type PresetId='balanced'|'spatial'|'assets'|'effects';
export type ScoreWeights=Record<typeof PIPELINE_DIMENSIONS[number]['id'],number>;
const weights=(values:number[])=>Object.fromEntries(PIPELINE_DIMENSIONS.map((d,i)=>[d.id,values[i]])) as ScoreWeights;
const definitions={
 balanced:{label:'均衡',description:'完整空间、主体、表面与画面均衡制作。',weights:weights([20,30,15,15,10,10]),focus:['spatial','shape','material','lighting'],parallelSurface:true,assetVisualChecks:2},
 spatial:{label:'空间布局优先',description:'重点核对位置、比例、遮挡、开口、接触及各参考机位。',weights:weights([20,45,15,8,5,7]),focus:['spatial','coverage'],parallelSurface:false,assetVisualChecks:3},
 assets:{label:'模型材质优先',description:'重点制作主体轮廓、曲面、部件、UV与真实PBR响应。',weights:weights([20,15,30,25,5,5]),focus:['shape','material'],parallelSurface:true,assetVisualChecks:4},
 effects:{label:'成图效果优先',description:'固定已验布局和参考机位，重点修正光照、阴影、色彩与画面层次。',weights:weights([20,15,10,15,25,15]),focus:['lighting','readability','material'],parallelSurface:false,assetVisualChecks:2},
} as const;
export const PIPELINE_CAPABILITIES=[
 {id:'space-measure-fit',version:'graybox-fit-v1',state:'ready',label:'空间测量与拟合',scope:'灰模测量、有限数值拟合与真实空间验收'},
 {id:'asset-program',version:'geometry-v1',state:'ready',label:'程序模型创建',scope:'曲面、部件、分块保存、几何预算与真实预览'},
 {id:'licensed-pbr',version:'texture-bundle-v1',state:'ready',label:'照片与许可PBR',scope:'参考图取材、UV与固定两项CC0成套材质；不是通用丰富资源库'},
 {id:'lighting',version:'scene-lighting-v1',state:'ready',label:'灯光与阴影',scope:'目标Engine方向/点/聚光、阴影、曝光和静态探针；不提供GI或精确平面反射'},
 {id:'scene-render',version:'engine-evidence-v1',state:'ready',label:'真实多机位预览',scope:'同候选构建、真实Engine画面、性能与硬检查'},
 {id:'external-glb',version:'unavailable',state:'unavailable',label:'外部GLB与生成服务',scope:'当前普通管线尚未接入，不能由预设静默启用'},
] as const;
const toolIds=['space-measure-fit','asset-program','licensed-pbr','lighting','scene-render'];
const canonical=(v:any):any=>v===undefined?null:v===null||typeof v!=='object'?v:Array.isArray(v)?v.map(canonical):Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));
const hash=(v:any)=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
export function validateScoreWeights(input:any):ScoreWeights {
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==PIPELINE_DIMENSIONS.length||PIPELINE_DIMENSIONS.some(d=>!Number.isInteger(input[d.id])||input[d.id]<0||input[d.id]>100)||Object.keys(input).some(k=>!PIPELINE_DIMENSIONS.some(d=>d.id===k)))throw Error('评分权重须为六个维度的0–100整数');
 if(Object.values(input).reduce((n:number,v:any)=>n+v,0)!==100)throw Error('评分权重合计须为100%');
 return weights(PIPELINE_DIMENSIONS.map(d=>input[d.id]));
}
export function pipelineChoice(input:any){
 if(input.pipelinePreset===undefined&&input.scoreWeights===undefined)return undefined;
 if(!Object.hasOwn(definitions,input.pipelinePreset))throw Error('请选择受支持的固定制作管线');
 if(input.sceneKind==='voxel'||input.nativeCase)throw Error('固定制作预设目前只适用于普通场景');
 const presetId=input.pipelinePreset as PresetId;
 return {pipelinePreset:presetId,scoreWeights:validateScoreWeights(input.scoreWeights??definitions[presetId].weights)};
}
export function pipelinePresetCatalog(){return {version:PIPELINE_PLAN_VERSION,dimensions:PIPELINE_DIMENSIONS,presets:Object.entries(definitions).map(([id,p])=>({id,...structuredClone(p),tools:toolIds})),capabilities:PIPELINE_CAPABILITIES,customPipeline:'deferred',weightsCalibrated:false};}
export type PipelinePlan=ReturnType<typeof compilePipelinePlan>;
export function compilePipelinePlan(input:any,context:{engineSha:string;generatorSha:string;modelSettings?:any}){
 const choice=pipelineChoice(input);if(!choice)return undefined;
 const p=definitions[choice.pipelinePreset],parallelSurface=p.parallelSurface&&(input.matchingLevel??'standard')==='standard';
 const stage=(id:string,label:string,dependsOn:string[],tools:string[],reason:string)=>({id,label,dependsOn,tools,reason,contractId:hash({version:PIPELINE_PLAN_VERSION,id,preset:choice.pipelinePreset,weights:choice.scoreWeights,tools:PIPELINE_CAPABILITIES.filter(t=>tools.includes(t.id)),context})});
 const stages=[
  stage('plan','需求与目标规划',[],[],'保留关键要求及逐维证据；权重不改变原始维度评分'),
  stage('observe','逐图观察',['plan'],[],'建立所有参考图的对象、遮挡与机位证据'),
  stage('space','空间规划',['observe'],['space-measure-fit'],'共享位置、尺度、接触与开口'),
  stage('blockout','真实灰模验收',['space'],['space-measure-fit','scene-render'],'空间3.5门槛与关键关系不随权重取消'),
  stage('surface','材质与光照规划',[parallelSurface?'space':'blockout'],['licensed-pbr','lighting'],parallelSurface?'可与灰模并行，布局改变后按最终空间重规划':'等待空间接受，固定布局与参考机位再规划外观'),
  stage('materials','贴图与PBR处理',['blockout','surface'],['licensed-pbr'],'核对来源、真实通道、UV尺度与颜色空间'),
  stage('assets','详细模型创建',['blockout','materials'],['asset-program','scene-render'],'全部资产齐全；重点资产选择与预览按冻结偏好分配'),
  stage('runtime','组装与真实运行',['assets'],['scene-render'],'原参考机位、完整场景、性能和错误检查'),
  stage('judge','六维独立评审',['runtime'],[],'独立原始分和实现分，再按用户权重分别汇总'),
  stage('repair',p.label+'修正',['judge'],toolIds,'先关闭共同底线失败，再按权重与实际失分排序；连续无改善停止'),
 ];
 const body={version:PIPELINE_PLAN_VERSION,compilerSha256,presetId:choice.pipelinePreset,label:p.label,description:p.description,weights:choice.scoreWeights,focus:[...p.focus],tools:toolIds,capabilities:PIPELINE_CAPABILITIES,stages,
  resources:{parallelSurface,assetVisualChecks:p.assetVisualChecks,assetPreviewCandidates:2,modelSettings:context.modelSettings??null,stageReasoning:'existing-phase-capped',callsPolicy:'inherits-user-cumulative-policy',noGain:2,minGain:2},
  scoring:{version:'scene-quality-v8',standard:'profile70',minimumScore:70,rawMinimumScore:70,independentDimensions:true,history:'original receipts immutable'},
  commonChecks:['complete-assets','critical-requirements','spatial-3.5','engine-hard-checks','trusted-evidence','required-specification','no-count-contradictions'],
  protectedDimensions:['coverage','spatial','shape'],engineSha:context.engineSha,generatorSha:context.generatorSha,
 };
 return {id:hash(body),...body};
}
export function pipelineGuidance(job:any){
 const p=job.pipelinePlan;if(!p)return '';
 return '本任务固定制作管线为'+p.label+'。实际重点：'+p.description+'。评分权重：'+JSON.stringify(p.weights)+'。所有主体、关键结构与运行检查必须通过。先独立观察与评审，再加权，不按权重猜分。外部GLB/生成工具未接入，不调用未知工具。成图与表面修正保留已验布局及全部参考机位，只有共同底线仍失败且有明确证据时才修结构。';
}
/** Allocation consumes actual scene roles and bindings, never scene-name keywords. */
export function prioritizePipelineAssets(ranked:any[],layout:any,job:any){
 if(!job.pipelinePlan)return ranked;
 const weights=job.pipelinePlan.weights;
 const subjects=new Set((layout.entities??[]).filter((e:any)=>e.role==='subject').map((e:any)=>e.instanceId));
 return ranked.map(row=>{
  const instances=layout.program.instances.filter((i:any)=>i.template===row.brief.id),subject=instances.some((i:any)=>subjects.has(i.id));
  const structural=(layout.spatialContacts??[]).some((r:any)=>[r.aId,r.bId].some((id:string)=>instances.some((i:any)=>i.id===id)))||(layout.spatialOpenings??[]).some((r:any)=>instances.some((i:any)=>i.id===r.instanceId));
  const priority=row.priority+(subject?(weights.shape+weights.material)/4:0)+(structural?weights.spatial/4:0);
  return {...row,priority,pipelinePriority:{planId:job.pipelinePlan.id,subject,structural,weights}};
 }).sort((a,b)=>b.priority-a.priority||a.index-b.index);
}
/** Rank the model's evidenced goals; do not invent or silently discard necessary repairs. */
export function prioritizePipelineRepairs(goals:any,job:any,review:any,plan:any){
 if(!job.pipelinePlan)return goals;
 const raw=review.dimensions??[],required=new Set(plan.requirements.filter((r:any)=>r.critical&&(review.requirements??[]).find((v:any)=>v.id===r.id)?.verdict==='missing').map((r:any)=>r.id));
 const ranked=goals.goals.map((g:any,index:number)=>{
  const score=raw.find((d:any)=>d.id===g.dimension)?.score;
  const weightedDeficit=Number.isFinite(score)?job.pipelinePlan.weights[g.dimension]*(5-score)/5:0;
  const common=g.requirementIds?.some((id:string)=>required.has(id))||['layout','opening'].includes(g.kind)&&job.commonDeliveryAssessment?.status==='failed';
  return {goal:g,index,priority:(common?1000:0)+weightedDeficit};
 }).sort((a,b)=>b.priority-a.priority||a.index-b.index);
 return {...goals,goals:ranked.map(r=>r.goal),pipelinePriority:{planId:job.pipelinePlan.id,order:ranked.map(r=>({id:r.goal.id,priority:r.priority})),weights:job.pipelinePlan.weights}};
}
