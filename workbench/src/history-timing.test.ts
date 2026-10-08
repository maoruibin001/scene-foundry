import {test,expect} from 'bun:test';
import {compactJob} from './job-summary';
import {historyTiming} from '../public/history-timing.js';
const job=(extra:any={})=>({id:'job',createdAt:new Date(1000).toISOString(),endedAt:5000,status:'passed',profile:{id:'profile',provider:'codex-cli',model:'gpt-6-astra-aihub-openai'},...extra});
test('精简任务保留已知结束时间，不带入完整场景和大评分数据',()=>{
 const j=job({plan:{name:'温室',requirements:[{big:'detail'}]},generatedScene:{big:'geometry'},review:{score:70}}),s=compactJob(j);
 expect(s.endedAt).toBe(5000);expect(s.plan).toEqual({name:'温室'});expect(s).not.toHaveProperty('generatedScene');expect(s).not.toHaveProperty('review');expect(s.profile).toEqual({id:'profile',provider:'codex-cli',model:'gpt-6-astra-aihub-openai',reasoningEffort:undefined});
});
test('诊断索引未包含旧任务时，侧栏仍显示任务中已知的真实耗时',()=>{
 expect(historyTiming(compactJob(job()),undefined,10000)).toEqual({start:1000,end:5000,running:false});
});
test('当前任务状态和结束时间优先于滞后诊断索引，不假装仍在执行',()=>{
 expect(historyTiming(compactJob(job()),{start:2000,end:3000,status:'running'},10000)).toEqual({start:1000,end:5000,running:false});
});
test('执行中按现在计算；无结束记录、非法与反向时间保持未知',()=>{
 expect(historyTiming(compactJob(job({status:'running',endedAt:null})),{end:5000},10000)).toEqual({start:1000,end:10000,running:true});
 for(const value of [null,undefined,NaN,500])expect(historyTiming(compactJob(job({endedAt:value})),undefined,10000).end).toBeNull();
});
test('已有诊断时间可作只读补充，不借updatedAt或成功分数伪造结束时间',()=>{
 const j=compactJob(job({endedAt:null,updatedAt:9000,quality:{score:99}}));
 expect(historyTiming(j,{start:1000,end:5000,status:'passed'},10000).end).toBe(5000);
 expect(historyTiming(j,undefined,10000).end).toBeNull();
});
