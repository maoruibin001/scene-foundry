import {test,expect} from 'bun:test';
import {deliveryHTML,jobOriginHTML} from '../public/delivery-ui.js';
const pending={available:false,state:'pending',execution:{}};
test('从头来源的后续修正不再被描述为全新生成，链接保留旧输出',()=>{
 const j={reuseMode:'fresh',refineScene:true,reuseSceneFrom:'source',delivery:pending};
 expect(jobOriginHTML(j)).toContain('场景修正');expect(jobOriginHTML(j)).not.toContain('完全从头生成');
 const html=deliveryHTML(j);expect(html).toContain('本次场景修正结果');expect(html).not.toContain('首个');expect(html).toContain('#job/source');
});
test('技术续接、复评和原始输入保留各自身份，不根据缓存模式误判',()=>{
 expect(jobOriginHTML({reuseMode:'fresh',recoverySourceJobId:'source',refineScene:true})).toContain('执行恢复');
 expect(jobOriginHTML({reuseMode:'fresh',reuseAssessmentFrom:'source'})).toContain('重新评估');
 expect(jobOriginHTML({reuseMode:'fresh'})).toContain('完全从头生成');expect(deliveryHTML({delivery:pending})).toContain('首个场景输出');
});
