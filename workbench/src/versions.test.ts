import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {VersionStore,versionId,versionOf,versionStats,pairedResults,releaseReadiness} from './versions';
import {DEFAULT_POLICY} from './quality';
const input={configuration:{model:'luna',policy:DEFAULT_POLICY},files:{'workbench/source.ts':'source-a'}};
function temp(fn:(s:VersionStore)=>void){const root=mkdtempSync(join(tmpdir(),'pipeline-versions-test-'));try{fn(new VersionStore(root));}finally{rmSync(root,{recursive:true,force:true});}}
const job=(id:string,version:string,status='passed',score:any=90)=>({id,prompt:'same input',image:null,mode:'prompt',complexity:'simple',createdAt:'2026-09-22T10:00:00Z',status,pipelineVersion:{id:version},profile:{id:'a'.repeat(64),model:'luna',judgeModel:'luna',provider:'codex-cli',reasoningEffort:'low',specSha256:'spec'},policy:DEFAULT_POLICY,quality:score===null?undefined:{score},stages:{generate:{durationMs:1000}}});
test('snapshots survive a new store and changes create an immutable next candidate',()=>temp(s=>{
 const a=s.freeze(input),b=s.freeze({...input,files:{'workbench/source.ts':'source-b'}});
 expect(a.label).toBe('v1-rc.1');expect(b.label).toBe('v1-rc.2');expect(b.parentId).toBe(a.id);
 expect(new VersionStore(s.root).freeze(input).id).toBe(a.id);expect(s.list()).toHaveLength(2);expect(s.verify(a.id)).toEqual({verified:true,files:1});
 expect(s.diff(a.id,b.id).files).toEqual([{path:'workbench/source.ts',change:'changed'}]);
 writeFileSync(join(s.path(a.id),'snapshot/workbench/source.ts'),'tampered');expect(()=>s.verify(a.id)).toThrow('完整性');expect(()=>s.freeze(input)).toThrow('完整性');
}));
test('version hashing includes settings and content but ignores object key insertion order',()=>{
 expect(versionId(input)).toBe(versionId({files:input.files,configuration:{policy:DEFAULT_POLICY,model:'luna'}}));
 expect(versionId(input)).not.toBe(versionId({...input,configuration:{...input.configuration,model:'terra'}}));
});
test('新旧评分权重的结果不可当成同一标准的分数提升',()=>{
 const legacy={...DEFAULT_POLICY,version:'scene-quality-v3'};delete legacy.dimensionWeights;
 const before={...job('old','before','passed',83),policy:legacy},after=job('new','after','failed',78.4);
 expect(pairedResults([before],[after])[0]).toMatchObject({sameSettings:false,comparable:false,scoreDelta:null});
 expect(versionId(input)).not.toBe(versionId({...input,configuration:{...input.configuration,policy:legacy}}));
 expect(versionStats([before])).toMatchObject({averageScore:83});
});
test('historical jobs get honest persistent labels without fabricating source',()=>temp(s=>{
 const j=job('a','a');delete (j as any).pipelineVersion;s.importLegacy([j]);s.importLegacy([j]);const v=s.get(versionOf(j));
 expect(s.list()).toHaveLength(1);expect(v.kind).toBe('legacy');expect(v.label).toStartWith('历史');expect(()=>s.verify(v.id)).toThrow();expect(releaseReadiness(v,[],[]).ready).toBe(false);
}));
test('comparison includes failures and unscored outcomes and isolates later assessments',()=>{
 const a=job('a','v','passed',90),b=job('b','v','failed',50),c=job('c','v','blocked',null),d=job('d','v','running',null),e={...job('e','v'),assessmentVersion:{id:'different'}};
 expect(versionStats([a,b,c,d,e])).toMatchObject({total:5,finished:4,pending:1,passed:1,rate:0.25,scored:2,averageScore:70,mixedAssessments:1});
 const retry={...job('retry','b','passed',100),createdAt:'2026-09-22T12:00:00Z'};
 expect(pairedResults([a],[job('first','b','failed',60),retry])[0]).toMatchObject({right:'first',scoreDelta:-30,comparable:true});
 expect(pairedResults([a],[{...job('x','b'),profile:{...a.profile,reasoningEffort:'high'}}])[0].scoreDelta).toBeNull();
 expect(pairedResults([a],[{...job('x','b'),complexity:'complex'}])).toHaveLength(0);
});
function certified(versionId:string){
 const profile={...job('','').profile,pipelineVersionId:versionId},calibration={profileId:profile.id,cases:Array.from({length:12},(_,i)=>({id:String(i),evidenceDigest:'unique'+i,reviewDigest:'review'+i,expected:i<6?'passed':'failed',predicted:i<6?'passed':'failed',reviewedBy:'human-reviewer',reviewerKind:'human',reviewedAt:'2026-09-22',reason:'evidence inspected'}))};
 const batches=['simple','medium','complex'].map(complexity=>({id:complexity,complexity,profile,pipelineVersion:{id:versionId},policy:DEFAULT_POLICY,calibration,cases:Array.from({length:90},(_,i)=>({id:String(i),mode:['prompt','image','image_prompt'][Math.floor(i/30)]}))}));
 const jobs=batches.flatMap(b=>b.cases.map(c=>({...job(b.id+c.id,versionId),profile,complexity:b.complexity,batchId:b.id,caseId:c.id,attempt:1})));
 return {batches,jobs};
}
test('stable v1 requires all levels, exact policy and calibration; publication cannot overwrite',()=>temp(s=>{
 const v=s.freeze(input),{batches,jobs}=certified(v.id);
 expect(releaseReadiness(v,batches.slice(0,2),jobs).ready).toBe(false);
 expect(releaseReadiness(v,batches.map(b=>({...b,policy:{...b.policy,score:1}})),jobs).ready).toBe(false);
 expect(releaseReadiness(v,batches.map(b=>({...b,calibration:null})),jobs).ready).toBe(false);
 expect(()=>s.publish(v.id,[],[])).toThrow('不能发布');
 const published=s.publish(v.id,batches,jobs);expect(published.label).toBe('v1');expect(published.status).toBe('stable');expect(published.release.evidence.jobs).toHaveLength(270);
 expect(()=>s.publish(v.id,batches,jobs)).toThrow('不可覆盖');
 const next=s.freeze({...input,files:{'workbench/source.ts':'new'}});expect(next.label).toBe('v1.1-rc.1');expect(next.baseStableId).toBe(v.id);
 expect(JSON.parse(readFileSync(join(s.path(v.id),'manifest.json'),'utf8')).candidateLabel).toBe('v1-rc.1');
}));
test('检查点续跑及复用重建不抬高独立生成的评分、通过率或配对成绩',()=>{
 const fresh=job('fresh','v','failed',50),resumed={...job('resumed','v','passed',99),validationKind:'checkpoint-continuation',reuseCheckpoint:'checkpoint'},rebuilt={...job('rebuilt','v','passed',100),reuseSceneFrom:'old'};
 expect(versionStats([fresh,resumed,rebuilt])).toMatchObject({total:3,finished:1,continuations:2,passed:0,rate:0,averageScore:50});
 expect(pairedResults([resumed],[{...resumed,id:'other',pipelineVersion:{id:'next'}}])).toHaveLength(0);
 const v={id:'v',kind:'snapshot'},c=certified('v');expect(releaseReadiness(v,c.batches,c.jobs.map(j=>({...j,validationKind:'checkpoint-continuation'}))).ready).toBe(false);
});
test('版本统计使用全部迭代历时，并单列首稿通过数',()=>{
 const a={...job('a','v','passed',82),startedAt:1000,endedAt:16000,firstDraft:{status:'failed',score:55},stageAttempts:{generate:[{durationMs:5000}]}};
 expect(versionStats([a])).toMatchObject({passed:1,firstDraftPassed:0,averageSeconds:15});
 const b={...job('b','v','failed',75),firstDraft:{status:'failed',score:60},stageAttempts:{generate:[{durationMs:5000}]}};
 expect(versionStats([b]).averageSeconds).toBe(6);
});

test('十例阶段试验不能替代正式认证，即使附带了正式样本统计',()=>{const v={id:'v',kind:'snapshot'},c=certified('v');expect(releaseReadiness(v,c.batches.map(b=>({...b,purpose:'stage-80',stageValidation:{certifiesStableVersion:false}})),c.jobs).ready).toBe(false);});

test('评审输入契约变化不当作同口径分数提升；相同契约可比较生成版本',()=>{
 const before=job('old-protocol','before','failed',60),after=job('new-protocol','after','failed',65);
 (after.profile as any).assessmentProtocolSha256='new';expect(pairedResults([before],[after])[0]).toMatchObject({sameSettings:false,comparable:false,scoreDelta:null});
 (before.profile as any).assessmentProtocolSha256='new';expect(pairedResults([before],[after])[0]).toMatchObject({sameSettings:true,comparable:true,scoreDelta:5});
 (before.profile as any).assessmentProtocolSha256='old';expect(pairedResults([before],[after])[0].scoreDelta).toBe(null);
});
