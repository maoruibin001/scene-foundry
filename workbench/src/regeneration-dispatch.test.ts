import {test,expect} from 'bun:test';
import {activeRegeneration,isRegeneration} from './regeneration-dispatch';
const source={id:'source',retryRoot:'root',improvementId:'experiment',createdAt:'2026-10-05T14:00:00Z',status:'cancelled',prompt:'原始输入',images:[{id:'1'.repeat(64)}],complexity:'complex',matchingLevel:'standard',generationMode:'qualified',reuseMode:'fresh'};
const child={...source,id:'child',status:'queued',createdAt:'2026-10-05T15:00:00Z'};
test('同源重复提交返回活跃任务，终态不被误复用，不同原始输入不合并',()=>{
 expect(activeRegeneration(source,[source,child])).toBe(child);
 expect(activeRegeneration(source,[child],{...source,prompt:'changed request'})).toBeNull();
 expect(activeRegeneration(source,[{...child,status:'running'}])?.id).toBe('child');
 for(const status of ['passed','failed','cancelled','blocked','needs_review'])expect(activeRegeneration(source,[{...child,status}])).toBeNull();
 expect(activeRegeneration(source,[{...child,prompt:'另一输入'}])).toBeNull();
 expect(activeRegeneration(source,[{...child,images:[{id:'2'.repeat(64)}]}])).toBeNull();
 expect(activeRegeneration(source,[{...child,improvementId:'other',retryRoot:'other'}])).toBeNull();
 expect(activeRegeneration(source,[{...child,retryRoot:'quality-branch',refineScene:true}])?.id).toBe('child');
});
test('只在重新生成入口合并；技术恢复、复评和复用各自保留原有契约',()=>{
 expect(isRegeneration({retryRoot:'root',reuseFrom:null})).toBe(true);
 expect(isRegeneration({})).toBe(false);
 for(const key of ['recoverySourceJobId','automaticRecoveryFrom','reuseCheckpoint','reuseSceneFrom','reuseAssessmentFrom','reusePlanFrom','reuseRefinementOutput','reuseFrom','refineScene'])expect(isRegeneration({retryRoot:'root',[key]:'source'})).toBe(false);
 expect(isRegeneration({retryRoot:'root',validationKind:'manual-continuation'})).toBe(false);
});
test('在异步配置解析后、同步创建前复查，可挡住并发与进程重启后的重复派发',async()=>{
 const jobs:any[]=[source];let creates=0;
 const submit=async()=>{const initial=activeRegeneration(source,jobs);if(initial)return initial;await Promise.resolve();const existing=activeRegeneration(source,jobs);if(existing)return existing;creates++;jobs.push(child);return child;};
 expect(await Promise.all([submit(),submit(),submit()])).toEqual([child,child,child]);expect(creates).toBe(1);
 expect(activeRegeneration(source,structuredClone(jobs))?.id).toBe('child');
});
