import {COMPLEXITY_MODEL_DEFAULTS} from './model-selection';
import {existsSync,mkdirSync,readdirSync,readFileSync,writeFileSync,renameSync,rmSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {ROOT,DATA,read,digest} from './store';
import {DEFAULT_POLICY,batchGate,automaticGeneration} from './quality';
import {MODEL,JUDGE_MODEL,PROVIDER,budget} from './provider';

const TERMINAL=['passed','failed','blocked','cancelled','needs_review'];
const canonical=(v:any):any=>v===undefined?null:v===null||typeof v!=='object'?v:Array.isArray(v)?v.map(canonical):Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));
const stableJson=(v:any):string=>JSON.stringify(canonical(v));
export type VersionInput={configuration:any,files:Record<string,string>};
export function versionId(input:VersionInput){return digest(stableJson({configuration:input.configuration,files:Object.fromEntries(Object.entries(input.files).map(([p,s])=>[p,digest(s)]))}));}
const validId=(id:string)=>{if(!/^(?:[a-f0-9]{64}|legacy-[a-f0-9]{64})$/.test(id))throw Error('非法版本 ID');return id;};
export function versionOf(job:any){return job.pipelineVersion?.id??job.profile.pipelineVersionId??'legacy-'+job.profile.id;}
export function assessmentVersionOf(job:any){return job.assessmentVersion?.id??job.assessmentProfile?.pipelineVersionId??(job.assessmentProfile?'legacy-'+job.assessmentProfile.id:versionOf(job));}
export function inputKey(j:any){return digest(stableJson([j.prompt??'',j.images?.map((i:any)=>i.id)??j.image?.id??j.image?.file??null,j.mode,j.complexity??null,j.validationKind??'generation']));}
export function modelKey(j:any){const p=j.profile;return [p.provider,p.model,p.judgeModel,p.reasoningEffort??'default',p.executionRoute?.configurationSha256??'legacy-openai'].join(' / ');}
export function versionStats(jobs:any[]){
 const continuations=jobs.filter(j=>!automaticGeneration(j)&&j.validationKind!=='native-assisted'),assisted=jobs.filter(j=>j.validationKind==='native-assisted'),ended=jobs.filter(j=>TERMINAL.includes(j.status)&&automaticGeneration(j)),mixed=ended.filter(j=>assessmentVersionOf(j)!==versionOf(j)),eligible=ended.filter(j=>assessmentVersionOf(j)===versionOf(j)),scored=eligible.filter(j=>Number.isFinite(j.quality?.score));
 return {total:jobs.length,assisted:assisted.length,continuations:continuations.length,finished:ended.length,pending:jobs.filter(j=>!TERMINAL.includes(j.status)).length,passed:eligible.filter(j=>j.status==='passed').length,rate:ended.length?eligible.filter(j=>j.status==='passed').length/ended.length:null,scored:scored.length,averageScore:scored.length?Math.round(scored.reduce((n,j)=>n+j.quality.score,0)/scored.length*10)/10:null,mixedAssessments:mixed.length,firstDraftPassed:eligible.filter(j=>(j.firstDraft?.status??j.status)==='passed').length,averageSeconds:ended.length?Math.round(ended.reduce((n,j)=>n+(Number.isFinite(j.startedAt)&&Number.isFinite(j.endedAt)?Math.max(0,j.endedAt-j.startedAt):Object.entries(j.stages??{}).reduce((m:number,[key,s]:any)=>m+(s.durationMs??0)+(j.stageAttempts?.[key]??[]).reduce((a:number,t:any)=>a+(t.durationMs??0),0),0)),0)/ended.length/1000):null};
}
export function pairedResults(left:any[],right:any[]){
 // A first terminal attempt is selected deterministically; retries cannot cherry-pick a better score.
 const first=(jobs:any[])=>{const m=new Map<string,any>();for(const j of [...jobs].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)))if(automaticGeneration(j)&&TERMINAL.includes(j.status)&&!m.has(inputKey(j)))m.set(inputKey(j),j);return m;};
 const l=first(left),r=first(right);
 return [...l].filter(([k])=>r.has(k)).map(([key,a])=>{const b=r.get(key),sameSettings=modelKey(a)===modelKey(b)&&stableJson(a.policy??a.profile.policy)===stableJson(b.policy??b.profile.policy)&&a.profile.specSha256===b.profile.specSha256&&(a.profile.assessmentProtocolSha256??null)===(b.profile.assessmentProtocolSha256??null),comparable=sameSettings&&assessmentVersionOf(a)===versionOf(a)&&assessmentVersionOf(b)===versionOf(b);return {key,left:a.id,right:b.id,sameSettings,comparable,scoreDelta:comparable&&Number.isFinite(a.quality?.score)&&Number.isFinite(b.quality?.score)?Math.round((b.quality.score-a.quality.score)*10)/10:null};});
}
export function releaseReadiness(version:any,batches:any[],jobs:any[],profileId?:string){
 const candidates=batches.filter(b=>!b.stageValidation&&b.purpose!=='stage-80'&&(b.pipelineVersion?.id??b.profile.pipelineVersionId)===version.id&&(!profileId||b.profile.id===profileId)&&stableJson(b.policy)===stableJson(DEFAULT_POLICY));
 const configurations=[...new Set(candidates.map(b=>b.profile.id))];
 const options=configurations.map(id=>{const found=['simple','medium','complex'].map(level=>candidates.filter(b=>b.profile.id===id&&b.complexity===level).map(b=>({batch:b,result:batchGate(b,jobs,DEFAULT_POLICY)})).find(x=>x.result.status==='usable'));return {profileId:id,ready:found.every(Boolean),batchIds:found.filter(Boolean).map(x=>x!.batch.id),missing:['simple','medium','complex'].filter((_,i)=>!found[i])};});
 const best=options.find(x=>x.ready)??options.sort((a,b)=>b.batchIds.length-a.batchIds.length)[0];
 const reasons=[...(version.kind==='legacy'?['历史记录没有可核验的源码快照']:[]),...(!best?.ready?['同一模型配置下，简单、中等、复杂三档均需完成独立标定和固定评测']:[])];
 return {ready:reasons.length===0,profileId:best?.profileId??null,batchIds:best?.batchIds??[],missing:best?.missing??['simple','medium','complex'],reasons,policy:DEFAULT_POLICY};
}

