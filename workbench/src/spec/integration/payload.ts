import {readFileSync,existsSync,copyFileSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const sha=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
/** Payloads are source inputs, then published together with the cooked mesh staging
 * directory. Never write a sidecar into a directory a later exporter replaces. */
export function publishIntegrationPayload(source:string,staging:string){
 const file=join(source,'integration-environment.json');if(!existsSync(file))return;
 const env=JSON.parse(readFileSync(file,'utf8'));
 if(env.version!=='source-environment-adoption-v1')throw Error('INTEGRATION_PAYLOAD_VERSION');
 const fog=join(source,'integration-volumetric-fog.ts');if(env.volumetric&&!existsSync(fog))throw Error('INTEGRATION_VOLUMETRIC_PAYLOAD_MISSING');
 mkdirSync(staging,{recursive:true});copyFileSync(file,join(staging,'integration-environment.json'));
 if(env.volumetric)copyFileSync(fog,join(staging,'volumetric-fog.ts'));
}
/** Compatibility for already-built outputs whose prepare-time payload was moved
 * aside by the atomic generated-directory swap. Its exact native world, profile,
 * and effect source must match the files actually used for that build. */
export function verifiedCandidateEnvironment(candidate:string){
 const project=resolve(candidate,'../../..'),assets=resolve(candidate,'..'),current=join(candidate,'integration-environment.json'),backup=join(project,'.previous-generated'),file=existsSync(current)?current:join(backup,'integration-environment.json');
 if(!existsSync(file))return null;
 const env=JSON.parse(readFileSync(file,'utf8'));if(env.lightingMode!=='spec')return null;
 if(env.version!=='source-environment-adoption-v1')throw Error('INTEGRATION_PAYLOAD_VERSION');
 const worldFile=join(assets,'world.pack.ts'),world=readFileSync(worldFile,'utf8').match(/^const entities=(.+) as any;$/m);
 if(!world||JSON.stringify(JSON.parse(world[1]))!==JSON.stringify(env.entities))throw Error('INTEGRATION_ENV_WORLD_MISMATCH');
 const profileFile=join(project,'render-profile.json');if(JSON.stringify(JSON.parse(readFileSync(profileFile,'utf8')))!==JSON.stringify(env.profile))throw Error('INTEGRATION_ENV_PROFILE_MISMATCH');
 const fogPath=join(existsSync(current)?candidate:backup,'volumetric-fog.ts'),builtFog=join(assets,'volumetric-fog.plugin.ts');
 if(env.volumetric){
  if(!existsSync(fogPath)||!existsSync(builtFog))throw Error('INTEGRATION_ENV_FOG_MISMATCH');
  const original=readFileSync(fogPath,'utf8');
  const composed="import type {} from './scene-refs.ts';\n"+original.replace(/(?:ctx\.gameHost|host)\??\.defaultSceneRoot/g,'ctx.gameScene.root').replace(/inject:\s*\[([^\]]*)\]/,(_,list)=>`inject:[${list},'gameScene']`).replace('export default {','export const volumetricFog={');
  if(readFileSync(builtFog,'utf8')!==original&&readFileSync(builtFog,'utf8')!==composed)throw Error('INTEGRATION_ENV_FOG_MISMATCH');
 }
 return {...env,fogSource:env.volumetric?fogPath:null,payloadEvidence:{recoveredFromPrepareBackup:!existsSync(current),environmentFile:file,environmentSha256:sha(file),worldSourceSha256:sha(worldFile),profileSha256:sha(profileFile),fogSha256:env.volumetric?sha(fogPath):null}};
}
