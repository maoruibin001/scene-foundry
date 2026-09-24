import {test,expect} from 'bun:test';
import {recommendedModelSettings,modelOptions,validateModelSettings,settingsOf,modelTimeoutMs} from './model-selection';
import {cliReceipt} from './codex-provider';
import {profile} from './runner';
const entries=modelOptions([
 {model:'luna',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'medium'}],defaultReasoningEffort:'medium',inputModalities:['text','image']},
 {model:'astra',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'ultra'}],defaultReasoningEffort:'low',inputModalities:['text','image']},
 {model:'text-only',supportedReasoningEfforts:[{reasoningEffort:'low'}],inputModalities:['text']},
 {model:'hidden',hidden:true,supportedReasoningEfforts:[{reasoningEffort:'low'}]},
]);
test('only advertised multimodal models and their own effort combinations can be selected',()=>{
 expect(entries.map(m=>m.model)).toEqual(['luna','astra']);
 expect(validateModelSettings({model:'astra',reasoningEffort:'ultra'},entries)).toEqual({model:'astra',reasoningEffort:'ultra'});
 for(const value of [null,{model:'luna',reasoningEffort:'ultra'},{model:'text-only',reasoningEffort:'low'},{model:'unknown',reasoningEffort:'low'},{model:'luna',reasoningEffort:'low"\nother=true'}])expect(()=>validateModelSettings(value,entries)).toThrow();
});
test('saved settings and legacy profiles preserve selection for retries without borrowing new defaults',()=>{
 const saved={modelSettings:{model:'luna',reasoningEffort:'medium'},profile:{provider:'codex-cli',model:'astra',reasoningEffort:'high'}};
 const result=settingsOf(saved)!;expect(result).toEqual(saved.modelSettings);result.model='changed';expect(saved.modelSettings.model).toBe('luna');
 expect(settingsOf({profile:saved.profile})).toEqual({model:'astra',reasoningEffort:'high'});
 expect(settingsOf({profile:{provider:'messages-api'}})).toBeUndefined();
});
test('different models or effort levels cannot share evaluation profiles',()=>{
 const low=profile(undefined,{model:'gpt-5.6-luna',reasoningEffort:'low'}),medium=profile(undefined,{model:'gpt-5.6-luna',reasoningEffort:'medium'}),terra=profile(undefined,{model:'gpt-5.6-terra',reasoningEffort:'low'});
 expect(new Set([low.id,medium.id,terra.id]).size).toBe(3);expect(medium.model).toBe('gpt-5.6-luna');expect(medium.judgeModel).toBe(medium.model);expect(medium.reasoningEffort).toBe('medium');
});
test('CLI must confirm both requested model and effort, including nondefault selections',()=>{
 const log='OpenAI Codex v0.154.0\nmodel: gpt-5.6-terra\nprovider: openai\nreasoning effort: medium\nsession id: test';
 const receipt=cliReceipt(log,'gpt-5.6-terra','medium');expect(receipt.cliReasoningEffort).toBe('medium');expect(receipt.requestedReasoning).toBe('medium');expect(receipt.returnedModel).toBeNull();
 expect(()=>cliReceipt(log,'gpt-5.6-luna','medium')).toThrow('MODEL_ROUTE_UNVERIFIED');expect(()=>cliReceipt(log,'gpt-5.6-terra','low')).toThrow('MODEL_ROUTE_UNVERIFIED');expect(()=>cliReceipt(log.replace('reasoning effort: medium',''),'gpt-5.6-terra','medium')).toThrow();
 expect(modelTimeoutMs('medium')).toBeGreaterThan(modelTimeoutMs('low'));expect(modelTimeoutMs('ultra')).toBeLessThanOrEqual(900000);
});

test('complexity recommendations are validated Astra profiles and cannot mutate later jobs',()=>{
 const catalog=modelOptions([{model:'gpt-6-astra',inputModalities:['text','image'],defaultReasoningEffort:'medium',supportedReasoningEfforts:[{reasoningEffort:'high'},{reasoningEffort:'xhigh'}]}]);
 for(const [level,effort] of [['simple','high'],['medium','high'],['complex','xhigh']] as const){
  const setting=validateModelSettings(recommendedModelSettings(level),catalog);expect(setting).toEqual({model:'gpt-6-astra',reasoningEffort:effort});
  setting.reasoningEffort='low';expect(recommendedModelSettings(level).reasoningEffort).toBe(effort);
 }
 expect(()=>validateModelSettings(recommendedModelSettings('complex'),entries)).toThrow();
});

test('高思考档生成步骤有明确绝对上限，只延长生成与视觉验收且不改变已选模型深度',()=>{
 for(const role of ['scene-space','scene-surface','scene-refine','geometry-asset','judge'])for(const effort of ['xhigh','max','ultra'])expect(modelTimeoutMs(effort,role)).toBe(1200000);
 for(const role of ['plan'])expect(modelTimeoutMs('xhigh',role)).toBe(480000);
 expect(modelTimeoutMs('high','scene-space')).toBe(300000);
 expect(modelTimeoutMs('unknown','scene-space')).toBe(120000);
});
