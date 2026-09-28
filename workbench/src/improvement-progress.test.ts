import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ImprovementLedger,scoreProgress,qualityComparison} from './improvement-governance';
const row=(score:number,kind='final',comparison='scene-quality-v4.1')=>({score,kind,comparison,jobId:'job-'+score,status:'failed'});
test('同评分版本不同实验名称仍比较历史最佳',()=>{
 const r=scoreProgress([row(54.7,'fidelity70'),row(53.3,'surface-contract')],row(54,'screen-fit'),2);
 expect(r).toMatchObject({previousBest:54.7,bestScore:54.7,bestJobId:'job-54.7',noGain:2,delta:-.7,improved:false});
});
test('从退步旁支恢复不冒充超过最佳，旧评分不改写',()=>{
 const rows=[row(65),row(50)],old=JSON.stringify(rows),r=scoreProgress(rows,row(60),2);
 expect(r.noGain).toBe(2);expect(r.improved).toBe(false);expect(JSON.stringify(rows)).toBe(old);
});
test('超过最佳足够幅度重置连续低收益；小幅新高仍保存为最佳',()=>{
 expect(scoreProgress([row(60),row(58)],row(62),2)).toMatchObject({noGain:0,bestScore:62,improved:true});
 expect(scoreProgress([row(60)],row(61),2)).toMatchObject({noGain:1,bestScore:61,improved:true});
});
test('不能混淆灰模、成品或不同评审契约，也不将无分数视为零',()=>{
 const prior=[row(95,'space','graybox-v1'),row(80,'final','scene-quality-v3')];
 expect(scoreProgress(prior,row(54),2)).toMatchObject({comparable:0,previousBest:null,noGain:0});
 expect(scoreProgress([row(54)],{...row(0),score:null},2)).toMatchObject({bestScore:54,noGain:0,delta:null});
});
test('改策略保留累计事实，下轮结果恢复完整低收益历史并给出最佳来源',()=>{
 const root=mkdtempSync(join(tmpdir(),'progress-history-'));try{
  const l=new ImprovementLedger(root),id=l.enter({prompt:'双图场景',images:[]},'first');
  l.result(id,row(65,'a'));l.result(id,row(50,'b'));
  l.reviseStrategy(id,{id:'new-contract',reason:'能力契约已修复，增加一轮验证',pipelineVersion:{label:'candidate'},additionalRepairs:1});
  const v=l.result(id,row(60,'c'));expect(v.noGain).toBe(2);expect(v.stopped).toBeTruthy();expect(v.diagnosis.progress.bestJobId).toBe('job-65');expect(v.results.map((r:any)=>r.score)).toEqual([65,50,60]);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('共享正式评审比较键保留原实现，模型和评审协议变化会隔离',()=>{
 const job={policy:{version:'v'},modelSettings:{model:'m'},profile:{assessmentProtocolSha256:'p'}};
 expect(qualityComparison(job)).toBe(qualityComparison(structuredClone(job)));
 expect(qualityComparison({...job,profile:{assessmentProtocolSha256:'q'}})).not.toBe(qualityComparison(job));
});
