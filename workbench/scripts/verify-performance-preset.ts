/**
 * 可复跑的接线验证：用一份真实规格跑 prepareSpecProject，确认性能档位真的写进
 * render-profile.json 与 performance-preset.json，而不只是停留在纯函数层。
 * Usage: bun run verify:performance-preset [output-dir]
 */
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {prepareSpecProject} from '../src/spec/prepare-spec';
import {PERFORMANCE_PRESETS} from '../src/spec/performance-presets';

const ROOT=resolve(import.meta.dir,'..');
const out=process.argv[2]??join(tmpdir(),'scene-foundry-perf-probe');
const candidates=[join(ROOT,'data/showcase-v2/spec.json'),...readdirSync(join(ROOT,'data/specs'))
 .filter(f=>f.endsWith('.json')&&!f.endsWith('.style.json')&&/^[a-f0-9]{64}\.json$/.test(f))
 .map(f=>join(ROOT,'data/specs',f))];
const specPath=candidates.find(p=>existsSync(p));
if(!specPath)throw Error('没有可用于接线验证的规格文件');
const spec=JSON.parse(readFileSync(specPath,'utf8'));

await prepareSpecProject(out,spec,{id:'performance-preset-probe',performancePreset:'performance'});
const preset=JSON.parse(readFileSync(join(out,'performance-preset.json'),'utf8'));
const profile=JSON.parse(readFileSync(join(out,'render-profile.json'),'utf8'));
const expected=PERFORMANCE_PRESETS.performance.overrides as any;
const checks={
 presetRecorded:preset.preset==='performance',
 sourceDisclosed:String(preset.source).includes('DEFAULT_STANDARD_PROFILE'),
 renderPathLocked:profile.renderPath==='deferred'&&preset.renderPathLockedToDeferred===true,
 lightCountApplied:profile.lightCount===expected.lightCount,
 volumetricFogApplied:profile.volumetricFog?.depth===expected.volumetricFog.depth&&profile.volumetricFog?.tileSize===expected.volumetricFog.tileSize,
};
const failed=Object.entries(checks).filter(([,v])=>!v).map(([k])=>k);
console.log(JSON.stringify({spec:specPath.replace(ROOT,'workbench'),output:out,checks,
 profile:{renderPath:profile.renderPath,lightCount:profile.lightCount,volumetricFog:profile.volumetricFog},failed},null,2));
if(failed.length)process.exit(1);
