import {test,expect} from 'bun:test';
import {verifyScoreControl,scoreControlEvidence} from './score-controls';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {readFileSync} from 'node:fs';
import {digest} from '../store';
import {DEFAULT_POLICY,DIMENSIONS,HARD_CHECKS} from '../quality';
import {VISUAL_RULE_IDS} from '../spec';
import {assess} from '../assessment';
test('变更的对照证据排除并注明原因，不提供新分数',()=>{const root=mkdtempSync(join(tmpdir(),'score-control-'));try{mkdirSync(join(root,'run'));writeFileSync(join(root,'run/job.json'),'{}');writeFileSync(join(root,'review.json'),'{}');const record={sourceJobId:'run',folder:root,files:{'review.json':'not-the-real-hash'}};expect(()=>verifyScoreControl(record,id=>join(root,id))).toThrow('对照产物变化');mkdirSync(join(root,'registry'));writeFileSync(join(root,'registry/broken.json'),JSON.stringify(record));const r=scoreControlEvidence({},undefined,join(root,'registry'),id=>join(root,id));expect(r.controls).toHaveLength(0);expect(r.excluded).toHaveLength(1);}finally{rmSync(root,{recursive:true,force:true});}});

test('评分对照以保存的标准档阶段深度验证，未知降档与错误路由仍拒绝',()=>{
 const root=mkdtempSync(join(tmpdir(),'score-control-depth-')),run=join(root,'run'),folder=join(root,'control');
 const write=(file:string,value:any)=>{mkdirSync(join(file,'..'),{recursive:true});writeFileSync(file,JSON.stringify(value));};
 const hash=(file:string)=>digest(readFileSync(file));
 try{
  mkdirSync(run);mkdirSync(folder);const image=join(run,'view.png');writeFileSync(image,'fixed captured frame');
  const frames=['view.png'],runtime={images:frames,hashes:[hash(image)],hard:Object.fromEntries(HARD_CHECKS.map(k=>[k,true])),submittedFps:30};
  const review={requirements:[{id:'R1',verdict:'met',reason:'主体可见',frames}],dimensions:DIMENSIONS.map(d=>({id:d.id,score:4,reason:'实际观测',frames})),confidence:.9,specRules:VISUAL_RULE_IDS.map(id=>({id,status:'passed',reason:'实际观测',frames})),entityCounts:[{kind:'machine',visibleMin:1,visibleMax:1}]};
  const job:any={id:'run',images:[],profile:{judgeModel:'gpt-6-astra-aihub-openai',reasoningEffort:'xhigh',executionRoute:{configurationSha256:'route'}},optimizationPolicy:{version:'reuse-parallel-v2',reasoning:'phase-capped',matchingLevel:'standard'},policy:DEFAULT_POLICY,plan:{requirements:[{id:'R1',critical:true,weight:1}]},structure:{passed:true,semanticCounts:{machine:1}},stages:{build:{status:'passed'},verify:{status:'passed'}},runtime};
  job.quality=assess(job,review,runtime).quality;write(join(run,'job.json'),job);write(join(run,'quality.json'),job.quality);write(join(run,'generated-scene.json'),{id:'saved-scene'});
  write(join(folder,'judge-input-receipt.json'),{images:[{path:image,sha256:hash(image)}]});write(join(folder,'review.json'),review);write(join(folder,'result.json'),{sourceId:job.id,originalScore:job.quality.score,repeatScore:job.quality.score});
  const verify=(effort:string,route='route')=>{
   write(join(folder,'judge-receipt.json'),{role:'judge',stopReason:'completed',cliModel:job.profile.judgeModel,cliReasoningEffort:effort,executionRoute:{configurationSha256:route}});
   return verifyScoreControl({sourceJobId:job.id,folder,files:Object.fromEntries(['judge-input-receipt.json','judge-receipt.json','review.json','result.json'].map(f=>[f,hash(join(folder,f))])),qualitySha256:hash(join(run,'quality.json')),sceneFileSha256:hash(join(run,'generated-scene.json'))},()=>run);
  };
  expect(verify('high').repeatScore).toBe(job.quality.score);
  expect(()=>verify('medium')).toThrow('深度不匹配');expect(()=>verify('high','wrong')).toThrow('路由不匹配');
  delete job.optimizationPolicy;write(join(run,'job.json'),job);expect(()=>verify('high')).toThrow('深度不匹配');expect(verify('xhigh').repeatScore).toBe(job.quality.score);
 }finally{rmSync(root,{recursive:true,force:true});}
});
