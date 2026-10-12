import {test,expect} from 'bun:test';
import {surfaceTranslucencyRule,SURFACE_TRANSLUCENCY,SURFACE_TRANSLUCENCY_GUIDANCE} from './surface-translucency';

test('只有带 surface-translucency-v1 策略的任务开启透光指导',()=>{
 expect(surfaceTranslucencyRule({surfaceTranslucencyPolicy:SURFACE_TRANSLUCENCY})).toBe(true);
 expect(surfaceTranslucencyRule({})).toBe(false);
 expect(surfaceTranslucencyRule({surfaceTranslucencyPolicy:null})).toBe(false);
 expect(surfaceTranslucencyRule({surfaceTranslucencyPolicy:'surface-translucency-v0'})).toBe(false);
 expect(surfaceTranslucencyRule(null)).toBe(false);
});

test('透光指导声明使用 color 第4位 alpha，并保留开口检查的 alpha>=0.95 不透明阈值',()=>{
 // 复用既有 alpha 通道，不新增 schema；并明确与开口射线检查的交互，避免把实心墙伪造成开口。
 expect(SURFACE_TRANSLUCENCY_GUIDANCE).toContain('alpha');
 expect(SURFACE_TRANSLUCENCY_GUIDANCE).toContain('alpha>=0.95');
 expect(SURFACE_TRANSLUCENCY_GUIDANCE).toContain('不透光表面 alpha 保持 1');
 expect(SURFACE_TRANSLUCENCY_GUIDANCE).toContain('不能把实心墙面改成透光来伪造开口');
 expect(SURFACE_TRANSLUCENCY_GUIDANCE).toContain('assumptions');
 expect(SURFACE_TRANSLUCENCY_GUIDANCE).toContain('不预测得分');
});
