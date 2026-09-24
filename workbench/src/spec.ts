import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {ROOT,digest} from './store';
const text=readFileSync(join(ROOT,'spec/production.md'),'utf8'),source=JSON.parse(readFileSync(join(ROOT,'spec/source.json'),'utf8'));
export const RULES=[
 ['S01','低模与目标能力','场景支持映射或一致性；当前工作台生成静态三维场景。','mandatory'],
 ['S02','材质与结构','实际画面具有可区分的材质、结构、主体和环境。','mandatory'],
 ['S03','移动视差与一致性','一致性样例相机真实平移，同一结构多角度对应，存在视差和遮挡变化。','conditional'],
 ['S04','镜头与尺度','允许不同相机类型，尺度是属性，不强制第一或第三人称。','information'],
 ['S05','场景语义','说明与画面一致，地点、结构及作用明确；简单几何可以有丰富语义。','mandatory'],
 ['S06','轮廓可读','主体和关键结构的轮廓在代表帧与连续浏览中可辨。','mandatory'],
 ['S07','全部 UI 开关','H 或 F1 隐藏全部场景界面，再按恢复。','mandatory'],
 ['S08','光照可读','关键对象、部件及状态不会因光照难以辨认。','mandatory'],
 ['S09','选样偏好','优先微观、地下、深海、深空、巨物等稀缺题材，减少同质赛车跑酷。','preference'],
 ['S10','不接受的类型','不接受解谜、互动影游、音游、纯 2D。','mandatory'],
 ['S11','镜头与节奏','连续片段不反复切机位，关键事件可看清；速度本身不是禁项。','mandatory'],
 ['S12','交互关系','存在交互时独立主体少于 3 个，施加者、方式、对象、结果可读。','conditional'],
 ['S13','明显缺陷','无明显穿模、失控、闪烁、界面错位、缺失、报错、卡死和个位数帧率。','mandatory'],
 ['S14','主体画面大小','重要主体足够大以看清关键结构；原文约 1% 是风险例子，不是安全阈值。','mandatory'],
].map(([id,title,requirement,kind])=>({id,title,requirement,kind}));
export const GENERATION_REFERENCE=JSON.parse(readFileSync(join(ROOT,'spec/generation-reference.json'),'utf8'));
export const SPEC={generationReference:GENERATION_REFERENCE,version:'scene-foundry-public-2026-09-24-v1',sha256:digest(text),sourceUrl:source.sourceUrl,retrievedAt:source.retrievedAtUtc,text,rules:RULES,evaluatorCalibration:'not-certified'};
export const VISUAL_RULE_IDS=['S01','S02','S03','S05','S06','S08','S09','S10','S11','S13','S14'];
export function specGate(review:any,runtime:any,plan:any,structure:any){
 const entries=review.specRules;
 if(!Array.isArray(entries)||entries.length!==VISUAL_RULE_IDS.length||new Set(entries.map((e:any)=>e.id)).size!==entries.length)throw Error('规范评估条款缺失或重复');
 const frames=new Set(runtime.images);
 for(const id of VISUAL_RULE_IDS){const e=entries.find((x:any)=>x.id===id);if(!e||!['passed','failed','needs_review'].includes(e.status)||!e.reason||!Array.isArray(e.frames)||(id!=='S09'&&!e.frames.length)||e.frames.some((f:string)=>!frames.has(f)))throw Error('规范条款缺少真实证据 '+id);}
 const rows=RULES.map(r=>{
  if(r.id==='S04')return {...r,status:'not_applicable',reason:'镜头类型开放；本样例采用连续相机观测',method:'适用范围'};
  if(r.id==='S12')return {...r,status:'not_applicable',reason:'此版本只生成静态场景，无独立交互事件',method:'能力契约'};
  if(r.id==='S07')return {...r,status:runtime.hard.hudToggle?'passed':'failed',reason:'所有已注册场景 UI 层隐藏/恢复及清屏取证',method:'正常按键 + DOM/UI 证据',evidence:'runtime/runtime.json'};
  const v=entries.find((x:any)=>x.id===r.id);let status=v.status;
  if(r.id==='S03'&&!plan.capabilities?.includes('consistency'))return {...r,status:'not_applicable',reason:'输入只选择映射目标',method:'能力目标'};
  if(r.id==='S03'&&(!runtime.hard.cameraMotion||!runtime.hard.nonFlat))status='failed';
  if(r.id==='S13'&&(!runtime.hard.noErrors||!runtime.hard.frameRate||!structure.passed||runtime.hard.framing===false||runtime.hard.entitiesLoaded===false))status='failed';
  if(r.id==='S14'&&runtime.subjectMeasurement?.safeFraming===false)status='failed';
  return {...r,...v,status,method:['S03','S13','S14'].includes(r.id)?'脚本 + AI 视觉':'AI 视觉',evidence:'review.json'};
 });
 const required=rows.filter(r=>!['preference','information'].includes(r.kind));
 const status=required.some(r=>r.status==='failed')?'failed':required.some(r=>r.status==='needs_review')?'needs_review':'passed';
 return {status,version:SPEC.version,sha256:SPEC.sha256,sourceUrl:SPEC.sourceUrl,rules:rows,scope:'固定版本静态场景、当前分辨率、有限连续录制路径；不是全设备或全部视角保证',evaluatorCalibration:SPEC.evaluatorCalibration};
}
