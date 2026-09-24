import {mkdirSync,existsSync} from 'node:fs';
import {join,resolve,relative} from 'node:path';
import {DATA,read,save,digest,listJobs} from './store';
export const IMPROVEMENT_LIMITS={repairs:2,calls:100,noGain:2,minGain:2};
export class ImprovementLedger {
 constructor(readonly root:string){mkdirSync(root,{recursive:true});}
 key(input:any){return digest(JSON.stringify([String(input.prompt??'').trim().replace(/\s+/g,' '),(input.images??[]).map((i:any)=>i.id)]));}
 path(id:string){if(!/^[a-f0-9]{64}$/.test(id))throw Error('实验标识无效');return join(this.root,id+'.json');}
 get(id:string){return read(this.path(id));}
 enter(input:any,jobId:string,historical:any[]=[],source?:any){const id=source?.improvementId??this.key(input),p=this.path(id),v=existsSync(p)?read(p):{id,createdAt:Date.now(),strategy:'image-first-graybox-v1',limits:IMPROVEMENT_LIMITS,repairs:0,calls:0,noGain:0,jobs:[],results:[],history:historical.map(j=>({id:j.id,score:j.quality?.score??null,status:j.status,pipelineVersion:j.pipelineVersion?.label})),scope:'历史运行保留审计；新机制从首次启用起统一累计，换模型、版本或新任务不重置'};
  this.allowed(v);if(v.jobs.length&&!source)this.repair(v,'重新生成','相同输入新建任务计入同一实验，不重新获得首轮预算');v.jobs.push(jobId);save(p,v);return id;
 }
 allowed(v:any){if(v.stopped)throw Error('IMPROVEMENT_STOPPED：'+v.stopped);if(v.calls>=v.limits.calls)this.stop(v,'累计模型调用已达上限，需诊断机制与基础条件');}
 stop(v:any,reason:string):never {v.stopped=reason;v.diagnosis={at:Date.now(),reason,questions:['参考基准是否一致、可观察？','空间规划与实际相机是否一致？','几何表达或运行能力是否成为瓶颈？','评分是否有对应画面证据？'],next:'保存最小失败证据，提出可验证的新机制和回归样例，再由用户决定新实验；不自动换模型、放宽阈值或继续重跑'};save(this.path(v.id),v);throw Error('IMPROVEMENT_STOPPED：'+reason);}
 repair(v:any,phase:string,hypothesis:string){this.allowed(v);if(!hypothesis?.trim())throw Error('修正必须有明确差距与可验证假设');if(v.repairs>=v.limits.repairs)this.stop(v,'灰模与成品已共用两次修正额度');v.repairs++;(v.actions??=[]).push({phase,hypothesis,at:Date.now()});save(this.path(v.id),v);}
 reserveRepair(id:string,phase:string,hypothesis:string){this.repair(this.get(id),phase,hypothesis);}
 call(id:string,role:string){const v=this.get(id);this.allowed(v);v.calls++;(v.requests??=[]).push({role,at:Date.now()});save(this.path(id),v);}
 result(id:string,r:any){const v=this.get(id),last=v.results.filter((x:any)=>x.kind===r.kind&&x.comparison===r.comparison).at(-1);if(last&&r.score-last.score<v.limits.minGain)v.noGain++;else if(last)v.noGain=0;v.results.push({...r,at:Date.now()});if(v.noGain>=v.limits.noGain){v.stopped='连续两轮没有有效提升，停止当前策略';v.diagnosis={at:Date.now(),reason:v.stopped,next:'先复核空间、表达能力和评分证据，再提交新机制实验'};}save(this.path(id),v);return v;}
 remaining(id:string){const v=this.get(id);return v.stopped?0:Math.max(0,v.limits.repairs-v.repairs);}
}
export const improvement=new ImprovementLedger(join(DATA,'improvement'));
export function reserveModelCall(dir:string,role:string){const rel=relative(join(DATA,'runs'),resolve(dir)),id=rel.split('/')[0];if(!rel.startsWith('..')&&/^[a-f0-9-]{36}$/.test(id)){const p=join(DATA,'runs',id,'job.json');if(existsSync(p)){const j=read(p);if(j.improvementId)improvement.call(j.improvementId,role);}}}
