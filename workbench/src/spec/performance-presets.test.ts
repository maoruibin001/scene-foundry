import {test,expect} from 'bun:test';
import {
 PERFORMANCE_PRESETS,OPTIMIZATION_PRESET_ORDER,applyPerformancePreset,
 validatePerformancePreset,presetSummary,
} from './performance-presets';

const base={renderPath:'deferred',ibl:true,lightCount:32,volumetricFog:{quality:'low',depth:48,tileSize:16},shadow:1024};

test('三档覆盖项是渲染预算，且 quality 是零改动的回滚基准',()=>{
 expect(PERFORMANCE_PRESETS.quality.overrides).toEqual({});
 expect(PERFORMANCE_PRESETS.balanced.overrides).toMatchObject({lightCount:24,volumetricFog:{depth:32}});
 expect(PERFORMANCE_PRESETS.performance.overrides).toMatchObject({lightCount:16,volumetricFog:{depth:24,tileSize:8}});
 expect(OPTIMIZATION_PRESET_ORDER).toEqual(['balanced','performance']);
 expect(OPTIMIZATION_PRESET_ORDER).not.toContain('quality');
});

test('应用档位是纯函数，保留引擎默认 profile 的其它字段',()=>{
 const out=applyPerformancePreset(base,'performance');
 expect(out).toMatchObject({renderPath:'deferred',ibl:true,shadow:1024,lightCount:16});
 expect(out.volumetricFog).toEqual({quality:'low',depth:24,tileSize:8});
 expect(base.lightCount).toBe(32);
 expect(base.volumetricFog.depth).toBe(48);
});

test('贴花与 GI 要求 deferred，任何档位都不能把 renderPath 换掉',()=>{
 const forced=applyPerformancePreset({...base,renderPath:'deferred'},'performance') as any;
 expect(forced.renderPath).toBe('deferred');
 const tampered=applyPerformancePreset({...base,renderPath:'deferred'},'quality') as any;
 expect(tampered.renderPath).toBe('deferred');
 for(const id of OPTIMIZATION_PRESET_ORDER)expect(PERFORMANCE_PRESETS[id].overrides).not.toHaveProperty('renderPath');
});

test('未知档位被拒绝，摘要明确写出视觉风险与复评要求',()=>{
 expect(validatePerformancePreset('balanced')).toBe('balanced');
 expect(()=>validatePerformancePreset('turbo')).toThrow('未知性能档位');
 expect(()=>validatePerformancePreset(null)).toThrow('未知性能档位');
 expect(presetSummary('performance')).toContain('视觉风险');
 expect(presetSummary('performance')).toContain('重跑视觉评审');
});
