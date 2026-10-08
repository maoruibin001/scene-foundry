import {test,expect} from 'bun:test';
import {deliveryLimitation} from '../public/delivery-ui.js';
test('basic70 passed and strict80 failed remain distinct in delivery explanation',()=>{
 const d={best:{deliveryStandard:'basic70',deliveryStatus:'passed'},limitations:'已有场景输出，当前质量未达标'};
 expect(deliveryLimitation(d)).toContain('70分基础交付已通过，80分完整规范尚未通过');
 expect(deliveryLimitation({...d,best:{...d.best,deliveryStatus:'failed'}})).toBe(d.limitations);
 expect(deliveryLimitation({...d,limitations:'缺少运行录像'})).toBe('缺少运行录像');
});
