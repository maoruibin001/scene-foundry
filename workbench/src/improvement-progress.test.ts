import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
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
test('新策略保留累计事实和历史最佳，从已登记机制边界累计连续低收益',()=>{
 const root=mkdtempSync(join(tmpdir(),'progress-history-'));try{
  const l=new ImprovementLedger(root),id=l.enter({prompt:'双图场景',images:[]},'first');
  l.result(id,row(65,'a'));l.result(id,row(50,'b'));
  l.reviseStrategy(id,{id:'new-contract',reason:'能力契约已修复，增加一轮验证',pipelineVersion:{label:'candidate'},additionalRepairs:1});
  const v=l.result(id,row(60,'c'));expect(v.noGain).toBe(1);expect(v.stopped).toBeUndefined();expect(v.progress.bestJobId).toBe('job-65');expect(v.results.map((r:any)=>r.score)).toEqual([65,50,60]);
  const stopped=l.result(id,row(59,'d'));expect(stopped.noGain).toBe(2);expect(stopped.stopped).toBeTruthy();expect(stopped.diagnosis.progress.bestJobId).toBe('job-65');expect(stopped.results.map((r:any)=>r.score)).toEqual([65,50,60,59]);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('共享正式评审比较键保留原实现，模型和评审协议变化会隔离',()=>{
 const job={policy:{version:'v'},modelSettings:{model:'m'},profile:{assessmentProtocolSha256:'p'}};
 expect(qualityComparison(job)).toBe(qualityComparison(structuredClone(job)));
 expect(qualityComparison({...job,profile:{assessmentProtocolSha256:'q'}})).not.toBe(qualityComparison(job));
});

test('草稿、完整成品与未知历史分别比较，不伪造首个成品无提升',()=>{
 const partial={...row(89.8),assessmentScope:'partial'},initial={...row(90.6),assessmentScope:'scene'},repair={...row(93.4),assessmentScope:'scene',requiresDiagnosis:true};
 expect(scoreProgress([partial],initial,2)).toMatchObject({comparable:0,previousBest:null,noGain:0});
 expect(scoreProgress([partial,initial],repair,2)).toMatchObject({comparable:1,previousBest:90.6,noGain:1});
 expect(scoreProgress([row(99)],initial,2).comparable).toBe(0);
});
test('正常续跑修正已证实的草稿混算，保留不可变结果、累计调用和其他停止原因',()=>{
 const root=mkdtempSync(join(tmpdir(),'scope-correction-'));
 try{
  const l=new ImprovementLedger(root,r=>r.jobId==='draft'?'partial':'scene'),input={prompt:'固定图片',images:[],generationMode:'qualified'},id=l.enter(input,'source');
  const results=[{...row(89.8),jobId:'draft'},{...row(90.6),jobId:'scene'},{...row(93.4),jobId:'repair',requiresDiagnosis:true}];
  const old={...l.get(id),results,calls:33,repairs:1,noGain:2,stopped:'同一评审契约连续两轮未有效超过历史最佳，停止当前策略'};
  writeFileSync(l.path(id),JSON.stringify(old));
  l.enter(input,'continued',[],{improvementId:id},'continuation');
  const v=l.get(id);expect(v).toMatchObject({calls:33,repairs:1,noGain:1});expect(v.stopped).toBeUndefined();expect(v.results).toEqual(results);expect(v.scopeCorrections).toHaveLength(1);
  l.enter(input,'continued-again',[],{improvementId:id},'continuation');expect(l.get(id).scopeCorrections).toHaveLength(1);
  writeFileSync(l.path(id),JSON.stringify({...old,stopped:'累计调用已达上限'}));expect(()=>l.enter(input,'denied',[],{improvementId:id},'continuation')).toThrow('累计调用');
 }finally{rmSync(root,{recursive:true,force:true});}
});