export class VersionStore{
 constructor(readonly root:string){mkdirSync(root,{recursive:true});}
 path(id:string){return join(this.root,validId(id));}
 list(){return readdirSync(this.root).filter(id=>/^(?:[a-f0-9]{64}|legacy-[a-f0-9]{64})$/.test(id)&&existsSync(join(this.root,id,'manifest.json'))).map(id=>this.get(id)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));}
 get(id:string){const p=this.path(id),v=read(join(p,'manifest.json')),released=existsSync(join(p,'release.json'))?read(join(p,'release.json')):null;return {...v,release:released,label:released?.label??v.candidateLabel,status:released?'stable':v.kind==='legacy'?'legacy':'candidate'};}
 freeze(input:VersionInput){
  const id=versionId(input),path=this.path(id);if(existsSync(join(path,'manifest.json'))){this.verify(id);return this.get(id);}
  const all=this.list().filter(v=>v.kind!=='legacy'),stable=all.filter(v=>v.release).sort((a,b)=>b.release.publishedAt.localeCompare(a.release.publishedAt))[0],target=stable?'v1.'+(Number(stable.release.label.split('.')[1]??0)+1):'v1',number=all.filter(v=>v.target===target).length+1;
  const hashes=Object.fromEntries(Object.entries(input.files).map(([p,s])=>[p,digest(s)])),manifest={id,kind:'snapshot',target,candidateLabel:target+'-rc.'+number,createdAt:new Date().toISOString(),parentId:all[0]?.id??null,baseStableId:stable?.id??null,configuration:input.configuration,files:hashes};
  const temp=path+'.pending';mkdirSync(temp,{recursive:true});try{for(const [p,s] of Object.entries(input.files)){if(p.includes('..')||p.startsWith('/'))throw Error('非法快照文件');const f=join(temp,'snapshot',p);mkdirSync(dirname(f),{recursive:true});writeFileSync(f,s);}writeFileSync(join(temp,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});renameSync(temp,path);}catch(e){rmSync(temp,{recursive:true,force:true});throw e;}return this.get(id);
 }
 importLegacy(jobs:any[]){for(const j of [...jobs].sort((a,b)=>a.createdAt.localeCompare(b.createdAt))){if(j.pipelineVersion||j.profile.pipelineVersionId)continue;const id=versionOf(j),path=this.path(id);if(existsSync(join(path,'manifest.json')))continue;mkdirSync(path,{recursive:true});writeFileSync(join(path,'manifest.json'),JSON.stringify({id,kind:'legacy',candidateLabel:'历史 · '+j.profile.id.slice(0,8),createdAt:j.createdAt,parentId:null,baseStableId:null,configuration:{profile:j.profile},files:{},limitations:'仅有任务与配置记录；未在生成当时冻结源码，不能追认为 v1。'},null,2)+'\n',{flag:'wx'});}}
 verify(id:string){const v=this.get(id);if(v.kind==='legacy')throw Error('历史版本没有源码快照');const files:Record<string,string>={};for(const [p,h] of Object.entries(v.files)){const s=readFileSync(join(this.path(id),'snapshot',p),'utf8');if(digest(s)!==h)throw Error('版本快照完整性失败：'+p);files[p]=s;}if(versionId({configuration:v.configuration,files})!==id)throw Error('版本清单摘要不一致');return {verified:true,files:Object.keys(files).length};}
 publish(id:string,batches:any[],jobs:any[],profileId?:string){
  const v=this.get(id);if(v.release)throw Error('稳定版本已经冻结，不可覆盖');this.verify(id);const gate=releaseReadiness(v,batches,jobs,profileId);if(!gate.ready)throw Error('不能发布稳定版：'+gate.reasons.join('；'));
  if(this.list().some(x=>x.release?.label===v.target))throw Error('该稳定版本号已存在，请创建下一版本');
  const evidence={batches:batches.filter(b=>gate.batchIds.includes(b.id)),jobs:jobs.filter(j=>gate.batchIds.includes(j.batchId))};
  const release={label:v.target,publishedAt:new Date().toISOString(),profileId:gate.profileId,gate,evidence,evidenceDigest:digest(stableJson(evidence))};
  writeFileSync(join(this.path(id),'release.json'),JSON.stringify(release,null,2)+'\n',{flag:'wx'});return this.get(id);
 }
 diff(leftId:string,rightId:string){const a=this.get(leftId),b=this.get(rightId),paths=[...new Set([...Object.keys(a.files),...Object.keys(b.files)])];return {left:leftId,right:rightId,sourceAvailable:a.kind!=='legacy'&&b.kind!=='legacy',files:paths.filter(p=>a.files[p]!==b.files[p]).map(path=>({path,change:!a.files[path]?'added':!b.files[path]?'removed':'changed'})),configurationChanged:stableJson(a.configuration)!==stableJson(b.configuration),leftConfiguration:a.configuration,rightConfiguration:b.configuration};}
}

