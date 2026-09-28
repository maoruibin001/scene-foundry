import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ValidatedCache,validatedKey,cacheEnabled} from './validated-cache';
import {OPTIMIZATION_POLICY,roleSettings,assetSettings} from './generation-policy';
import {runDir,save,read} from './store';
import {callValidated} from './contracts';

const valid=(v:any)=>{if(v.answer!==42)throw Error('bad geometry');return v;};
test('重复并发请求只执行一次；持久缓存重启后可用；损坏或验证失败重新生成',async()=>{
 const root=mkdtempSync(join(tmpdir(),'validated-cache-')),cache=new ValidatedCache(root);let count=0,finish:any;
 const compute=async()=>{count++;await new Promise(r=>finish=r);return {value:{answer:42},receipt:{model:'astra'}};};
 try{const a=cache.use('test',valid,compute,{jobId:'a'});const b=cache.use('test',valid,compute,{jobId:'b'});await Bun.sleep(1);expect(count).toBe(1);finish();expect((await a).reuse).toBeNull();expect((await b).reuse?.kind).toBe('shared-inflight');
  expect((await new ValidatedCache(root).use('test',valid,()=>{throw Error('must not call');},{jobId:'c'})).reuse?.jobId).toBe('a');
  writeFileSync(join(root,'test.json'),'{broken');await cache.use('test',valid,async()=>{count++;return {value:{answer:42}};},{jobId:'d'});expect(count).toBe(2);
  expect(cache.get('test',()=>{throw Error('new contract rejects');})).toBeNull();
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('取消等待者不打断共享生成，失败不写缓存',async()=>{
 const root=mkdtempSync(join(tmpdir(),'cache-cancel-')),cache=new ValidatedCache(root),ctl=new AbortController();let finish:any;
 try{const a=cache.use('test',valid,async()=>{await new Promise(r=>finish=r);return {value:{answer:42}};},{jobId:'a'});const b=cache.use('test',valid,async()=>{throw Error('duplicate');},{jobId:'b'},ctl.signal);ctl.abort(Error('user cancelled'));await expect(b).rejects.toThrow('user cancelled');finish();await a;expect(cache.get('test',valid)).not.toBeNull();
  await expect(cache.use('failure',valid,async()=>{throw Error('upstream timeout');},{jobId:'a'})).rejects.toThrow('upstream timeout');expect(cache.get('failure',valid)).toBeNull();
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('缓存绑定图片内容、顺序、模型强度和版本；独立评测与验收从不复用模型结果',()=>{
 const root=mkdtempSync(join(tmpdir(),'cache-key-'));try{const a=join(root,'a'),b=join(root,'b');writeFileSync(a,'one');writeFileSync(b,'two');const input={role:'plan',system:'中文',text:'输入',maxTokens:100,modelSettings:{model:'gpt-6-astra',reasoningEffort:'high'},images:[{path:a,mime:'image/png'},{path:b,mime:'image/png'}]},identity={version:'one'},key=validatedKey(input,identity);
 for(const next of [{...input,images:[...input.images].reverse()},{...input,text:'改动'},{...input,modelSettings:{...input.modelSettings,reasoningEffort:'xhigh'}}])expect(validatedKey(next,identity)).not.toBe(key);expect(validatedKey(input,{version:'two'})).not.toBe(key);writeFileSync(a,'changed');expect(validatedKey(input,identity)).not.toBe(key);
 const job={optimizationPolicy:OPTIMIZATION_POLICY};expect(cacheEnabled(job,'plan')).toBe(true);expect(cacheEnabled({...job,batchId:'benchmark'},'plan')).toBe(false);for(const role of ['judge','scene-space-judge'])expect(cacheEnabled(job,role)).toBe(false);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('冻结的旧版阶段策略仍按原 Astra 规则运行',()=>{
 const base={model:'gpt-6-astra-aihub-openai',reasoningEffort:'xhigh'},policy={version:'reuse-parallel-v1',reasoning:'bounded-high',spatialPreflight:'coarse-v2'};
 for(const role of ['plan','scene-blockout','scene-surface','scene-repair-plan','scene-alignment'])expect(roleSettings(base,role,policy)?.reasoningEffort).toBe('high');
 for(const role of ['scene-space','scene-space-judge'])expect(roleSettings(base,role,policy)?.reasoningEffort).toBe('high');
 for(const role of ['scene-observation','judge','scene-spatial-refine'])expect(roleSettings(base,role,policy)).toEqual(base);
 expect(roleSettings(base,'plan',null)).toEqual(base);expect(roleSettings({...base,model:'other'},'plan',policy)?.reasoningEffort).toBe('xhigh');expect(base.reasoningEffort).toBe('xhigh');
 const job={modelSettings:base,optimizationPolicy:policy},layout={program:{instances:[]}};expect(assetSettings(job,{label:'木桶',description:'木板圆桶'},layout)?.reasoningEffort).toBe('high');expect(assetSettings(job,{label:'石墙',description:'带门洞'},layout)?.reasoningEffort).toBe('xhigh');
});
test('实际 callValidated 入口先分配角色强度，重复任务命中时保留来源回执',async()=>{
 const id=crypto.randomUUID(),dir=runDir(id);mkdirSync(dir,{recursive:true});save(join(dir,'job.json'),{id,pipelineVersion:{id},profile:{provider:'test'},optimizationPolicy:OPTIMIZATION_POLICY});let calls=0;
 try{const input={role:'plan',system:'测试结构化抽取',text:id,maxTokens:100,modelSettings:{model:'gpt-6-astra-aihub-openai',reasoningEffort:'xhigh'}},request=async(value:any)=>{calls++;expect(value.modelSettings.reasoningEffort).toBe('medium');return {value:{answer:42},receipt:{requestedModel:value.modelSettings.model,reasoningEffort:value.modelSettings.reasoningEffort,durationMs:22}};};
  await callValidated(input,dir,valid,request as any);const result=await callValidated(input,dir,valid,request as any);expect(calls).toBe(1);expect(result.receipt.reused).toBe(true);expect(read(join(dir,'plan-reuse.json')).jobId).toBe(id);expect(result.receipt.originalReceipt.durationMs).toBe(22);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
