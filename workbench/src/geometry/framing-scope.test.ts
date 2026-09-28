import {expect,test} from 'bun:test';
import {analyzeSceneRun} from './runtime-metrics.mjs';

function fixture(){
 const audit={views:[{referenceIndex:1},{referenceIndex:null}],parts:[{id:'boat'},{id:'building'}],landmarks:[{id:'boat',role:'subject',position:[0,1,0],size:[3,3,3]},{id:'building',role:'context',position:[20,1,-4],size:[4,4,4]}]};
 const base={fov:1,frameTimes:Array(180).fill(1000/60),parts:[{id:'boat',loaded:true},{id:'building',loaded:true}],ambiguousSource:false};
 const samples=Array.from({length:8},(_,i)=>({...structuredClone(base),name:'frame'+i,kind:i<2?'view':'continuous',selectedView:i===1?1:0,position:i===1?[20,1,5]:[i<2?0:.1*(i-2),1,5],target:i===1?[20,1,-4]:[0,1,0],at:i*1000,frames:i*60}));
 return {audit,samples};
}

test('独立建筑检查机位可以不包含渔舟，主体机位和连续观测仍须通过',()=>{
 const {audit,samples}=fixture(),r=analyzeSceneRun(samples,audit);
 expect(r.subjectMeasurement.frames[1].heightRatio).toBe(0);
 expect(r.subjectMeasurement.frames[1].visibleSceneParts).toBe(1);
 expect(r.subjectMeasurement.frames[1].scope).toBe('inspection-context');
 expect(r.subjectMeasurement.continuousFrames).toHaveLength(6);
 expect(Object.values(r.hard).every(Boolean)).toBe(true);
});
test('参考机位拍到建筑仍不能代替主体入画',()=>{
 const {audit,samples}=fixture();samples[0].position=[20,1,5];samples[0].target=[20,1,-4];
 expect(analyzeSceneRun(samples,audit).hard.framing).toBe(false);
});
test('连续浏览丢失主体不能被固定截图掩盖',()=>{
 const {audit,samples}=fixture();samples[5].position=[20,1,5];samples[5].target=[20,1,-4];
 expect(analyzeSceneRun(samples,audit).hard.framing).toBe(false);
});
test('独立检查机位指向空处仍然失败',()=>{
 const {audit,samples}=fixture();samples[1].position=[100,1,5];samples[1].target=[100,1,-4];
 expect(analyzeSceneRun(samples,audit).hard.framing).toBe(false);
});
test('历史未声明参考用途的机位不自动豁免',()=>{
 const {audit,samples}=fixture();audit.views.forEach(v=>delete (v as any).referenceIndex);
 expect(analyzeSceneRun(samples,audit).hard.framing).toBe(false);
});
test('未知相机索引和缺失真实资产不能获得通过',()=>{
 let {audit,samples}=fixture();samples[1].selectedView=99;
 expect(analyzeSceneRun(samples,audit).hard.framing).toBe(false);
 ({audit,samples}=fixture());samples[1].parts[1].loaded=false;
 expect(analyzeSceneRun(samples,audit).hard.entitiesLoaded).toBe(false);
});
test('第二个参考图也必须检验主体，不能当成细节检查图',()=>{
 const {audit,samples}=fixture();audit.views[1].referenceIndex=2;
 expect(analyzeSceneRun(samples,audit).hard.framing).toBe(false);
});
