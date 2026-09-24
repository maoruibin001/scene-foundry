import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync,cpSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {repairHistory} from './repair-history';
import {digest} from '../store';
import {comparableAssessment} from './refinement-baseline';

function fixture(){
 const root=mkdtempSync(join(tmpdir(),'repair-history-')),locate=(id:string)=>join(root,id),save=(id:string,f:string,v:any)=>{const p=join(locate(id),f);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,JSON.stringify(v));};
 const source={name:'真实来源',instances:[1]},after={name:'真实来源',instances:[2]},refs=[digest('reference')];
 const policy={version:'scene-quality-v4',score:80},profile={provider:'codex-cli',judgeModel:'fixed',reasoningEffort:'xhigh',executionRoute:{configurationSha256:'route'},specSha256:'spec',policy,engineSha:'engine',generatorSha:'generator'};
 const target:any={id:'target',status:'running',prompt:'复刻空间',complexity:'complex',images:refs.map(id=>({id})),policy,profile};
 const candidate={...structuredClone(target),id:'candidate',status:'failed',endedAt:1000,pipelineVersion:{id:'candidate-version',label:'rc'}};
 const beforeQuality={status:'failed',score:61,dimensions:[{id:'spatial',score:3.2}]},quality={status:'failed',score:60,dimensions:[{id:'spatial',score:3}]};
 save('parent','generated-scene.json',source);save('parent','quality.json',beforeQuality);
 const folder='generation/refinement/';
 save('candidate',folder+'source.json',{sourceJobId:'parent',sourceIteration:null,sourceDigest:digest(JSON.stringify(source)),referenceSha256:refs,qualityBefore:beforeQuality});
 save('candidate',folder+'receipt.json',{sourceDigest:digest(JSON.stringify(source)),sceneDigest:digest(JSON.stringify(after))});
 save('candidate',folder+'patch.json',{reason:'此前只调整局部',instances:[{id:'furniture'}],parts:[],cameras:[]});
 save('candidate',folder+'repair-goals.json',{goals:[{kind:'layout',dimension:'spatial',problem:'层次偏差',expectedChange:'层次更明确',instanceIds:['furniture'],templateIds:[],materialIds:[],cameraNames:[]}],deferred:[{problem:'主要建筑比例',reason:'额度留给局部'}]});
 save('candidate','generated-scene.json',after);save('candidate','quality.json',quality);save('candidate','review.json',{summary:'实际比例仍有误差',dimensions:[{id:'spatial',score:3,reason:'建筑比例错误'}],requirements:[{id:'R1',verdict:'partial',reason:'空间未还原'}]});
 save('candidate','runtime/runtime.json',{images:['reference-1.png'],hashes:[digest('actual render')]});writeFileSync(join(locate('candidate'),'runtime/reference-1.png'),'actual render');
 return {root,locate,save,source,after,refs,target,candidate,quality,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
test('同源修正的真实下降和暂缓问题进入上下文，不修改历史产物',()=>{
 const f=fixture();try{
  const before=readFileSync(join(f.locate('candidate'),'quality.json'),'utf8'),h=repairHistory(f.target,f.source,f.refs,{jobs:[f.candidate],locate:f.locate});
  expect(h.totalVerified).toBe(1);expect(h.excluded).toEqual([]);expect(h.attempts[0]).toMatchObject({scoreBefore:61,scoreAfter:60,scoreGain:-1,relation:'same-source'});expect(h.attempts[0].deferred[0].problem).toBe('主要建筑比例');expect(h.attempts[0].conclusion).toContain('不得仅重复');expect(readFileSync(join(f.locate('candidate'),'quality.json'),'utf8')).toBe(before);
 }finally{f.cleanup();}
});
test('不同输入、不同评审配置、不同引擎、无关场景和运行中的根记录不能混入',()=>{
 const f=fixture();try{
  for(const mutate of [(j:any)=>j.prompt='其他输入',(j:any)=>j.images=[{id:'other'}],(j:any)=>j.policy.score=90,(j:any)=>j.profile.judgeModel='other',(j:any)=>j.profile.engineSha='other',(j:any)=>j.status='running']){
   const j=structuredClone(f.candidate);mutate(j);expect(repairHistory(f.target,f.source,f.refs,{jobs:[j],locate:f.locate}).attempts).toHaveLength(0);
  }
  expect(repairHistory(f.target,{unrelated:true},f.refs,{jobs:[f.candidate],locate:f.locate}).attempts).toHaveLength(0);
 }finally{f.cleanup();}
});
test('截图、来源场景或修改回执不匹配时显式排除，未评分失败不冒充质量证据',()=>{
 for(const change of ['frame','parent','receipt','unscored']){
  const f=fixture();try{
   if(change==='frame')writeFileSync(join(f.locate('candidate'),'runtime/reference-1.png'),'changed');
   if(change==='parent')f.save('parent','generated-scene.json',{changed:true});
   if(change==='receipt')f.save('candidate','generation/refinement/receipt.json',{sourceDigest:'wrong',sceneDigest:'wrong'});
   if(change==='unscored')rmSync(join(f.locate('candidate'),'quality.json'));
   const h=repairHistory(f.target,f.source,f.refs,{jobs:[f.candidate],locate:f.locate});expect(h.attempts).toHaveLength(0);expect(h.excluded.length).toBe(change==='unscored'?0:1);
  }finally{f.cleanup();}
 }
});
test('当前自动迭代中的已完成快照可读取，不需要等整个任务终态，重复恢复不重复计数',()=>{
 const f=fixture();try{
  const dir=f.locate('candidate'),snap=join(dir,'iterations/1');mkdirSync(snap,{recursive:true});
  for(const name of ['generated-scene.json','quality.json','review.json','runtime'])cpSync(join(dir,name),join(snap,name),{recursive:true});
  cpSync(join(dir,'generation/refinement'),join(dir,'generation/iteration-1/refinement'),{recursive:true});
  f.save('candidate','iterations/1/candidate.json',{jobId:'candidate',pipelineVersionId:'candidate-version',cycle:{index:1,status:'failed',endedAt:1000},fields:{quality:f.quality}});
  const active={...f.candidate,status:'running'},h=repairHistory({...f.target,id:'candidate'},f.after,f.refs,{jobs:[active],locate:f.locate});
  expect(h.attempts[0]).toMatchObject({iteration:1,status:'failed',relation:'current-scene-result'});
  cpSync(dir,f.locate('duplicate'),{recursive:true});f.save('duplicate','iterations/1/candidate.json',{jobId:'duplicate',pipelineVersionId:'candidate-version',cycle:{index:1,status:'failed',endedAt:1100},fields:{quality:f.quality}});
  expect(repairHistory(f.target,f.source,f.refs,{jobs:[{...f.candidate,id:'duplicate'},f.candidate],locate:f.locate}).attempts).toHaveLength(1);
  f.save('candidate','iterations/1/candidate.json',{jobId:'wrong',pipelineVersionId:'candidate-version',cycle:{index:1},fields:{quality:f.quality}});
  expect(repairHistory({...f.target,id:'candidate'},f.after,f.refs,{jobs:[active],locate:f.locate}).excluded[0].reason).toContain('快照');
 }finally{f.cleanup();}
});

function addRepair(f:ReturnType<typeof fixture>,id:string,parentId:string,source:any,after:any,endedAt:number,sourceIteration:number|null=null){
 cpSync(f.locate('candidate'),f.locate(id),{recursive:true});
 f.save(id,'generated-scene.json',after);
 f.save(id,'generation/refinement/source.json',{sourceJobId:parentId,sourceIteration,sourceDigest:digest(JSON.stringify(source)),referenceSha256:f.refs,qualityBefore:f.quality});
 f.save(id,'generation/refinement/receipt.json',{sourceDigest:digest(JSON.stringify(source)),sceneDigest:digest(JSON.stringify(after))});
 return {...structuredClone(f.candidate),id,endedAt};
}

test('评估证据契约变化后保留已核验经验，历史分差不能当作当前收益',()=>{
 const f=fixture();try{
  f.target.profile.assessmentProtocolSha256='new-contract';
  expect(comparableAssessment(f.candidate,f.target)).toBe(false);
  const h=repairHistory(f.target,f.source,f.refs,{jobs:[f.candidate],locate:f.locate});
  expect(h.totalVerified).toBe(1);
  expect(h.attempts[0]).toMatchObject({scoreBefore:61,scoreAfter:60,scoreGain:-1,scoreComparison:{comparableWithinAttempt:true,comparableToCurrentAssessment:false,assessmentProtocolSha256:null}});
  expect(h.attempts[0].scoreComparison.scope).toContain('不得与当前分数比较');
  expect(h.attempts[0].assessment.summary).toBe('实际比例仍有误差');
  f.candidate.profile.assessmentProtocolSha256='new-contract';
  expect(repairHistory(f.target,f.source,f.refs,{jobs:[f.candidate],locate:f.locate}).attempts[0].scoreComparison.comparableToCurrentAssessment).toBe(true);
  f.candidate.profile.judgeModel='other';
  expect(repairHistory(f.target,f.source,f.refs,{jobs:[f.candidate],locate:f.locate}).totalVerified).toBe(0);
 }finally{f.cleanup();}
});

test('历史任务后来换契约重评时，不把原修正前分数与重评分数相减',()=>{
 const f=fixture();try{
  const candidate={...f.candidate,assessmentProfile:{...f.candidate.profile,assessmentProtocolSha256:'new-contract'}};
  f.target.profile.assessmentProtocolSha256='new-contract';
  const attempt=repairHistory(f.target,f.source,f.refs,{jobs:[candidate],locate:f.locate}).attempts[0];
  expect(attempt.scoreGain).toBeNull();expect(attempt.scoreComparison).toMatchObject({comparableWithinAttempt:false,comparableToCurrentAssessment:true});
  expect(attempt.conclusion).toContain('不计算分差');
  const meta=JSON.parse(readFileSync(join(f.locate('candidate'),'generation/refinement/source.json'),'utf8'));
  f.save('candidate','generation/refinement/source.json',{...meta,baselineProfile:candidate.assessmentProfile});
  expect(repairHistory(f.target,f.source,f.refs,{jobs:[candidate],locate:f.locate}).attempts[0].scoreGain).toBe(-1);
 }finally{f.cleanup();}
});

test('两轮后仍看到已核验祖先和祖先的其他尝试，不沿旁支继续扩散',()=>{
 const f=fixture();try{
  const current={scene:'第三轮'},alternative={scene:'另一个失败尝试'},unrelated={scene:'旁支的后续'};
  const child=addRepair(f,'child','candidate',f.after,current,3000);
  const sibling=addRepair(f,'sibling','parent',f.source,alternative,2000);
  const distant=addRepair(f,'distant','sibling',alternative,unrelated,4000);
  const jobs=[distant,sibling,child,f.candidate];
  const h=repairHistory(f.target,current,f.refs,{jobs,locate:f.locate});
  expect(h.ancestorSceneCount).toBe(3);expect(h.totalVerified).toBe(3);expect(h.omittedVerified).toBe(0);
  expect(h.attempts.map(a=>[a.jobId,a.relation,a.sourceDepth])).toEqual([
   ['child','current-scene-result',1],['sibling','ancestor-alternative',2],['candidate','ancestor-result',2],
  ]);
  expect(repairHistory(f.target,current,f.refs,{jobs:[...jobs].reverse(),locate:f.locate}).attempts).toEqual(h.attempts);
 }finally{f.cleanup();}
});

test('被篡改的画面或不同配置的中间轮不能连接祖先',()=>{
 for(const defect of ['frame','profile']){
  const f=fixture();try{
   const current={scene:'第三轮'},child=addRepair(f,'child','candidate',f.after,current,3000);
   if(defect==='frame')writeFileSync(join(f.locate('child'),'runtime/reference-1.png'),'changed');
   else child.profile.judgeModel='other';
   const h=repairHistory(f.target,current,f.refs,{jobs:[f.candidate,child],locate:f.locate});
   expect(h.attempts).toHaveLength(0);expect(h.ancestorSceneCount).toBe(1);
   expect(h.excluded.length).toBe(defect==='frame'?1:0);
  }finally{f.cleanup();}
 }
});

test('跨已保存轮次追溯来源，并保持历史上下文最多四轮',()=>{
 const f=fixture();try{
  const dir=f.locate('candidate'),snap=join(dir,'iterations/1');mkdirSync(snap,{recursive:true});
  for(const name of ['generated-scene.json','quality.json','review.json','runtime'])cpSync(join(dir,name),join(snap,name),{recursive:true});
  cpSync(join(dir,'generation/refinement'),join(dir,'generation/iteration-1/refinement'),{recursive:true});
  f.save('candidate','iterations/1/candidate.json',{jobId:'candidate',pipelineVersionId:'candidate-version',cycle:{index:1,status:'failed',endedAt:1000},fields:{quality:f.quality}});
  const current={scene:'第三轮'},child=addRepair(f,'child','candidate',f.after,current,6000,1);
  // addRepair复制了快照，仅父记录保留轮次结构，子记录按根终态保存。
  rmSync(join(f.locate('child'),'iterations'),{recursive:true});
  const siblings=Array.from({length:4},(_,i)=>{const s=addRepair(f,'sibling'+i,'parent',f.source,{scene:'alternative'+i},2000+i);rmSync(join(f.locate(s.id),'iterations'),{recursive:true});return s;});
  const h=repairHistory(f.target,current,f.refs,{jobs:[...siblings,child,f.candidate],locate:f.locate});
  expect(h.ancestorSceneCount).toBe(3);expect(h.totalVerified).toBe(6);expect(h.attempts).toHaveLength(4);expect(h.omittedVerified).toBe(2);
  expect(h.attempts[0].jobId).toBe('child');
 }finally{f.cleanup();}
});
