import {verifiedCandidateEnvironment} from './payload';
import {readFileSync,writeFileSync,existsSync,cpSync} from 'node:fs';
import {join} from 'node:path';
import {AssetGuid} from '@forgeax/engine/pack/guid';
import {definePackageId} from '@forgeax/engine/pack/source';
/** Explicit environment payload from the actual pipeline candidate, not a hand-authored game patch. */
export const candidateEnvironment=verifiedCandidateEnvironment;
export function environmentWrapperFragment(env:any){
 if(!env)return {imports:'',definition:'',body:''};
 const additions=Object.fromEntries(Object.entries(env.entities).filter(([key])=>!['garden','camera'].includes(key)));
 const camera={...env.entities.camera.components};delete camera.Transform;delete camera.Name;
 return {imports:"import * as RenderComponents from '@forgeax/engine/render';\n",definition:`sceneComponents:(()=>{const merged=new Map<string,any>();for(const c of [...(base.sceneComponents??[]),...${JSON.stringify(env.components.filter((c:string)=>!['Name','Transform'].includes(c)))}.map((k:string)=>{const c=(RenderComponents as any)[k];if(!c)throw Error('ENV_COMPONENT_UNSUPPORTED:'+k);return c;})]){const old=merged.get(c.name);if(old&&JSON.stringify(old.fields)!==JSON.stringify(c.fields))throw Error('ENV_COMPONENT_SCHEMA_CONFLICT:'+c.name);merged.set(c.name,c);}return Array.from(merged.values());})(),`,
 body:`for(const key of ${JSON.stringify(env.removeKeys)}){if(scene.entities[key]?.components?.MeshFilter)throw Error('ENV_WOULD_REMOVE_GEOMETRY');delete scene.entities[key];}\nObject.assign(scene.entities.camera.components,${JSON.stringify(camera)});\nfor(const [key,value] of Object.entries(${JSON.stringify(additions)})){if(scene.entities[key]?.components?.MeshFilter)throw Error('ENV_WOULD_REPLACE_GEOMETRY');scene.entities[key]=value;}\n`};
}
export function installEnvironmentSources(game:string,candidate:string,dest:string,revision:string,packageId:string,sceneKey:string,env:any,previous:any){
 if(!env)return null;
 if(env.volumetric){cpSync(env.fogSource,join(dest,'volumetric-fog.ts'));writeFileSync(join(game,'assets/pipeline-revisions/active-effects.ts'),`import {installVolumetricFog} from './${revision}/volumetric-fog.ts';\nexport function installPipelineEffects(ctx:any,root:any){return installVolumetricFog(ctx,root,${JSON.stringify(sceneKey)});}\n`);}
 else writeFileSync(join(game,'assets/pipeline-revisions/active-effects.ts'),'export function installPipelineEffects(_ctx:any,_root:any){return ()=>{};}\n');
 const cfg=JSON.parse(readFileSync(join(game,'forge.json'),'utf8'));
 if(cfg.roots.build&&cfg.roots.build!==previous?.buildRoot)throw Error('EXISTING_BUILD_ROOT_NEEDS_COMPOSITION');
 // Each ScriptablePack owns a root GUID as well as its emitted asset GUIDs.
 // A second file with the mesh pack's packageId collides before any asset loads.
 const profilePackageId=AssetGuid.format(AssetGuid.derive(definePackageId(packageId),'package/render-profile'));
 const guid=AssetGuid.format(AssetGuid.derive(definePackageId(profilePackageId),'plugin/render-profile'));
 writeFileSync(join(dest,'render-profile.pack.ts'),`import type {} from '@forgeax/engine/devkit/plugin-build';\nimport type {Plugin} from '@forgeax/engine/plugin';\nimport {definePack,definePackageId} from '@forgeax/engine/pack/source';\nimport {ok} from '@forgeax/engine/types';\nexport const pipelineRenderProfile={name:'pipeline/render-profile',provide:['devkitAppOptions'],apply(ctx){ctx.provide('devkitAppOptions',{standardProfile:${JSON.stringify(env.profile)}} as any);}} satisfies Plugin;\nexport default definePack({schemaVersion:'2.0.0',packageId:definePackageId(${JSON.stringify(profilePackageId)}),plugins:true,build:()=>ok({'plugin/render-profile':{kind:'plugin',module:{specifier:'./render-profile.pack.ts',export:'pipelineRenderProfile'}}})});\n`);
 cfg.roots.build=guid;writeFileSync(join(game,'forge.json'),JSON.stringify(cfg,null,2)+'\n');return guid;
}
