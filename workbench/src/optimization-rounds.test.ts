import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {improvement} from './improvement-governance';
import {save} from './store';
import {reserveOptimizationRound,reserveOptimizationCall} from './optimization-rounds';
test('新授权保留历史次数，明确分析后才能续轮，单轮及总轮数边界生效',()=>{
 const root=mkdtempSync(join(tmpdir(),'five-round-test-')),prior=process.env.PIPELINE_OPTIMIZATION_BATCH_FILE;
 const id=improvement.key({prompt:crypto.randomUUID()});
 try{
  const file=join(root,'batch.json');process.env.PIPELINE_OPTIMIZATION_BATCH_FILE=file;
  save(improvement.path(id),{id,limits:{calls:115,repairs:21},calls:100,repairs:16,stopped:'历史停止',diagnosis:{reason:'需新假设'}});
  const state={id:'test',improvementId:id,maxRounds:5,baselineJobId:'source',rounds:[]};save(file,state);
  const source={id:'source',improvementId:id,quality:{score:58.4}};
  expect(()=>reserveOptimizationRound(source,'job',{})).toThrow('原因分析');
  expect(()=>reserveOptimizationRound({...source,improvementId:'other'},'job',{})).toThrow('没有已授权');
  const row=reserveOptimizationRound(source,'job',{analysis:'来源画面显示真实材质细节与空间形态仍有不足，需要对照实际预览分清光照与纹理问题，而不是用评分规则调整代替视觉改进。',hypothesis:'在相同参考图与评分契约下检查复用材质的投影与光照乘数，生成实际候选后独立验收。'});
  expect(row.index).toBe(1);expect(improvement.get(id).calls).toBe(100);expect(improvement.get(id).repairs).toBe(16);expect(improvement.get(id).reviewedContinuations[0].previousStop).toBe('历史停止');
  const job={id:'job',optimizationRound:row};
  reserveOptimizationCall(job,'scene-refine');expect(()=>reserveOptimizationCall(job,'scene-refine')).toThrow('最多调用一次');
  expect(()=>reserveOptimizationCall(job,'scene-repair-plan')).toThrow('授权范围');
  reserveOptimizationCall(job,'scene-space-judge');reserveOptimizationCall(job,'judge');
  save(file,{...state,rounds:Array(5).fill({})});expect(()=>reserveOptimizationRound(source,'six',{})).toThrow('五轮');
 }finally{if(prior===undefined)delete process.env.PIPELINE_OPTIMIZATION_BATCH_FILE;else process.env.PIPELINE_OPTIMIZATION_BATCH_FILE=prior;rmSync(improvement.path(id),{force:true});rmSync(root,{recursive:true,force:true});}
});
