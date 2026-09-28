import {test,expect} from 'bun:test';
import {rmSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {reuseMode,crossTaskReuse} from './reuse-mode';
import {cacheEnabled} from './validated-cache';
import {generationInput} from './reference-input';
import {automaticContinuationOptions} from './provider-recovery';
import {checkpointFixture} from './geometry/checkpoint-fixture';
import {importTextureResource,jobTextureCandidates,jobTextureReuse} from './geometry/texture-library';
import {savedStage} from './geometry/saved-stage';
import {runDir,save} from './store';
test('fresh is persisted through automatic recovery and disables all cross-job model cache roles',()=>{
 const source={id:randomUUID(),prompt:'从头',reuseMode:'fresh',generationMode:'first-pass',matchingLevel:'standard',optimizationPolicy:{reuse:true}};
 expect(reuseMode()).toBe('auto');expect(()=>reuseMode('anything')).toThrow();
 const next={...generationInput(source),...automaticContinuationOptions(source,true),optimizationPolicy:source.optimizationPolicy};
 expect(next).toMatchObject({reuseMode:'fresh',generationMode:'first-pass',executionRecoveryRoot:source.id,attempt:1});
 for(const role of ['plan','scene-observation','scene-space','scene-surface','scene-blockout','geometry-asset'])expect(cacheEnabled(next,role)).toBe(false);
 expect(crossTaskReuse(next)).toBe(false);expect(cacheEnabled({optimizationPolicy:{reuse:true}},'plan')).toBe(true);
});
test('identical old checkpoint cannot satisfy fresh run; only its own chain can restore real geometry',()=>{
 const f=checkpointFixture();try{
 const old=f.store.register(f.registration),fresh={...f.job,id:randomUUID(),reuseMode:'fresh'};
 expect(f.store.matching(fresh)).toHaveLength(0);expect(()=>f.store.load(old.id,fresh)).toThrow('不匹配');
 const own=f.store.register({...f.registration,job:fresh});
 const resumed={...fresh,id:randomUUID(),...automaticContinuationOptions(fresh,true)};
 expect(f.store.matching(resumed).map(x=>x.id)).toEqual([own.id]);
 expect(f.store.restore(own.id,resumed,join(f.root,'fresh-restored')).assets[0].value).toEqual(f.geometry);
 expect(f.store.matching({...fresh,id:randomUUID()})).toHaveLength(0);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
test('warm reference texture library cannot leak old pixels into a fresh surface plan',()=>{
 const f=checkpointFixture();try{
 const root=join(f.root,'textures'),ref='a'.repeat(64),texture={width:1,height:1,rgba8:Buffer.from([90,80,70,255]).toString('base64'),colorSpace:'srgb' as const};
 const id=importTextureResource({label:'wood',description:'wood',referenceSha256:[ref],texture,source:{jobId:'old'}},root);
 const binding={textures:[{id:'t'}],textureReuse:[{textureId:'t',assetId:id,reason:'same reference'}]};
 expect(jobTextureCandidates({},[ref],root)).toHaveLength(1);expect(jobTextureCandidates({reuseMode:'fresh'},[ref],root)).toHaveLength(0);
 expect(()=>jobTextureReuse({reuseMode:'fresh'},binding,[ref],root)).toThrow('禁用');expect(jobTextureReuse({reuseMode:'fresh'},{textures:[]},[ref],root)).toEqual([]);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
test('stage recovery retains own saved work but rejects a historical chain with identical input',()=>{
 const id=randomUUID(),dest=randomUUID(),folder=join(runDir(id),'generation');
 try{mkdirSync(folder,{recursive:true});const source={id,reuseMode:'fresh',executionRecoveryRoot:id,prompt:'图',images:[],plan:{requirements:[]},modelSettings:{model:'fixture'}};
 save(join(runDir(id),'job.json'),source);save(join(folder,'scene-space-response.txt'),{camera:1});save(join(folder,'scene-space-receipt.json'),{requestedModel:'fixture'});
 const target={...source,id:dest,recoverySourceJobId:id},ctx={job:target,plan:source.plan};
 expect(savedStage(ctx,'scene-space',v=>v)?.value).toEqual({camera:1});
 expect(savedStage({...ctx,job:{...target,executionRecoveryRoot:dest}},'scene-space',v=>v)).toBeNull();
 }finally{rmSync(runDir(id),{recursive:true,force:true});}
});
test('real validated-call entry bypasses a warm cache and performs new work for a fresh job',async()=>{
 const {callValidated}=await import('./contracts'),{OPTIMIZATION_POLICY}=await import('./generation-policy');
 const ids=[randomUUID(),randomUUID()],dirs=ids.map(runDir);let calls=0;
 try{
 for(const [i,id] of ids.entries()){mkdirSync(dirs[i],{recursive:true});save(join(dirs[i],'job.json'),{id,reuseMode:i?'fresh':'auto',profile:{provider:'test'},optimizationPolicy:OPTIMIZATION_POLICY});}
 const input={role:'plan',system:'fixture',text:ids[0],maxTokens:100,modelSettings:{model:'gpt-6-astra-aihub-azure',reasoningEffort:'xhigh'}},request=async()=>({value:{count:++calls},receipt:{requestedModel:input.modelSettings.model}});
 await callValidated(input,dirs[0],v=>v,request as any);
 const fresh=await callValidated(input,dirs[1],v=>v,request as any);
 expect(calls).toBe(2);expect(fresh.value.count).toBe(2);expect(fresh.reuse).toBeUndefined();
 const old=await callValidated(input,dirs[0],v=>v,request as any);expect(calls).toBe(2);expect(old.value.count).toBe(1);
 }finally{for(const dir of dirs)rmSync(dir,{recursive:true,force:true});}
});
test('explicit fresh first-pass baseline is separate from exhausted historical repairs; continuation is not a new trial',async()=>{
 const {ImprovementLedger}=await import('./improvement-governance');const f=checkpointFixture();try{
 const ledger=new ImprovementLedger(join(f.root,'ledger')),old={prompt:'原图',images:[]};const oldId=ledger.enter(old,'old');ledger.markStopped(oldId,'旧质量策略已用完');
 const fresh={...old,baselineId:'confirmed-reference',reuseMode:'fresh',generationMode:'first-pass'};
 const id=ledger.enter(fresh,'new',[{id:'old',status:'failed'}]);expect(id).not.toBe(oldId);expect(ledger.get(id).repairs).toBe(0);expect(ledger.get(oldId).stopped).toBe('旧质量策略已用完');
 const continuation={...fresh,modelSettings:{model:'changed'},pipelineVersion:{id:'new-version'}};
 expect(ledger.key(continuation)).toBe(id);expect(ledger.enter(continuation,'recovery',[],{improvementId:id},'continuation')).toBe(id);expect(ledger.get(id).repairs).toBe(0);
 expect(ledger.get(id).history[0].id).toBe('old');expect(ledger.key({...fresh,reuseMode:'auto'})).toBe(oldId);expect(ledger.key({...fresh,generationMode:'bounded'})).toBe(oldId);
 expect(ledger.get(id).firstPassBaseline).toBe('confirmed-reference');
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
