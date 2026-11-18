/**
 * 性能档位：把散落在 prepare-spec.ts 的渲染预算开关收敛成可枚举、可回滚的配置。
 *
 * 来源说明：base 是引擎导出的 DEFAULT_STANDARD_PROFILE（一个渲染配置常量），
 * 档位覆盖项是**本仓库自己的预算开关**（lightCount / volumetricFog），
 * 不是「引擎提供的通用性能优化方案库」——引擎没有 optimize API，也没有方案集合。
 *
 * 硬约束：renderPath 不可改。ProjectedDecal 与漫反射 GI 都要求 deferred，
 * 切回 forward 会让贴花或 GI 直接失效，不能拿来换帧率。
 */
export type PerformancePresetId='quality'|'balanced'|'performance';

export type PerformancePreset={
 id:PerformancePresetId;label:string;
 overrides:Record<string,unknown>;
 expectedEffect:string;
 visualRisk:'none'|'low'|'medium'|'high';
 note:string;
};

export const PERFORMANCE_PRESETS:Record<PerformancePresetId,PerformancePreset>={
 quality:{
  id:'quality',label:'原画质（回滚基准）',overrides:{},
  expectedEffect:'保持当前渲染配置，作为优化前的基线与回滚点',
  visualRisk:'none',note:'不改任何渲染参数；优化链的第一份基线用这个档位记录。',
 },
 balanced:{
  id:'balanced',label:'均衡档',
  overrides:{lightCount:24,volumetricFog:{quality:'low',depth:32,tileSize:16}},
  expectedEffect:'灯光预算 32→24，体积雾深度 48→32，降低每帧体积采样与光照开销',
  visualRisk:'low',note:'体积雾层次与远端补光可能略弱；必须重跑视觉评审。',
 },
 performance:{
  id:'performance',label:'性能档',
  overrides:{lightCount:16,volumetricFog:{quality:'low',depth:24,tileSize:8}},
  expectedEffect:'灯光预算 32→16，体积雾深度 48→24、瓦片 16→8，进一步压低填充与体积采样',
  visualRisk:'medium',note:'氛围与冷暖对比可能明显变淡；必须重跑视觉评审，且不得冒充验收通过。',
 },
};

/** 优化时按顺序加压；quality 只作回滚基准，不作为优化轮次。 */
export const OPTIMIZATION_PRESET_ORDER:PerformancePresetId[]=['balanced','performance'];

export function isPerformancePreset(v:unknown):v is PerformancePresetId{
 return typeof v==='string'&&Object.prototype.hasOwnProperty.call(PERFORMANCE_PRESETS,v);
}

export function validatePerformancePreset(v:unknown):PerformancePresetId{
 if(!isPerformancePreset(v))throw Error('未知性能档位：'+String(v));
 return v;
}

/** 纯函数：在引擎默认 profile 之上叠加档位。不改入参，不改 renderPath。 */
export function applyPerformancePreset(base:Record<string,unknown>,id:PerformancePresetId):Record<string,unknown>{
 const preset=PERFORMANCE_PRESETS[id];
 if(!preset)throw Error('未知性能档位：'+String(id));
 const out={...base,...preset.overrides};
 // deferred 是贴花与 GI 的硬前提，任何档位都不能把它换掉。
 if((base.renderPath==='deferred')&&out.renderPath!=='deferred')out.renderPath='deferred';
 return out;
}

/** 供 UI 与报告展示：每档改了什么、预期影响、视觉风险。 */
export function presetSummary(id:PerformancePresetId):string{
 const p=PERFORMANCE_PRESETS[id];
 if(!p)return '';
 return `${p.label}：${p.expectedEffect}（视觉风险 ${p.visualRisk}；${p.note}）`;
}
