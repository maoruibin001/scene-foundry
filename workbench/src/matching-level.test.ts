import {test,expect} from 'bun:test';
import {matchingLevel,matchingPolicy,productionWindow,remainingProductionMs,firstPassCallEstimate} from './matching-level';
import {generationInput} from './reference-input';
import {roleSettings,OPTIMIZATION_POLICY} from './generation-policy';
import {scoreReserve,canSpendForScene} from './score-reserve';
import {isProviderFailure} from './contracts';
import {failureDisposition} from './output-delivery';
const base={model:'gpt-6-astra-aihub-azure',reasoningEffort:'xhigh'} as const;
test('标准默认；历史输入与精细档保留；非法档位拒绝',()=>{
 expect(matchingLevel()).toBe('standard');expect(generationInput({prompt:'旧'}).matchingLevel).toBe('detailed');expect(generationInput({matchingLevel:'standard'}).matchingLevel).toBe('standard');expect(()=>matchingLevel('80')).toThrow();
});
test('新标准档保留一小时目标和两小时参考线，必要制作与评分不被时间目标截断',()=>{
 const a:any={matchingPolicy:matchingPolicy('standard'),createdAt:new Date(1000).toISOString()};a.productionWindow=productionWindow(a);
 const b={...a,createdAt:new Date(1801000).toISOString(),productionWindow:null};b.productionWindow=productionWindow(b,a);
 expect(b.productionWindow.startedAt).toBe(1000);expect(b.productionWindow.targetAt).toBe(3601000);expect(b.productionWindow.preferredAt).toBe(7201000);expect(remainingProductionMs(b,'geometry-asset',3601000)).toBe(Infinity);expect(remainingProductionMs(b,'geometry-asset',9001000)).toBe(Infinity);expect(remainingProductionMs(b,'judge',7201001)).toBe(Infinity);expect(remainingProductionMs({matchingPolicy:matchingPolicy('detailed')},'judge')).toBe(Infinity);
});
test('简单规划medium，空间、材质、结构和最终评分high；不超出用户选择',()=>{
 const p={...OPTIMIZATION_POLICY,matchingLevel:'standard'};
 for(const role of ['plan','scene-observation'])expect(roleSettings(base,role,p)?.reasoningEffort).toBe('medium');
 for(const role of ['scene-space','scene-surface'])expect(roleSettings(base,role,p)?.reasoningEffort).toBe('high');
 expect(roleSettings(base,'scene-refine',p)?.reasoningEffort).toBe('high');expect(roleSettings(base,'judge',p)?.reasoningEffort).toBe('high');expect(roleSettings({...base,reasoningEffort:'low'},'scene-space',p)?.reasoningEffort).toBe('low');expect(roleSettings(base,'scene-space',OPTIMIZATION_POLICY)?.reasoningEffort).toBe('high');
});
test('调用计划计入批量灰模和两次评分预留，明确排除重试',()=>{
 expect(firstPassCallEstimate(16)).toMatchObject({grayboxCalls:4,assetCalls:16,plannedCalls:27});expect(firstPassCallEstimate(16,'detailed').plannedCalls).toBe(39);expect(firstPassCallEstimate(14).grayboxCalls).toBe(4);
});
test('两个并行场景各留两次评分；评分可以消费本场景保留额度',()=>{
 const jobs=['a','b'].map(id=>({id,status:'running',matchingPolicy:matchingPolicy('standard')}));
 expect(scoreReserve(jobs)).toBe(4);expect(canSpendForScene(5,1,jobs,'a','geometry-asset')).toBe(true);expect(canSpendForScene(4,1,jobs,'a','geometry-asset')).toBe(false);expect(canSpendForScene(4,1,jobs,'a','judge')).toBe(true);expect(canSpendForScene(5,1,jobs,'a','geometry-asset',1)).toBe(false);
 jobs[1].status='blocked';expect(scoreReserve(jobs)).toBe(2);jobs[0].quality={score:65};expect(scoreReserve(jobs)).toBe(0);
});
test('时间和本地评分预留阻止契约盲重试，但不伪装供应商故障',()=>{
 for(const code of ['FIRST_SCORE_WINDOW_EXPIRED','SCORE_BUDGET_RESERVED','SCENE_BUDGET_INSUFFICIENT'])expect(isProviderFailure(Error(code))).toBe(true);
 expect(failureDisposition('FIRST_SCORE_WINDOW_EXPIRED')).toMatchObject({kind:'time-window',retryable:false});expect(failureDisposition('SCENE_BUDGET_INSUFFICIENT').kind).toBe('budget');
});
test('草稿和完整场景、不同匹配级别的分数不能混成提分结论',async()=>{
 const {comparable}=await import('./score-history');const a={referenceKey:'a',prompt:'图',scoring:'v4',protocol:'p',model:{model:'x'},policy:{score:80},assessmentScope:'scene',matchingLevel:'standard'};
 expect(comparable(a,{...a})).toBe(true);expect(comparable(a,{...a,assessmentScope:'partial'})).toBe(false);expect(comparable(a,{...a,matchingLevel:'detailed'})).toBe(false);
});

test('历史制作窗不被新策略静默延长，技术恢复保持原证据',()=>{
 const old={matchingPolicy:{version:'standard-score-v2'},createdAt:new Date(1000).toISOString(),productionWindow:{version:'score-delivery-window-v2',startedAt:1000,workDeadlineAt:6001000,scoreDeadlineAt:7201000}};
 const next={matchingPolicy:matchingPolicy('standard'),createdAt:new Date(9000000).toISOString(),productionWindow:productionWindow({matchingPolicy:matchingPolicy('standard')},old)};
 expect(next.productionWindow).toEqual(old.productionWindow);expect(remainingProductionMs(next,'geometry-asset',9000000)).toBe(0);expect(remainingProductionMs(next,'judge',9000000)).toBe(Infinity);
});
