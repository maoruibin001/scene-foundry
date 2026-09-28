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
