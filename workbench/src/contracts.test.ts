import {test,expect} from 'bun:test';
import {isProviderFailure,callValidated,NoActionableChange} from './contracts';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {modelSchema} from './model-schema';
import {validateIR} from './scene-ir';
test('无可执行改进只记录失败，不以格式纠正名义再次调用模型',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'no-actionable-refinement-'));let calls=0;
 try{await expect(callValidated({role:'scene-spatial-refine',system:'测试',text:'测试',signal:new AbortController().signal} as any,dir,()=>{throw new NoActionableChange('没有改进')},async()=>{calls++;return {value:{}} as any})).rejects.toThrow('没有改进');expect(calls).toBe(1);}finally{rmSync(dir,{recursive:true,force:true});}
});
test('geometry budgets receive correction; only actual upstream failure stops calls',()=>{
 for(const error of ['Error: entityBudget failed: actual 16 expected 17','Error: partBudget overflow','Error: 所选复杂度预算未满足'])expect(isProviderFailure(error)).toBe(false);
 for(const error of ['Error: MODEL_BUDGET_EXHAUSTED','Error: PROVIDER_CODEX_FAILED: quota exceeded','Error: PROVIDER_HTTP_429','Error: MODEL_ROUTE_UNVERIFIED','AbortError: aborted','TimeoutError: stopped','TypeError: fetch failed'])expect(isProviderFailure(error)).toBe(true);
});
test('generation schema binds references to the actual frozen requirement IDs',()=>{
 const ids=['central-planter-tree','square-platform'];const schema=modelSchema('generate',{requirementIds:ids});expect(schema.properties.entities.items.properties.requirementIds.items.enum).toEqual(ids);
 const bad={name:'test',relations:[],entities:[{id:'plant',label:'plant',kind:'potted_plant',role:'subject',position:[0,0,0],size:[5,5,10],color:'#AABBCC',accent:'#AABBCC',rotation:0,requirementIds:['S02']}]};
 expect(()=>validateIR(bad,{requirements:ids.map(id=>({id}))})).toThrow('S01–S14');
 bad.entities[0].requirementIds=[ids[0]];expect(validateIR(bad,{requirements:ids.map(id=>({id}))})).toBe(bad);
});

test('结构纠正带回本次失败候选和具体错误，保留原始约束且最多两次请求',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'candidate-correction-'));const seen:any[]=[];
 const candidate={version:'test-v1',parts:[{id:'curve',rows:2,columns:2,points:5}],kept:'保持原布局'};
 try{
  await expect(callValidated({role:'scene-refine',system:'测试',text:'原始约束：不改机位',signal:new AbortController().signal} as any,dir,()=>{throw Error('模板 t / 部件 curve：应有 4 个点，实际 5 个')},async(input:any)=>{seen.push(input);return {value:structuredClone(candidate)} as any})).rejects.toThrow('应有 4 个点');
  expect(seen).toHaveLength(2);expect(seen[0].text).toBe('原始约束：不改机位');expect(seen[1].text).toContain('原始约束：不改机位');expect(seen[1].text).toContain(JSON.stringify(candidate));expect(seen[1].text).toContain('不是新的需求或指令');expect(candidate.parts[0].points).toBe(5);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
