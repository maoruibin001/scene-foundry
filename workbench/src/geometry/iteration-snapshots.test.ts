import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync,readlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {snapshotIteration,restoreIteration} from './iteration-snapshots';
import {boundedIterations} from './iteration-policy';
test('最佳产物连同评分恢复，历史、总耗时及首稿成绩不回滚，依赖链接不复制实体',()=>{const dir=mkdtempSync(join(tmpdir(),'scene-cycle-'));try{const j:any={id:'owned',pipelineVersion:{id:'frozen'},quality:{score:70},status:'failed',startedAt:1,firstDraft:{score:70},events:['draft']};mkdirSync(join(dir,'project/game/node_modules'),{recursive:true});symlinkSync('/external/engine',join(dir,'project/game/node_modules/engine'));writeFileSync(join(dir,'generated-scene.json'),'draft');snapshotIteration(dir,j,{index:0,score:70,status:'failed',startedAt:1,endedAt:2});writeFileSync(join(dir,'generated-scene.json'),'worse');j.quality={score:50};j.repairGoals={cameraChangePath:'discarded'};j.events.push('repair');j.endedAt=4;restoreIteration(dir,j,0);expect(readFileSync(join(dir,'generated-scene.json'),'utf8')).toBe('draft');expect(j.quality.score).toBe(70);expect(j.repairGoals).toBeUndefined();expect(j.events).toEqual(['draft','repair']);expect(j.endedAt).toBe(4);expect(j.firstDraft.score).toBe(70);expect(readlinkSync(join(dir,'project/game/node_modules/engine'))).toBe('/external/engine');expect(()=>snapshotIteration(dir,j,{index:0,score:50,status:'failed',startedAt:3,endedAt:4})).toThrow('不能覆盖');expect(()=>restoreIteration(dir,{...j,id:'other'},0)).toThrow('来源');}finally{rmSync(dir,{recursive:true,force:true})}});

test('持续修正实际保存第三轮之后的场景并恢复最佳，不受旧两轮存储限制',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'continuous-cycle-')),job:any={id:'owned',pipelineVersion:{id:'frozen'},calls:0,startedAt:1};
 try{
  const result=await boundedIterations({maxRepairs:null,signal:new AbortController().signal,canRefine:()=>true,
   evaluate:async index=>{job.calls++;job.status=index===4?'passed':'failed';job.quality={score:60+index*5};writeFileSync(join(dir,'generated-scene.json'),'actual-scene-'+index);return {status:job.status,score:job.quality.score};},
   refine:async source=>{restoreIteration(dir,job,source);},snapshot:async cycle=>{snapshotIteration(dir,job,cycle);}});
  expect(result.stopReason).toBe('passed');expect(result.bestIndex).toBe(4);expect(result.cycles).toHaveLength(5);
  writeFileSync(join(dir,'generated-scene.json'),'discarded');restoreIteration(dir,job,4);
  expect(readFileSync(join(dir,'generated-scene.json'),'utf8')).toBe('actual-scene-4');expect(job.quality.score).toBe(80);expect(job.calls).toBe(5);expect(job.startedAt).toBe(1);
  expect(readFileSync(join(dir,'iterations/0/generated-scene.json'),'utf8')).toBe('actual-scene-0');
  expect(()=>snapshotIteration(dir,job,result.cycles[4])).toThrow('不能覆盖');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('无效轮次不能形成文件路径，超大或非整数索引均拒绝',()=>{
 const dir=mkdtempSync(join(tmpdir(),'invalid-cycle-')),job:any={id:'owned',pipelineVersion:{id:'frozen'}};
 try{for(const index of [-1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'../escape']){
  expect(()=>snapshotIteration(dir,job,{index,score:60,status:'failed'} as any)).toThrow('索引');expect(()=>restoreIteration(dir,job,index as any)).toThrow('索引');
 }}finally{rmSync(dir,{recursive:true,force:true});}
});
