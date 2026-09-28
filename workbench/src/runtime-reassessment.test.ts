import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {save,read,digest} from './store';
import {recaptureAssessment} from './runtime-reassessment';
import {automaticGeneration} from './quality';

function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'runtime-reassessment-'));
 for(const p of ['runtime','project/game/assets','project/game/dist','project/evidence'])mkdirSync(join(dir,p),{recursive:true});
 const profile={engineSha:'a'.repeat(40),generatorSha:'b'.repeat(40)},manifest=join(dir,'project/game/dist/forgeax-dist.json');
 save(manifest,{scene:'unchanged'});const hash=digest(readFileSync(manifest));
 save(join(dir,'project/game/assets/scene-audit.json'),{views:[{referenceIndex:1},{referenceIndex:null}]});
 save(join(dir,'project/evidence/run-report.json'),{...profile,distManifestDigest:hash,buildInputDigest:'c'.repeat(64),catalog:{sha256:'d'.repeat(64)},stages:Object.fromEntries(['candidate','generate-export','generation-budget','publish-assets','engine-binding','project-check','engine-build','catalog','asset-verify','asset-ready','engine-status'].map(k=>[k,{status:'passed'}]))});
 const runtime={submittedFps:40,distManifestDigest:hash,hard:{runtime:true,noErrors:true,frameRate:true,entitiesLoaded:true,framing:false},images:['view.png'],hashes:[digest('new frame')]};
 save(join(dir,'runtime/runtime.json'),runtime);writeFileSync(join(dir,'runtime/view.png'),'old frame');
 const job:any={id:'next',reuseAssessmentFrom:'source',recaptureRuntime:true,validationKind:'runtime-reassessment',sceneProgram:{version:'scene-v1'},profile,pipelineVersion:{id:'new'},policy:{minSubmittedFps:10},runtime,status:'running',stage:'runtime'};
 const calls:string[]=[];
 const deps={stage:async(name:string,fn:Function)=>{calls.push(name);return fn();},preview:async()=>{calls.push('preview');return 'http://localhost:1';},command:async()=>{calls.push('capture');save(join(dir,'runtime/runtime.json'),{...runtime,hard:{...runtime.hard,framing:true}});writeFileSync(join(dir,'runtime/view.png'),'new frame');}};
 return {dir,job,deps,calls,manifest,cleanup:()=>rmSync(dir,{recursive:true,force:true})};
}
test('运行复评保留旧证据，重新采集同一构建，评分前持久交付且不算新生成',async()=>{
 const f=fixture();try{await recaptureAssessment(f.job,f.dir,f.deps);expect(f.calls).toEqual(['runtime','preview','capture']);expect(read(join(f.dir,'runtime-source/runtime.json')).hard.framing).toBe(false);expect(f.job.runtime.hard.framing).toBe(true);expect(f.job.quality).toBeUndefined();expect(read(join(f.dir,'delivery.json')).available).toBe(true);expect(f.job.runtimeReassessment.sourceJobId).toBe('source');expect(automaticGeneration(f.job)).toBe(false);}finally{f.cleanup();}
});
test('采集失败不复用旧hard通过值，原始证据仍可追溯',async()=>{
 const f=fixture();try{f.deps.command=async()=>{throw Error('capture interrupted');};await expect(recaptureAssessment(f.job,f.dir,f.deps)).rejects.toThrow('capture interrupted');expect(f.job.runtime).toBeNull();expect(existsSync(join(f.dir,'runtime-source/runtime.json'))).toBe(true);expect(existsSync(join(f.dir,'runtime-reassessment.json'))).toBe(false);}finally{f.cleanup();}
});
test('改动构建或伪造图片摘要不能通过运行复评',async()=>{
 for(const kind of ['build','image']){const f=fixture();try{const capture=f.deps.command;f.deps.command=async()=>{await capture();if(kind==='build')save(f.manifest,{scene:'changed'});else writeFileSync(join(f.dir,'runtime/view.png'),'tampered');};await expect(recaptureAssessment(f.job,f.dir,f.deps)).rejects.toThrow(kind==='build'?'不得改变':'摘要不一致');expect(f.job.runtime).toBeNull();expect(existsSync(join(f.dir,'runtime-reassessment.json'))).toBe(false);}finally{f.cleanup();}}
});
