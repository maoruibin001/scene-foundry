import {digest} from './store';
import type {ImprovementLedger} from './improvement-governance';

/** A diagnosed strategy changes the attempted mechanism, never the budget, verdict or history. */
export function resumeDiagnosedRefinement(ledger:ImprovementLedger,source:any,reason:unknown,version:any){
 if(source.generationMode!=='qualified'||!['failed','needs_review'].includes(source.status)||!source.sceneProgram||!source.review||!source.quality||!source.improvementId)throw Error('需要持续完成模式下已评分的完整场景');
 if(source.partialOutput)throw Error('缺失资产先走执行恢复，不能用新质量策略替代');
 if(typeof reason!=='string'||reason.trim().length<40||reason.length>6000)throw Error('请写明失败证据、已经验证的新机制及下一轮检查内容（40至6000字）');
 const current=ledger.get(source.improvementId);
 if(current.limits.repairs!==null||current.limits.calls!==null)throw Error('新策略入口不增加或绕过累计修复与调用限额');
 const text=reason.trim(),id=digest(JSON.stringify([source.id,version.id,text]));
 if(current.strategyRevisions?.some((r:any)=>r.id===id))return current;
 if(!current.stopped?.startsWith('同一评审契约连续两轮'))throw Error('只有无改善诊断可以提交新策略；外部阻塞与其他停止原因须先解除');
 return ledger.reviseStrategy(source.improvementId,{id,reason:text,pipelineVersion:version,additionalRepairs:0});
}
