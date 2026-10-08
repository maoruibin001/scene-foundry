import {existsSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {DATA,read,save,runDir,digest} from './store';
import {improvement} from './improvement-governance';

/** One decision for every failed quality gate; continuation never grants new repairs. */
export function qualityDecision(ledger:any,passed=false,job?:any) {
 if(passed)return {action:'pass',code:'passed',reason:'达到当前验收门槛'};
 if(job?.quality&&(job.generationMode==='first-pass'||job.iterationPolicy?.maxVisualRepairs===0))return {action:'retain',code:'first-pass-complete',reason:job.partialOutput?'首轮已交付草稿与真实评分；仅允许技术恢复补齐缺失资产，不自动追加质量重跑':'首轮已评估并保留结果；本任务未授权自动质量修正'};
 const remaining=ledger.limits.repairs===null?Infinity:Math.max(0,ledger.limits.repairs-ledger.repairs);
 if(ledger.stopped)return {action:'diagnose',code:'strategy-stopped',reason:ledger.stopped};
 if(ledger.limits.calls!==null&&ledger.calls>=ledger.limits.calls)return {action:'diagnose',code:'call-limit',reason:`累计模型调用 ${ledger.calls}/${ledger.limits.calls}，已达到上限`};
 if(ledger.noGain>=ledger.limits.noGain)return {action:'diagnose',code:'no-gain',reason:`连续 ${ledger.noGain} 轮未达到最小有效提升`};
 if(!remaining)return {action:'diagnose',code:'repair-limit',reason:`累计修复 ${ledger.repairs}/${ledger.limits.repairs} 次，已达到上限；手动续跑沿用累计次数`};
 return {action:'repair',code:'repair-available',reason:remaining===Infinity?'未达到质量门槛，继续有据修正与验收；无改善先诊断策略':`未达到质量门槛，自动修复后重新验收；还可修复 ${remaining} 次`};
}

export function buildQualityDiagnosis(job:any,ledger:any,jobs:any[],spaces:Record<string,any>={}) {
 const spatial=['graybox','space'].includes(job.stage)&&job.blockout?.rounds?.some((r:any)=>!r.passed);
 const last=job.blockout?.rounds?.at(-1),decision=qualityDecision(ledger,false,job);
 const rounds=jobs.flatMap(j=>(j.blockout?.rounds??[]).map((r:any)=>({jobId:j.id,round:r.round+1,pipeline:j.pipelineVersion?.label,score:r.review?.score,confidence:r.review?.confidence,passed:r.passed,at:r.endedAt,review:r.review,threshold:r.threshold,gate:'/files/runs/'+j.id+'/'+r.path+'/gate.json',frames:(r.frames??[]).map((f:string)=>'/files/runs/'+j.id+'/'+r.path+'/runtime/'+f)}))).sort((a,b)=>a.at-b.at).filter(r=>!last||r.at<=last.endedAt);
 const current=rounds.filter(r=>r.jobId===job.id).at(-1),relations=spatial?(current?.review?.relations??[]):(job.quality?.requirements??[]);
 const requirements=spatial?(spaces[job.id]?.spatialRelations??[]):(job.plan?.requirements??[]);
 const gaps=relations.filter((r:any)=>r.verdict!=='met').map((r:any)=>({id:r.id,description:requirements.find((x:any)=>x.id===r.id)?.description??requirements.find((x:any)=>x.id===r.id)?.text??r.id,critical:requirements.find((x:any)=>x.id===r.id)?.critical??null,score:r.score,verdict:r.verdict,reason:r.reason,frames:r.frames,occurrences:spatial?rounds.filter(x=>x.review?.relations?.some((y:any)=>y.id===r.id&&y.verdict!=='met')).length:jobs.filter(x=>x.quality?.requirements?.some((y:any)=>y.id===r.id&&y.verdict!=='met')).length}));
 const visibility=relations.filter((r:any)=>/对比|不够清楚|不清楚|难以|辨认|辨出|证据不足|无法.*确认/.test(r.reason??''));
 const camera=relations.filter((r:any)=>/裁切|出画|占幅|偏大|偏小|偏高|偏低|比例|投影|遮挡范围|伸入/.test(r.reason??'')&&r.verdict!=='met');
 const lowConfidence=spatial&&Number.isFinite(last?.review?.confidence)&&last.review.confidence<(last.threshold?.confidence??.7);
 const evidenceLink=spatial&&current?.gate?current.gate:'/files/runs/'+job.id+'/quality.json';
 const findings=[
  {category:'执行机制',certainty:'已确认',conclusion:decision.action==='diagnose'?decision.reason:decision.reason,evidence:[evidenceLink],next:decision.action==='retain'?'保存原画面、评分和未通过项；技术恢复保持同一输入与资产，不作为质量迭代。':'按已授权修复策略与累计额度推进；达到上限后保存诊断。'},
  {category:'验收证据',certainty:lowConfidence?'已确认':'待核验',conclusion:spatial?`本轮证据置信度 ${last?.review?.confidence??'未记录'}；${visibility.length} 项关系提到轮廓或可见性不足。${lowConfidence?'低于置信度门槛，不能将所有不确定项归因于生成模型。':'需结合实拍核验不确定项。'}`:'检查最终运行画面与评分引用是否一致。',evidence:[evidenceLink],next:spatial?'冻结几何和机位，仅调整中性灰模显示，再复核同一候选。':'对照最终成品截图与逐项评分引用，核对空间、材质、光照及缺失资产；不以灰模成绩替代成品。'},
  {category:'空间与提示词',certainty:camera.length?'有证据支持，待清晰画面复核':'待验证',conclusion:spatial?`${camera.length} 项未满足关系报告了机位裁切、投影比例或遮挡边界差距。现有反馈以自然语言为主，尚不能证明空间数值已收敛。`:'局部修复需绑定失败需求和实际候选，不能仅重复整体提示词。',evidence:[evidenceLink],next:'先测参考图与渲染图的地标屏幕位置、占幅和遮挡；锁住正确几何，优先校准相机，再按误差修改少量实例。'},
  {category:'评分标准',certainty:'尚不能判定不合理',conclusion:spatial?`综合门槛 ${last?.threshold?.space??4}/5；${job.optimizationPolicy?.spatialPreflight==='composition-v3'?'构图检查要求综合≥3.5、关键关系≥3；局部partial和灰模不可验证的材质关系保留警告。':job.optimizationPolicy?.spatialPreflight==='coarse-v2'?'快速检查只阻断关键关系严重低分或主体缺失；局部偏差可后续修正。':'关键关系同时要求得分达标且 met。'}${requirements.filter((r:any)=>r.critical).length}/${requirements.length} 项被标为关键。总分不足和关键关系不确定是不同阻断原因。`:'总分、关键需求与制作规范分别判定，不能只看总分。',evidence:[evidenceLink],next:'用相同清晰画面复核 met、partial、uncertain 的边界，检查小比例误差是否被重复当作关键拓扑失败；保留原分数，不通过降低门槛制造通过。'},
  {category:'模型能力',certainty:'未证实为根因',conclusion:'现有记录同时改变了布局、几何或显示条件，没有受控对照能证明推理强度或模型能力是主因。',evidence:[evidenceLink],next:'在输入、几何表达、机位和评分固定后，对单个仍失败步骤做一次受控比较；记录提升与耗时后再决定模型调整。'},
 ];
 const plan=spatial?[
  {priority:'P0',action:'修复验收证据的可读性',change:'保持同一几何和相机，使用中性分色灰模与补光，检查各参考机位。',success:'轮廓和关键遮挡能明确辨认；几何与相机摘要完全一致；低置信度不伪装成已通过。',cost:'本地重新渲染，不需要重新生成资产或调用生成模型。'},
  {priority:'P1',action:'校准评分与空间修复目标',change:'逐项对照清晰画面，区分真实位置比例错误、证据不足和评分规则冲突；给每项保留截图依据。',success:'每项修复对应明确误差与预期变化；规则复评独立存档，不覆盖历史成绩。',cost:'复用现有几何和机位；若需模型复评，先定义调用额度。'},
  {priority:'P1',action:'从最大空间误差做受限修复',change:'优先机位与主体屏幕占比，再修正局部实例；只重做改变的模板，并行执行独立工作。',success:job.optimizationPolicy?.spatialPreflight==='composition-v3'?'构图空间 ≥3.5/5、关键关系 ≥3/5、无关键missing、置信度达标后进入详细资产，成品仍须独立70分验收。':job.optimizationPolicy?.spatialPreflight==='coarse-v2'?'快速空间 ≥3/5、关键主体与主通路无严重缺失、置信度达标后进入详细资产，最终成品仍需原质量门槛。':'同一套参考图和门槛下，空间 ≥4/5、关键关系满足、证据置信度达标后进入详细资产。',cost:'新策略必须带具体假设与有限追加额度，保留本实验累计次数。'},
 ]:[
  {priority:'P0',action:'核对成品完整性与评分证据',change:'逐项对照最终截图、缺失资产清单及验收引用，保留原分和运行证据。',success:'完整成品、部分草稿和正式通过分别标注。',cost:'复用现有产物，本地核验。'},
  {priority:'P1',action:'定位实际扣分维度',change:'按最终需求差距和原始空间、材质等维度列出可验证修复假设。',success:'每项修复对应明确证据，不凭总分猜测模型能力。',cost:'先诊断；质量重跑需已授权策略与剩余额度。'},
 ];
 return {version:'quality-diagnosis-v2',jobId:job.id,experimentId:ledger.id,status:'diagnosed',method:'根据保存的验收、累计记录和关系证据生成；分类是诊断线索，不冒充新的模型评分',phase:spatial?'graybox':'final',decision,limits:{...ledger.limits},used:{repairs:ledger.repairs,calls:ledger.calls,noGain:ledger.noGain},scoreUnit:spatial?'空间分 / 5，不是成品综合分':'综合分 / 100',rounds,gaps,findings,plan,next:'先完成上述证据与机制修正，再启动有明确假设和上限的新策略；不原样重跑、不重置累计次数。'};
}

export function qualityFailure(job:any){return ['failed','needs_review'].includes(job.status)&&!!(job.quality||(['space','graybox'].includes(job.stage)&&job.blockout?.rounds?.some((r:any)=>!r.passed)));}
export function diagnosisPath(id:string){runDir(id);return join(DATA,'quality-diagnoses',id+'.json');}
export function savedQualityDiagnosis(job:any){const p=diagnosisPath(job.id);return existsSync(p)?read(p):null;}
export function persistQualityDiagnosis(job:any){
 if(!job.improvementId||!qualityFailure(job))return null;
 const ledger=improvement.get(job.improvementId),jobs=ledger.jobs.map((id:string)=>{const p=join(runDir(id),'job.json');return id===job.id?job:existsSync(p)?read(p):null;}).filter(Boolean),spaces:Record<string,any>={};
 const last=job.blockout?.rounds?.at(-1);if(last){const p=join(runDir(job.id),last.path,'space.json');if(existsSync(p))spaces[job.id]=read(p);}
 const experimentPath=join(DATA,'quality-diagnoses',job.id+'-experiments.json');
 const report={...buildQualityDiagnosis(job,ledger,jobs,spaces),experiments:existsSync(experimentPath)?read(experimentPath):[]},fingerprint=digest(JSON.stringify(report)),prior=savedQualityDiagnosis(job);
 if(prior?.fingerprint===fingerprint)return prior;
 mkdirSync(join(DATA,'quality-diagnoses'),{recursive:true});const saved={...report,fingerprint,createdAt:Date.now()};save(diagnosisPath(job.id),saved);
 if(report.decision.action==='diagnose'&&!jobs.some((j:any)=>j.id!==job.id&&['running','queued'].includes(j.status)))improvement.markStopped(job.improvementId,report.decision.reason,{report:'/files/quality-diagnoses/'+job.id+'.json',next:report.next});
 return saved;
}