export const versions=new VersionStore(join(DATA,'versions'));
export function currentVersionInput():VersionInput{
 const files:Record<string,string>={},base=resolve(ROOT,'..');
 const add=(p:string)=>{if(!existsSync(join(base,p)))throw Error('版本输入缺失：'+p);files[p]=readFileSync(join(base,p),'utf8');};
 const tree=(p:string)=>{for(const e of readdirSync(join(base,p),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){if(e.name==='__pycache__'||e.name==='.DS_Store')continue;if(e.isDirectory())tree(p+'/'+e.name);else if(e.isFile())add(p+'/'+e.name);}};
 for(const p of ['workbench/src','workbench/public','workbench/spec','prototype/bin'])tree(p);
 for(const p of ['workbench/package.json','prototype/package.json','prototype/brief.json','prototype/game/forge.json','prototype/game/assets/world.pack.ts','prototype/game/assets/camera.plugin.ts','prototype/game/assets/ui.plugin.ts'])add(p);
 const pin=read(join(base,'prototype/brief.json'));
 return {configuration:{engine:"ForgeaX Engine",promptLanguage:"zh-CN",complexityModelDefaults:COMPLEXITY_MODEL_DEFAULTS,engineSha:pin.engineSha,generatorSha:pin.generatorSha,provider:PROVIDER,defaultModel:MODEL,defaultJudgeModel:JUDGE_MODEL,defaultReasoningEffort:budget().reasoningEffort??null,executionRoute:budget().executionRoute,policy:DEFAULT_POLICY},files};
}
export function currentVersionId(){return versionId(currentVersionInput());}
export function ensureCurrentVersion(){return versions.freeze(currentVersionInput());}
export function versionRef(v:any){return {id:v.id,label:v.candidateLabel,sourceArchived:v.kind!=='legacy'};}
export function assertCurrentVersion(id:string){if(currentVersionId()!==id)throw Error('管线代码或默认配置已改变，请重启工作台以冻结新版本后再生成');versions.verify(id);}
