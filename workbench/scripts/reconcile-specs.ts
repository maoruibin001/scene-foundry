/**
 * 把 data/specs 里的历史规格「另存」为生成器契约合规版本。
 *
 * 规格按内容寻址，loadSpec 会校验 digest(JSON.stringify(spec))===id，所以绝不能原地改历史文件。
 * 本脚本用与管线相同的 reconcileSpec 生成新规格、按新摘要落盘，并保留 .style.json 关联；
 * 原文件与历史任务完全不动。可重复执行：内容相同不会再产生新文件。
 *
 * 用法：bun run specs:reconcile
 */
import {copyFileSync,existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {reconcileSpec,reconcileSummary} from '../src/spec/contract-reconcile';
import {prepareExportPlacements} from '../src/spec/export-pack';
import {GENERATORS} from '../src/spec/generators/index';
import {runGenerator} from '../src/spec/generators/kit';
import {sceneSpecErrors} from '../src/spec/schema';

const ROOT=resolve(import.meta.dir,'..');
const DIR=join(ROOT,'data','specs');
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');

type Row={
 source:string;sourceId:string;id:string;
 before:{unresolved:number;proxies:number;errors:number};
 after:{unresolved:number;proxies:number;errors:number};
 descriptive:number;schemaErrors:number;buildErrors:number;created:boolean;
};

if(!existsSync(DIR))throw Error('规格目录不存在:'+DIR);
const manifestPath=join(DIR,'.reconcile-manifest.json');
const previous:Row[]=existsSync(manifestPath)?JSON.parse(readFileSync(manifestPath,'utf8')):[];
const bySource=new Map(previous.map(r=>[r.source,r]));
const rows:Row[]=[];
const generatedIds=new Set(previous.map(r=>r.id));
const probed=new Set<string>();

for(const file of readdirSync(DIR).sort()){
 if(!file.endsWith('.json')||file.endsWith('.style.json'))continue;
 const sourceId=file.replace(/\.json$/,'');
 if(!/^[a-f0-9]{64}$/.test(sourceId))continue; // 跳过辅助 json
 if(generatedIds.has(sourceId))continue;        // 跳过本脚本自己产出的合规格文件，保证可重复执行
 let spec:any;
 try{spec=JSON.parse(readFileSync(join(DIR,file),'utf8'));}catch{continue;}
 if(!spec?.families||!spec?.objects)continue;

 const before=prepareExportPlacements(spec).report;
 const {spec:fixed,report}=reconcileSpec(spec);
 const prepared=prepareExportPlacements(fixed);
 const after=prepared.report;
 // 参数类型合规 ≠ 几何能生成：生成器 build 里还有跨参数硬约束，这里真实跑一次网格生成预检。
 const buildErrors:string[]=[];
 for(const [key,job] of prepared.uniqueJobs){
  if(probed.has(key))continue;
  probed.add(key);
  const gen=GENERATORS[job.generatorId];
  if(!gen)continue;
  try{runGenerator(gen,job.params as any,key);}
  catch(e){buildErrors.push(`${job.generatorId}:${key.slice(0,10)} ${String(e).slice(0,180)}`);}
 }
 if(buildErrors.length)console.error('  生成器预检失败:',buildErrors.slice(0,4).join(' | '));
 const text=JSON.stringify(fixed),id=digest(text);
 const created=!existsSync(join(DIR,id+'.json'));
 if(created){
  writeFileSync(join(DIR,id+'.json'),text);
  writeFileSync(join(DIR,id+'.reconcile.json'),JSON.stringify({...report,source:file,summary:reconcileSummary(report)},null,2));
  const style=join(DIR,sourceId+'.style.json');
  if(existsSync(style))copyFileSync(style,join(DIR,id+'.style.json'));
 }
 const row:Row={
  source:file,sourceId,id,
  before:{unresolved:before.unresolved.length,proxies:before.proxies.length,errors:before.errors.length},
  after:{unresolved:after.unresolved.length,proxies:after.proxies.length,errors:after.errors.length},
  descriptive:report.descriptive.length,schemaErrors:sceneSpecErrors(fixed).length,buildErrors:buildErrors.length,created,
 };
 rows.push(row);
 bySource.set(file,row);
 console.log(`${file.slice(0,8)} ${row.before.unresolved}→${row.after.unresolved} unresolved, ${row.before.proxies}→${row.after.proxies} proxies, descriptive=${row.descriptive}, schemaErrors=${row.schemaErrors}, buildErrors=${row.buildErrors} => ${id.slice(0,12)}${created?' (new)':''}`);
}

writeFileSync(manifestPath,JSON.stringify([...bySource.values()],null,2));
const bad=rows.filter(r=>r.after.unresolved||r.after.proxies||r.after.errors||r.schemaErrors||r.buildErrors);
console.log(`\n合计 ${rows.length} 份规格，新增 ${rows.filter(r=>r.created).length} 份合规格文件；不合规残留 ${bad.length} 份。`);
console.log('manifest:',manifestPath);
if(bad.length)process.exit(1);
