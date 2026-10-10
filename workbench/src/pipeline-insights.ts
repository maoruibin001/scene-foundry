import {existsSync,readdirSync,mkdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {DATA,read,save,runDir,listJobs} from './store';

export const PIPELINE_INSIGHT='pipeline-insight-v1';
const optional=(p:string)=>{try{return existsSync(p)?read(p):null}catch{return null}};
const round=(n:number|null)=>n===null||!Number.isFinite(n)?null:Math.round(n*1e4)/1e4;
const mean=(v:number[])=>v.length?round(v.reduce((a,b)=>a+b,0)/v.length):null;
const measuredScope=(r:any)=>['bound-instance-union','exclusive-instance-subset'].includes(r.comparisonScope)&&Number.isFinite(r.edgeResidual);

/** Critical-target measurability of one composition: unverified rows are a blind spot, never a match. */
export function compositionCoverage(c:any){
 if(!c?.rows)return null;
 const critical=c.rows.filter((r:any)=>r.critical),measured=critical.filter(measuredScope);
 const cameras=[...new Set(critical.map((r:any)=>r.referenceIndex))].sort().map(i=>{const rows=critical.filter((r:any)=>r.referenceIndex===i),m=rows.filter(measuredScope);return {referenceIndex:i,critical:rows.length,measured:m.length,meanEdgeResidual:mean(m.map((r:any)=>r.edgeResidual))};});
 return {version:c.version,critical:critical.length,measured:measured.length,unverified:critical.length-measured.length,measuredFraction:critical.length?round(measured.length/critical.length):null,meanCriticalEdgeResidual:mean(measured.map((r:any)=>r.edgeResidual)),worst:measured.sort((a:any,b:any)=>b.edgeResidual-a.edgeResidual).slice(0,3).map((r:any)=>({landmarkId:r.landmarkId,referenceIndex:r.referenceIndex,edgeResidual:r.edgeResidual})),cameras};
}

/** Provider cost per model role: attempts, faults and time lost before the passing attempt. */
function providerRoles(gen:string){
 const files:string[]=[];const walk=(d:string)=>{for(const e of readdirSync(d,{withFileTypes:true})){const p=join(d,e.name);if(e.isDirectory()&&!['runtime','project','materials','templates','capture'].includes(e.name))walk(p);else if(e.name.endsWith('-recovery.json'))files.push(p);}};
 if(existsSync(gen))walk(gen);
 const roles:Record<string,any>={};
 for(const f of files){const r=optional(f);if(!r?.role||!Array.isArray(r.attempts))continue;const receipt=optional(f.replace(/-recovery\.json$/,'-receipt.json'));const v=roles[r.role]??={role:r.role,calls:0,attempts:0,failures:0,timeouts:0,lostMs:0,durationMs:0,tokens:0};
  v.calls++;v.attempts+=r.attempts.length;for(const a of r.attempts){v.durationMs+=a.durationMs??0;if(a.status!=='passed'){v.failures++;v.lostMs+=a.durationMs??0;if(a.fault==='timeout')v.timeouts++;}}
  v.tokens+=receipt?.usage?.cliReportedTokens??0;}
 return Object.values(roles).sort((a:any,b:any)=>b.durationMs-a.durationMs);
}

/** One space-repair folder: tool use, cross-camera fit of each measured candidate and the committed change. */
function repairDigest(folder:string){
 const audit=optional(join(folder,'preview/graybox-preview-audit.json')),receipt=optional(join(folder,'repair-receipt.json'));
 const calls:Record<string,number>={};if(existsSync(join(folder,'scene-space-tool-calls.jsonl')))for(const l of readFileSync(join(folder,'scene-space-tool-calls.jsonl'),'utf8').split('\n')){try{const e=JSON.parse(l);if(e.event==='finished')calls[e.name]=(calls[e.name]??0)+1;}catch{}}
 const candidates=(audit?.measurements??[]).map((m:any)=>{const rows=(m.referenceComposition?.rows??[]).filter((r:any)=>r.critical&&r.sourceDelta&&Number.isFinite(r.sourceDelta.edgeResidual));return {patchSha256:m.patchSha256?.slice(0,12),criticalCompared:rows.length,meanCriticalDelta:mean(rows.map((r:any)=>r.sourceDelta.edgeResidual)),regressions:rows.filter((r:any)=>r.sourceDelta.edgeResidual>.01).map((r:any)=>r.landmarkId+'/'+r.referenceIndex),visibilityLost:rows.filter((r:any)=>r.sourceDelta.visibilityLost).map((r:any)=>r.landmarkId+'/'+r.referenceIndex)};});
 const selected=receipt?.preview?.patchSha256?.slice(0,12)??null;
 return {folder:folder.split('/').at(-1),toolCalls:calls,previewsUsed:audit?.used??null,measurementsUsed:audit?.measured??null,contract:audit?.version??null,candidates,selected,selectedWasMeasured:selected?candidates.some((c:any)=>c.patchSha256===selected):null,changes:receipt?.changes??null,committed:!!receipt};
}

/** Structured, evidence-linked digest of one run; reads artifacts only, never mutates the job or its ledger. */
export function runInsight(job:any,dir=runDir(job.id),ledger:any=null){
 const gen=join(dir,'generation'),space=(path:string)=>optional(join(dir,path,'space.json'));
 const rounds=(job.blockout?.rounds??[]).map((r:any)=>{const s=space(r.path),critical=new Map((s?.spatialRelations??[]).map((x:any)=>[x.id,!!x.critical]));return {round:r.round,path:r.path,score:r.review?.score??null,confidence:r.review?.confidence??null,passed:!!r.passed,threshold:r.threshold??null,failed:r.failed??[],durationMs:Number.isFinite(r.endedAt-r.startedAt)?r.endedAt-r.startedAt:null,relations:(r.review?.relations??[]).map((x:any)=>({id:x.id,critical:critical.get(x.id)??null,score:x.score,verdict:x.verdict})),composition:compositionCoverage(optional(join(dir,r.path,'reference-composition.json')))};});
 const relationIds=[...new Set(rounds.flatMap((r:any)=>r.relations.map((x:any)=>x.id)))];
 const relations=relationIds.map(id=>{const series=rounds.map((r:any)=>r.relations.find((x:any)=>x.id===id)??null);const scores=series.map((x:any)=>x?.score??null);const first=scores.find((x:any)=>x!==null),last=[...scores].reverse().find((x:any)=>x!==null);return {id,critical:series.find((x:any)=>x)?.critical??null,scores,verdicts:series.map((x:any)=>x?.verdict??null),delta:first!==undefined&&last!==undefined?round(last-first):null,neverMet:series.every((x:any)=>!x||x.verdict!=='met')};});
 const repairs=existsSync(gen)?readdirSync(gen).filter(f=>/^space-repair-\d+$/.test(f)).sort((a,b)=>+a.split('-').at(-1)!-+b.split('-').at(-1)!).map(f=>repairDigest(join(gen,f))):[];
 const stages=Object.entries(job.stages??{}).map(([id,v]:any)=>({id,status:v.status,durationMs:v.durationMs??null,attempts:job.stageAttempts?.[id]?.length??1,failedAttempts:(job.stageAttempts?.[id]??[]).filter((a:any)=>a.status==='failed').length}));
 const providers=providerRoles(gen);
 return {version:PIPELINE_INSIGHT,jobId:job.id,status:job.status,stage:job.stage,error:job.error??null,pipeline:job.pipelineVersion?.label??null,model:job.modelSettings??null,policy:{iteration:job.iterationPolicy??null,spatialPreflight:job.optimizationPolicy?.spatialPreflight??null},
  calls:ledger?{used:ledger.calls,limit:ledger.limits?.calls??null,repairs:ledger.repairs,byRole:(ledger.requests??[]).reduce((m:any,r:any)=>(m[r.role]=(m[r.role]??0)+1,m),{})}:null,
  stages,providers,rounds,relations,repairs,findings:insightFindings({job,rounds,relations,repairs,providers})};
}

/** Rule-based bottleneck hints. Each names the measured signal; none is a root-cause claim. */
export function insightFindings({job,rounds,relations,repairs,providers}:any){
 const out:any[]=[],last=rounds.at(-1),minGain=job.iterationPolicy?.minMeaningfulGain??2;
 const blind=rounds.map((r:any)=>r.composition).filter(Boolean).at(-1);
 if(blind&&blind.measuredFraction!==null&&blind.measuredFraction<.5)out.push({code:'measurement-blind-spot',severity:'high',signal:`关键地标仅 ${blind.measured}/${blind.critical} 可量化测量`,implication:'修复工具与jointFit对未测目标无保护，修复只能靠模型看图；评审失败项多落在未测区域时尤其如此',next:'细化实例绑定（为门楼/高顶等共用实例拆分语义部件）以扩大可测范围'});
 for(const r of relations.filter((x:any)=>x.neverMet&&x.critical&&rounds.length>1&&(x.delta??0)<.5))out.push({code:'persistent-relation-failure',severity:'high',relation:r.id,signal:`关键关系 ${r.id} 各轮均未满足，分数 ${r.scores.join('→')}`,next:'该关系需新机制（显式体量/相机约束/拆分绑定），重复同类修复预期无效'});
 for(const r of relations.filter((x:any)=>x.verdicts.includes('missing')))out.push({code:'missing-mass',severity:'high',relation:r.id,signal:`${r.id} 曾被判 missing（${r.verdicts.join('→')}）`,next:'空间规划阶段为缺失体量建立显式实例，而不是交给修复补齐'});
 for(let i=1;i<rounds.length;i++){const a=rounds[i-1],b=rounds[i],gain=round((b.score-a.score)*20);const ma=a.composition?.meanCriticalEdgeResidual,mb=b.composition?.meanCriticalEdgeResidual;
  if(gain!==null&&gain<minGain)out.push({code:'repair-stall',severity:'medium',round:b.round,signal:`第 ${b.round} 轮修复提升 ${gain}（百分制），低于最小有效提升 ${minGain}`,next:'连续两轮即停止；需换机制而非原样重试'});
  if(ma!=null&&mb!=null&&gain!==null&&((mb<ma&&gain<=0)||(mb>ma&&gain>0)))out.push({code:'measure-judge-disagreement',severity:'medium',round:b.round,signal:`测量残差 ${ma}→${mb}，评审分 ${a.score}→${b.score} 方向不一致`,next:'测量指标与评审关注点脱节：核对失败关系是否落在未测目标，或残差权重是否需要按评审维度调整'});}
 for(const r of repairs){if(r.committed&&r.selectedWasMeasured===false)out.push({code:'unmeasured-commit',severity:'medium',repair:r.folder,signal:'最终提交的候选没有经过零Engine测量',next:'提交前先 measure，jointFit 才能拦截跨机位退步'});
  if(r.previewsUsed===0&&r.committed)out.push({code:'no-preview',severity:'low',repair:r.folder,signal:'未使用真实预览即提交',next:'至少一次 preview_graybox_space 核验'});}
 for(const p of providers)if(p.timeouts)out.push({code:'provider-timeout',severity:p.lostMs>300000?'medium':'low',role:p.role,signal:`${p.role} 超时 ${p.timeouts} 次，浪费 ${Math.round(p.lostMs/1000)}s`,next:'缩小该角色输入/分批，或提高该角色超时上限；不影响质量结论'});
 if(last&&!last.passed&&last.confidence!==null&&last.threshold?.confidence&&last.confidence<last.threshold.confidence)out.push({code:'low-evidence-confidence',severity:'medium',signal:`评审置信度 ${last.confidence} 低于 ${last.threshold.confidence}`,next:'先改善灰模可读性再判断几何'});
 return out;
}

/** Cross-run aggregate: which relations, roles and mechanisms repeatedly cost the most. */
export function aggregateInsights(rows:any[]){
 const rel:Record<string,any>={},codes:Record<string,number>={},roles:Record<string,any>={},gains:number[]=[];
 for(const r of rows){for(const x of r.relations)if(x.neverMet){const v=rel[x.id]??={id:x.id,critical:x.critical,runs:0,lastScores:[]};v.runs++;v.lastScores.push(x.scores.filter((s:any)=>s!==null).at(-1));}
  for(const f of r.findings)codes[f.code]=(codes[f.code]??0)+1;
  for(const p of r.providers){const v=roles[p.role]??={role:p.role,calls:0,timeouts:0,lostMs:0,durationMs:0,tokens:0};for(const k of ['calls','timeouts','lostMs','durationMs','tokens'])v[k]+=p[k];}
  for(let i=1;i<r.rounds.length;i++)gains.push(round((r.rounds[i].score-r.rounds[i-1].score)*20)!);}
 return {version:PIPELINE_INSIGHT,runs:rows.length,passed:rows.filter(r=>r.status==='passed').length,meanRepairGain:mean(gains),repairs:gains.length,findingFrequency:Object.entries(codes).sort((a,b)=>b[1]-a[1]).map(([code,count])=>({code,count})),unmetRelations:Object.values(rel).sort((a:any,b:any)=>b.runs-a.runs),providerRoles:Object.values(roles).sort((a:any,b:any)=>b.durationMs-a.durationMs)};
}

export const insightPath=(id:string)=>{runDir(id);return join(DATA,'pipeline-insights',id+'.json');};
/** Persist one run's digest next to quality diagnoses; history stays read-only. */
export function persistRunInsight(job:any,ledger:any=null){const v=runInsight(job,runDir(job.id),ledger);mkdirSync(join(DATA,'pipeline-insights'),{recursive:true});save(insightPath(job.id),{...v,createdAt:Date.now()});return v;}

if(import.meta.main){
 const ids=process.argv.slice(2),jobs=listJobs().filter(j=>!ids.length||ids.includes(j.id));
 const ledgerOf=(j:any)=>j.improvementId?optional(join(DATA,'improvement',j.improvementId+'.json')):null;
 const rows=jobs.map(j=>persistRunInsight(j,ledgerOf(j)));
 const summary=aggregateInsights(rows);save(join(DATA,'pipeline-insights','summary.json'),{...summary,jobs:rows.map(r=>r.jobId),createdAt:Date.now()});
 console.log(JSON.stringify({summary,runs:rows.map(r=>({jobId:r.jobId,status:r.status,stage:r.stage,scores:r.rounds.map((x:any)=>x.score),findings:r.findings.map((f:any)=>f.code+': '+f.signal)}))},null,1));
}
