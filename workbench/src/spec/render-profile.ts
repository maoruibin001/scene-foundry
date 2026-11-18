/**
 * 渲染器配置(构建期):漫反射 GI 只能经构建根插件提供 devkitAppOptions.standardProfile,pack 与场景数据声明不了。
 * 这里按规格包络算出 irradiance-field GI 参数(与引擎 hello-gi 的 fieldFor 同一套比例:64 采样网格、12 层探针、半分辨率),
 * 再写成一个 build 插件。GI 要求延迟渲染 + 关闭 IBL(引擎 game-build-failed 原文)。
 */
import type {SceneSpec,Vec3} from './schema';
import {toEnginePosition} from './export-pack';

const FIELD_SAMPLES=64,PROBE_CELLS=12,CARD_RESOLUTION=32;
export function irradianceFieldGi(spec:SceneSpec,environment:Vec3){
 const a=toEnginePosition(spec.bounds.min),b=toEnginePosition(spec.bounds.max),lo=[0,1,2].map(k=>Math.min(a[k],b[k])),hi=[0,1,2].map(k=>Math.max(a[k],b[k]));
 const size=hi.map((v,k)=>v-lo[k]),spacing=Math.max(...size)/(FIELD_SAMPLES-4),margin=2*spacing;
 const dimensions=size.map(v=>Math.min(128,Math.max(4,Math.ceil((v+2*margin)/spacing)+1)));
 return {gather:'irradiance-field',maxDistance:Math.hypot(...size),environment,
  field:{region:{grid:{origin:lo.map(v=>v-margin),dimensions,spacing,maxDistance:8*spacing,coverageDistance:spacing},maxInstances:1024,maxFieldBytes:64*1024*1024},
   // 质量旋钮(实验用,环境变量覆盖):探针间距、每探针光线数、时间累积、Card 分辨率。
   probeSpacing:Number(process.env.SPEC_GI_PROBE)||Math.max(spacing,Math.cbrt(size[0]*size[1]*size[2])/PROBE_CELLS),raysPerProbe:Number(process.env.SPEC_GI_RAYS)||64,probeBudget:Number(process.env.SPEC_GI_BUDGET)||128,hysteresis:Number(process.env.SPEC_GI_HYST)||0.7,
   cards:{resolution:Number(process.env.SPEC_GI_CARD)||CARD_RESOLUTION,maxCaptureBytes:256*1024*1024,budget:Number(process.env.SPEC_GI_CARDBUDGET)||256},resolution:process.env.SPEC_GI_RES==='full'?'full':'half',radiosity:process.env.SPEC_GI_RADIOSITY!=='0'},
  // GI 下 IBL 必须关;镜面改用 Lite reflections(GI 场辐射缓存 + SDF/Card 追踪),SSR 命中处覆盖。
  ...(process.env.SPEC_GI_REFL==='0'?{}:{reflections:{maxRoughnessToTrace:0.4,roughnessFadeLength:0.1}})};
}
/** build 插件源码:把 standardProfile 局部覆盖交给 DevKit。 */
export function renderProfilePlugin(profile:Record<string,unknown>){
 return `import type {} from '@forgeax/engine/devkit/plugin-build';
import type {Plugin} from '@forgeax/engine/plugin';
// 由 scene-foundry 规格导出器生成:渲染器 standardProfile(漫反射 GI 等),构建期注入。
const profile=${JSON.stringify(profile)} as any;
export default {name:'scene/render-profile',provide:['devkitAppOptions'],apply(ctx){ctx.provide('devkitAppOptions',{standardProfile:profile} as any);}} satisfies Plugin;
`;
}
