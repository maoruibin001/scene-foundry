import {test,expect} from 'bun:test';
import {roundAuditCard,roundAuditHTML} from '../../public/round-audit-ui.js';
import {repairOutcome} from './repair-outcome';
test('没有评分的失败轮也显示复盘，执行中不伪造结果',()=>{
 expect(roundAuditCard({id:'failed',refineScene:true,status:'blocked'})).toContain('data-round-audit="failed"');
 expect(roundAuditCard({id:'active',refineScene:true,status:'running'})).toBe('');
});
test('运行失败显示具体证据及未评分，不把空评分显示成0分',()=>{
 const r=repairOutcome({comparable:true,before:{score:58.4},after:{hardFailures:['cameraMotion']},executionFailure:{stage:'judge',error:'机位与后墙相交 <tag>'}});
 expect(r.comparison.delta).toBeNull();expect(r.requiresDiagnosis).toBe(true);expect(r.nextAction).toContain('先修复运行失败');
 const html=roundAuditHTML(r);expect(html).toContain('未评分');expect(html).not.toContain('null 分');expect(html).toContain('cameraMotion');expect(html).toContain('&lt;tag&gt;');expect(html).not.toContain('<tag>');
});
test('尚未渲染的执行失败与视觉低分分别处理',()=>{
 const r=repairOutcome({comparable:true,before:{score:58.4},executionFailure:{stage:'build',error:'构建失败'}});
 expect(r.nextAction).toContain('执行错误');expect(r.signals.map(x=>x.kind)).toContain('execution_failure');expect(r.signals.map(x=>x.kind)).not.toContain('runtime_failure');
});

const weights={coverage:28,spatial:32,shape:12,material:20,readability:8};
const basicAudit=(rawBefore:number,rawAfter:number)=>repairOutcome({comparable:true,policy:{deliveryStandard:'basic70',version:'scene-quality-v7',dimensionWeights:weights},before:{score:71.6,diagnostic:{score:rawBefore}},after:{score:74.1,diagnostic:{score:rawAfter}},deliveryBefore:{status:'failed',rawScore:rawBefore,reasons:['原始维度加权分未达到70']},deliveryAfter:{status:'failed',rawScore:rawAfter,reasons:['原始维度加权分未达到70']},reviewBefore:{dimensions:Object.keys(weights).map(id=>({id,score:rawBefore/20}))},reviewAfter:{dimensions:Object.keys(weights).map(id=>({id,score:rawAfter/20}))}});
test('基础70优先显示raw下降，综合分上涨不能伪装为进步',()=>{
 const r=basicAudit(66.72,65.2),html=roundAuditHTML(r);
 expect(r.comparison.rawDelta).toBe(-1.52);expect(r.scoreSignal).toBe('regression');
 expect(html).toContain('-1.52 分');expect(html).toContain('未证明有效进步');expect(html).toContain('综合分 71.6 → 74.1');
 expect(html).not.toContain('达到单轮提分信号');expect(html).not.toContain('存在可核验进步');
});
test('基础70缺少可比raw时显示无法比较，不把缺失当零分',()=>{
 const r=basicAudit(NaN,NaN),html=roundAuditHTML(r);
 expect(r.comparison.rawDelta).toBeNull();expect(html).toContain('无法比较');expect(html).toContain('未评分');expect(html).not.toContain('NaN');expect(html).not.toContain('null 分');
 const incomparable=basicAudit(66,69);incomparable.comparison.rawDelta=null;incomparable.requiresDiagnosis=true;
 expect(roundAuditHTML(incomparable)).toContain('无法比较');
});
test('基础进步与基础交付分开展示，strict旧口径保留',()=>{
 const r=basicAudit(66,69);expect(roundAuditHTML(r)).toContain('存在可核验进步');expect(roundAuditHTML(r)).toContain('仍需完整70分验收');
 r.deliveryStatus='passed';expect(roundAuditHTML(r)).toContain('基础交付通过');expect(roundAuditHTML(r)).toContain('停止提分');
 const strict=repairOutcome({comparable:true,before:{score:72},after:{score:75}});expect(roundAuditHTML(strict)).toContain('达到单轮提分信号');expect(roundAuditHTML(strict)).not.toContain('70分基础线');
});

test('已评候选之后取消下一轮，不把已保存评分写成尚未评估',()=>{
 const r=repairOutcome({comparable:true,before:{score:72},after:{score:74},executionFailure:{stage:'repair',error:'AbortError'}});
 expect(r.nextAction).toContain('保留本轮已评候选');expect(r.nextAction).not.toContain('尚无可比较评分');
 expect(roundAuditHTML(r)).toContain('本轮评分已保存');
});
