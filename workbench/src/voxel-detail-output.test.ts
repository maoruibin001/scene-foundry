import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {digest,save,read} from './store';
import {sealAssessment,preserveOutput} from './output-delivery';
import {compilePipelinePlan} from './pipeline-plan';
import {profileQualityPolicy} from './quality';
import {scoringSignature} from './weighted-reassessment';

test('retained output and its normal ZIP keep voxel basis plus all frozen profile sidecars byte-for-byte',()=>{
 const root=mkdtempSync(join(tmpdir(),'voxel-detail-output-'));
 try{
  for(const p of ['runtime','project/game/dist','project/evidence'])mkdirSync(join(root,p),{recursive:true});
  const dist='{"fixture":"source-preservation-only"}',frame='fixture frame',hash=digest(dist);
  writeFileSync(join(root,'project/game/dist/forgeax-dist.json'),dist);writeFileSync(join(root,'runtime/view.png'),frame);
  const plan=compilePipelinePlan({pipelinePreset:'effects'},{engineSha:'engine',generatorSha:'generator'})!,policy=profileQualityPolicy(plan.weights);
  const runtime={distManifestDigest:hash,hard:{runtime:true,noErrors:true,entitiesLoaded:true},images:['view.png'],hashes:[digest(frame)]};
  const spec={status:'passed',rules:[]},quality={status:'passed',score:80};
  const binding={candidateSha256:hash,sourceAssessmentSha256:'c'.repeat(64),scoringSignature:scoringSignature(policy.version,plan.weights)};
  const job:any={id:'output-contract-fixture',pipelineVersion:{id:'v'},status:'passed',profile:{engineSha:'engine',generatorSha:'generator'},policy,pipelinePlan:plan,runtime,quality,spec,
   commonDeliveryAssessment:{...binding,status:'passed'},goalAssessment:{...binding,status:'passed'},defaultBenchmarkAssessment:{...binding,sourceScoringSignature:binding.scoringSignature,scoringSignature:'old-benchmark'},deliveryAssessment:{...binding,standard:'profile70',scoringVersion:policy.version,dimensionWeights:plan.weights,status:'passed',score:80,rawScore:75}};
  save(join(root,'runtime/runtime.json'),runtime);save(join(root,'quality.json'),quality);save(join(root,'review.json'),{summary:'contract fixture'});save(join(root,'spec-report.json'),spec);
  save(join(root,'project/evidence/run-report.json'),{distManifestDigest:hash,engineSha:'engine',generatorSha:'generator',browser:{distManifestDigest:hash},spec,stages:Object.fromEntries(['engine-build','catalog','asset-verify','asset-ready','engine-status'].map(k=>[k,{status:'passed'}]))});
  save(join(root,'voxel-detail-basis.json'),{version:'voxel-detail-basis-v1',source:'immutable fixture'});save(join(root,'voxel-detail-validation.json'),{sourceSceneSha256:'d'.repeat(64),fixture:true});
  sealAssessment(job,root);
  const files=['voxel-detail-basis.json','voxel-detail-validation.json','pipeline-plan.json','common-delivery-assessment.json','goal-assessment.json','default-benchmark-assessment.json'];
  const expected=Object.fromEntries(files.map(f=>[f,digest(readFileSync(join(root,f)))]));
  const output=preserveOutput(job,root,'','scene')!;expect(output.folder).toMatch(/^delivery\/outputs\/scene-/);
  for(const f of files)expect(digest(readFileSync(join(root,output.folder,f)))).toBe(expected[f]);
  // Later current-root changes must not substitute evidence in the retained candidate's package.
  save(join(root,'voxel-detail-basis.json'),{source:'different later candidate'});
  const packaged=Bun.spawnSync(['python3',join(import.meta.dirname,'output-package.py'),root],{stdin:Buffer.from(JSON.stringify({best:output})),stdout:'pipe',stderr:'pipe'});
  expect(packaged.exitCode).toBe(0);const receipt=JSON.parse(packaged.stdout.toString());
  const audit=Bun.spawnSync(['python3','-c','import json,sys,zipfile,hashlib\nwith zipfile.ZipFile(sys.argv[1]) as z:\n m=json.loads(z.read("manifest.sha256.json")); print(json.dumps({"crc":z.testzip(),"hashes":{f:hashlib.sha256(z.read(f)).hexdigest() for f in json.loads(sys.argv[2])},"valid":all(hashlib.sha256(z.read(f)).hexdigest()==h for f,h in m.items())}))',join(root,receipt.file),JSON.stringify(files)],{stdout:'pipe',stderr:'pipe'});
  expect(audit.exitCode).toBe(0);expect(JSON.parse(audit.stdout.toString())).toEqual({crc:null,hashes:expected,valid:true});
  expect(read(join(root,output.folder,'voxel-detail-basis.json')).source).toBe('immutable fixture');
 }finally{rmSync(root,{recursive:true,force:true});}
});
