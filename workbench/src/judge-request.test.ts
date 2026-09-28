import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {judgeRequest} from './judge-request';
import {digest,save} from './store';
import {OPTIMIZATION_POLICY} from './generation-policy';
import {matchingPolicy} from './matching-level';
import {DEFAULT_POLICY} from './quality';
test('统一评分请求只使用已核实的固定运行画面，篡改图像在调用前失败',()=>{
 const dir=mkdtempSync(join(tmpdir(),'judge-evidence-'));
 try{
  for(const p of ['project/evidence','project/game/dist','runtime'])mkdirSync(join(dir,p),{recursive:true});
  const dist='fixed-build',frame='fixture-pixels',distDigest=digest(dist);writeFileSync(join(dir,'project/game/dist/forgeax-dist.json'),dist);writeFileSync(join(dir,'runtime/reference-1.png'),frame);
  const profile={engineSha:'a'.repeat(40),generatorSha:'b'.repeat(40)},stages=['candidate','generate-export','generation-budget','publish-assets','engine-binding','project-check','engine-build','catalog','asset-verify','asset-ready','engine-status'];
  save(join(dir,'project/evidence/run-report.json'),{...profile,stages:Object.fromEntries(stages.map(s=>[s,{status:'passed'}])),buildInputDigest:'d'.repeat(64),distManifestDigest:distDigest,catalog:{sha256:'e'.repeat(64)}});
  const runtime={distManifestDigest:distDigest,hard:{runtime:true,entitiesLoaded:true,noErrors:true,frameRate:true},submittedFps:30,images:['reference-1.png'],hashes:[digest(frame)]};
  const job={profile,policy:DEFAULT_POLICY,prompt:'测试场景',images:[],modelSettings:{model:'fixed',reasoningEffort:'xhigh'},structure:{semanticCounts:{结构:1}}};
  const request=judgeRequest(job,{requirements:[]},runtime,dir,new AbortController().signal),input=JSON.parse(request.text);expect(request.modelSettings).toEqual(job.modelSettings);expect(input.frameNames).toEqual(runtime.images);expect(input.scoring.minimumScore).toBe(80);expect(input.verifiedRuntimeEvidence.engine).toBe('ForgeaX Engine');expect(input.verifiedRuntimeEvidence.runtime.performance).toMatchObject({submittedFps:30,minimumSubmittedFps:10,frameRateCheckPassed:true,p95FrameMs:null,minWindowFps:null,recordedVideoFps:null});
  const standard=judgeRequest({...job,modelSettings:{model:'gpt-6-astra-aihub-azure',reasoningEffort:'xhigh'},matchingPolicy:matchingPolicy('standard'),optimizationPolicy:{...OPTIMIZATION_POLICY,matchingLevel:'standard'}},{requirements:[]},runtime,dir,new AbortController().signal);const brief=JSON.parse(standard.text);expect(standard.modelSettings.reasoningEffort).toBe('high');expect(standard.images).toEqual(request.images);expect(brief.scoring).toEqual(input.scoring);expect(brief.sourceSpecification).toBeUndefined();expect(brief.visualRules).toEqual(input.visualRules);
  const failedFraming={...runtime,hard:{...runtime.hard,framing:false}};const diagnostic=JSON.parse(judgeRequest(job,{requirements:[]},failedFraming,dir,new AbortController().signal).text);expect(diagnostic.runtimeFailures).toEqual(['framing']);expect(diagnostic.runtimeHardChecks.framing).toBe(false);expect(()=>judgeRequest(job,{}, {...runtime,hard:{...runtime.hard,noErrors:false}},dir,new AbortController().signal)).toThrow('运行证据');
  writeFileSync(join(dir,'runtime/reference-1.png'),'altered');expect(()=>judgeRequest(job,{},runtime,dir,new AbortController().signal)).toThrow('画面摘要');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
