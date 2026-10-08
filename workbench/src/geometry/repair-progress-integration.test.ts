import {test,expect} from 'bun:test';
import {repairOutcome} from './repair-outcome';
import {candidateEvidence,candidateProgress} from './candidate-selection';
const weights={coverage:28,spatial:32,shape:12,material:20,readability:8};
const evidence=(raw:number,score:number,reasons=['原始维度加权分未达到70']):any=>({
 policy:{version:'scene-quality-v7',deliveryStandard:'basic70',dimensionWeights:weights,dimensionFloor:3},status:reasons.length?'failed':'passed',
 deliveryAssessment:{standard:'basic70',status:reasons.length?'failed':'passed',reasons,rawScore:raw,score},quality:{score,dimensions:Object.keys(weights).map(id=>({id,score:3})),hardFailures:[],criticalMissing:[]},
 review:{dimensions:Object.keys(weights).map(id=>({id,score:raw/20})),requirements:[{id:'R1',verdict:'partial',reason:'局部细节不足',frames:[]}]},spec:{rules:[]}
});
function compare(a:any,b:any){return repairOutcome({before:a.quality,after:b.quality,reviewBefore:a.review,reviewAfter:b.review,specBefore:a.spec,specAfter:b.spec,deliveryBefore:a.deliveryAssessment,deliveryAfter:b.deliveryAssessment,policy:b.policy,comparable:true,budget:{},goals:{goals:[{id:'G',requirementIds:['R1']}]}});}
test('跨任务复盘与自动轮次都拒绝仅正式分上涨',()=>{
 const a=evidence(65.6,70.2),b=evidence(65.68,73.3),before=JSON.stringify([a,b]),r=compare(a,b);
 expect(r.selection).toEqual(candidateProgress(candidateEvidence(a),candidateEvidence(b)));
 expect(r.selection.meaningful).toBe(false);expect(r.requiresDiagnosis).toBe(true);expect(JSON.stringify([a,b])).toBe(before);
});
test('真实raw收益不被正式分平稳或非关键partial警告否决',()=>{
 const r=compare(evidence(65,74),evidence(68,73.8));
 expect(r.selection.rawGain).toBe(3);expect(r.selection.meaningful).toBe(true);expect(r.requiresDiagnosis).toBe(false);expect(r.scoreSignal).toBe('effective_gain');
});
test('关闭真实basic交付缺陷沿用同一进步判定',()=>{
 const r=compare(evidence(65,74,['原始维度加权分未达到70','已确认的规范缺陷：S13']),evidence(65.5,73.8));
 expect(r.selection.closed).toContain('delivery:已确认的规范缺陷：S13');expect(r.requiresDiagnosis).toBe(false);
});
test('基础交付通过不被严格80失败或正式分微降阻止',()=>{
 const a=evidence(69,81),b=evidence(71,80.5,[]);a.quality.status='failed';b.quality.status='failed';
 const r=compare(a,b);expect(r.selection.meaningful).toBe(true);expect(r.requiresDiagnosis).toBe(false);
});
test('不可比与实际硬检查失败仍阻止basic进步放行',()=>{
 const a=evidence(65,74),b=evidence(68,77);b.quality.hardFailures=['runtime'];expect(compare(a,b).requiresDiagnosis).toBe(true);
 const i={before:a.quality,after:b.quality,policy:a.policy,comparable:false};expect(repairOutcome(i).requiresDiagnosis).toBe(true);
});
