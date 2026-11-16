import {readFileSync,writeFileSync} from 'node:fs';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {writeInspectionPlugins} from './prepare';import {composePluginSource} from '../../../prototype/bin/compose-host';
/** Refresh only the pipeline-owned capture controls in a saved-project copy.
 * No geometry, lighting, camera definitions, roots or asset identifiers change. */
export function refreshSavedCaptureControls(project:string){
 const assets=join(project,'game/assets'),cfg=JSON.parse(readFileSync(join(project,'game/forge.json'),'utf8')),audit=JSON.parse(readFileSync(join(assets,'scene-audit.json'),'utf8'));
 if(!['spec-scene-generation','general-scene-generation'].includes(audit.provenance?.kind)||!audit.views?.length||cfg.schemaVersion!=='3.0.0')throw Error('SAVED_PIPELINE_CAPTURE_PROJECT_REQUIRED');
 const host=readFileSync(join(assets,'host.pack.ts'),'utf8');for(const id of ['camera','ui'])if(!host.includes(`"specifier":"./${id}.plugin.ts","export":"${id}"`))throw Error('SAVED_CAPTURE_PLUGIN_BINDING_MISMATCH');
 const sha=(s:string)=>createHash('sha256').update(s).digest('hex'),worldPath=join(assets,'world.pack.ts'),world=readFileSync(worldPath,'utf8');
 const before=Object.fromEntries(['camera.plugin.ts','ui.plugin.ts'].map(f=>[f,sha(readFileSync(join(assets,f),'utf8'))]));
 const result=writeInspectionPlugins(project,assets,world,audit.views);if(result!==world)throw Error('CAPTURE_REFRESH_WOULD_CHANGE_WORLD');
 for(const id of ['camera','ui']){const file=join(assets,id+'.plugin.ts');writeFileSync(file,composePluginSource(readFileSync(file,'utf8'),id));}
 if(readFileSync(worldPath,'utf8')!==world)throw Error('CAPTURE_REFRESH_CHANGED_WORLD');
 return {version:'saved-capture-controls-refresh-v1',worldSha256:sha(world),before,after:Object.fromEntries(['camera.plugin.ts','ui.plugin.ts','camera-motion.ts','capture-telemetry.ts'].map(f=>[f,sha(readFileSync(join(assets,f),'utf8'))])),geometryLightingAndViewsUnchanged:true};
}
