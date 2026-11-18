/**
 * 历史 spec 任务报告迁移：把「看不到像素的 cbc4 文本节点」产生的无效风格分显式作废。
 *
 * 原则：不改写任何分数、status、ownerApproval、门禁结论，也不重评。只在原报告里加
 * 可审查的作废标记与备份，让 owner 认可时看到的是「证据无效需重评」而不是「模型打了低分」。
 * 幂等：已带本版本标记的记录跳过；原始文件先完整备份到 data/runs/.migration-backup/。
 *
 * 用法：bun run specs:migrate-history
 */
import {copyFileSync,existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {prepareExportPlacements} from '../src/spec/export-pack';
import {reconcileSpec} from '../src/spec/contract-reconcile';

const VERSION='spec-history-migration-v1';
const ROOT=resolve(import.meta.dir,'..');
const RUNS=join(ROOT,'data','runs');
const BACKUP=join(RUNS,'.migration-backup');
const MANIFEST=join(RUNS,'.migration-manifest.json');
const AT=new Date().toISOString();

const readJSON=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const writeJSON=(p:string,v:unknown)=>writeFileSync(p,JSON.stringify(v,null,2));
const backup=(run:string,file:string)=>{
 const target=join(BACKUP,run);mkdirSync(target,{recursive:true});
 const dest=join(target,file);
 if(!existsSync(dest))copyFileSync(join(RUNS,run,file),dest);
};

type Row={
 run:string;status:string|null;
 invalidatedReviews:{overall:unknown;verdict:unknown;reason:string}[];
 specRecompute:{unresolvedBefore:number;proxiesBefore:number;unresolvedAfter:number;proxiesAfter:number}|null;
 exportReportMismatch:boolean;
 draftMarked:boolean;
 changed:boolean;
};

if(!existsSync(RUNS))throw Error('任务目录不存在:'+RUNS);
mkdirSync(BACKUP,{recursive:true});
const previous:Row[]=existsSync(MANIFEST)?readJSON(MANIFEST):[];
const rows:Row[]=[];

for(const run of readdirSync(RUNS).sort()){
 const dir=join(RUNS,run);
 if(!existsSync(join(dir,'job.json')))continue;
 let job:any;
 try{job=readJSON(join(dir,'job.json'));}catch{continue;}
 const reviewPath=join(dir,'style-review.json');
 const gatePath=join(dir,'spec-gate.json');
 const exportPath=join(dir,'spec-export.json');
 const scenePath=join(dir,'scene-spec.json');
 const hasReview=existsSync(reviewPath);
 const invalidReviews:{overall:unknown;verdict:unknown;reason:string}[]=[];

 if(hasReview){
  let review:any;
  try{review=readJSON(reviewPath);}catch{continue;}
  const visible=review?.evidence?.status==='visible';
  const observations=Array.isArray(review?.observations)?review.observations.length:0;
  if(!visible||!observations){
   const reason=`缺少可见像素证据（evidence=${JSON.stringify(review?.evidence??null)}，逐图 observations=${observations}）：历史 cbc4 文本节点自述看不到图像，分数不可采信`;
   invalidReviews.push({overall:review?.overall??null,verdict:review?.verdict??null,reason});
  }
 }

 // 用当前导出器重算任务保存的规格，与历史导出记录对照；只登记差异，不改写历史数值。
 let specRecompute:Row['specRecompute']=null,exportReportMismatch=false;
 if(existsSync(scenePath)){
  try{
   const spec=readJSON(scenePath);
   const before=prepareExportPlacements(spec).report;
   const after=prepareExportPlacements(reconcileSpec(spec).spec).report;
   specRecompute={
    unresolvedBefore:before.unresolved.length,proxiesBefore:before.proxies.length,
    unresolvedAfter:after.unresolved.length,proxiesAfter:after.proxies.length,
   };
   if(existsSync(exportPath)){
    const recorded=readJSON(exportPath);
    exportReportMismatch=recorded?.proxies===0&&before.proxies.length>0;
   }
  }catch{}
 }

 const already=job?.historicalMigration?.version===VERSION;
 const invalidGate=invalidReviews.length&&existsSync(gatePath);
 const draftMarked=Boolean(specRecompute&&specRecompute.proxiesBefore>0);
 const changed=!already&&(invalidReviews.length>0||exportReportMismatch||draftMarked);

 if(changed){
  if(hasReview){
   backup(run,'style-review.json');
   const review=readJSON(reviewPath);
   review.invalidated={version:VERSION,at:AT,scoreUsable:false,reason:invalidReviews[0]?.reason??'视觉证据无效'};
   writeJSON(reviewPath,review);
  }
  if(invalidGate){
   backup(run,'spec-gate.json');
   const gate=readJSON(gatePath);
   gate.historicalReviewInvalidation={version:VERSION,at:AT,scoreUsable:false,requiresStyleReReview:true,reason:invalidReviews[0]?.reason??'视觉证据无效'};
   writeJSON(gatePath,gate);
  }
  backup(run,'job.json');
  job.historicalMigration={
   version:VERSION,at:AT,
   invalidReviews,
   contractRecompute:specRecompute,
   exportReportMismatch,
   draftReason:exportReportMismatch?'历史导出记录 proxies=0，但当前规格按现行导出器重算存在灰模代理；历史数值保持不变，仅标注不可作为完整成品依据。':null,
   note:'只加作废标记，未改写分数、status、ownerApproval 或门禁结论；原始文件已备份。',
  };
  writeJSON(join(dir,'job.json'),job);
 }

 const row:Row={
  run,status:job?.status??null,invalidatedReviews:invalidReviews,specRecompute,exportReportMismatch,draftMarked,changed,
 };
 rows.push(row);
 console.log(`${run.slice(0,8)} status=${row.status} 无效评审=${invalidReviews.length} 规格重算=${specRecompute?`${specRecompute.unresolvedBefore}/${specRecompute.proxiesBefore}→${specRecompute.unresolvedAfter}/${specRecompute.proxiesAfter}`:'无'} 导出记录不一致=${exportReportMismatch} ${changed?'已标记':'跳过'}`);
}

writeJSON(MANIFEST,[...new Map([...previous,...rows].map(r=>[r.run,r])).values()]);
console.log(`\n合计 ${rows.length} 个任务，本次标记 ${rows.filter(r=>r.changed).length} 个；备份目录 ${BACKUP}`);
console.log('manifest:',MANIFEST);
