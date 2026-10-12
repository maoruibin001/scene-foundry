import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {judgeRequest} from './judge-request';
import {digest,save} from './store';
import {profileQualityPolicy,PROFILE_QUALITY_VERSION} from './quality';
import {PROFILE_CRITERION_DIMENSIONS} from './atomic-criteria';

test('normal judge request freezes six independent dimensions on the same verified Engine evidence, with no extra call',()=>{
 const dir=mkdtempSync(join(tmpdir(),'profile-judge-evidence-'));
 try{
  for(const p of ['project/evidence','project/game/dist','runtime'])mkdirSync(join(dir,p),{recursive:true});
  const dist='fixed-build',frame='fixture-pixels',distDigest=digest(dist);writeFileSync(join(dir,'project/game/dist/forgeax-dist.json'),dist);writeFileSync(join(dir,'runtime/reference-1.png'),frame);
  const profile={engineSha:'a'.repeat(40),generatorSha:'b'.repeat(40)},stages=['candidate','generate-export','generation-budget','publish-assets','engine-binding','project-check','engine-build','catalog','asset-verify','asset-ready','engine-status'];
  save(join(dir,'project/evidence/run-report.json'),{...profile,stages:Object.fromEntries(stages.map(s=>[s,{status:'passed'}])),buildInputDigest:'d'.repeat(64),distManifestDigest:distDigest,catalog:{sha256:'e'.repeat(64)}});
  const runtime={distManifestDigest:distDigest,hard:{runtime:true,entitiesLoaded:true,noErrors:true,frameRate:true},submittedFps:30,images:['reference-1.png'],hashes:[digest(frame)]};
  const weights={coverage:20,spatial:15,shape:10,material:15,lighting:25,readability:15};
  const job={profile,policy:profileQualityPolicy(weights),prompt:'测试场景',images:[],modelSettings:{model:'fixed',reasoningEffort:'xhigh'},structure:{semanticCounts:{}}};
  const plan={qualityVersion:PROFILE_QUALITY_VERSION,requirements:[{id:'R',source:'image',critical:true,weight:1}],acceptanceCriteria:PROFILE_CRITERION_DIMENSIONS.map((dimension,i)=>({id:'C'+i,requirementId:'R',dimension,description:'独立可见'+dimension,source:'image',critical:true,weight:1,evidence:['图1实际依据']}))};
  const request=judgeRequest(job,plan,runtime,dir,new AbortController().signal),input=JSON.parse(request.text);
  expect(request.schemaContext.qualityVersion).toBe(PROFILE_QUALITY_VERSION);expect(request.system).toContain('六维评分');expect(request.system).toContain('不能复制原子均值或从材质/可读性分推算 lighting');expect(request.system).not.toContain('既定80分及每维3/5');
  expect(input.scoring).toMatchObject({version:PROFILE_QUALITY_VERSION,minimumScore:70,dimensionFloor:0});expect(input.scoring.dimensions.map((d:any)=>d.id)).toEqual([...PROFILE_CRITERION_DIMENSIONS]);expect(input.frameNames).toEqual(runtime.images);expect(request.images).toHaveLength(1);expect(input.verifiedRuntimeEvidence.engine).toBe('ForgeaX Engine');
  const legacyPlan={...plan,qualityVersion:'scene-quality-v7',acceptanceCriteria:plan.acceptanceCriteria.filter(c=>c.dimension!=='lighting')};expect(()=>judgeRequest(job,legacyPlan,runtime,dir,new AbortController().signal)).toThrow('标准');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
