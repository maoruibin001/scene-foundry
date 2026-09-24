import {join} from 'node:path';
import {existsSync,readFileSync,mkdirSync} from 'node:fs';
import {DATA,read,save,digest} from '../store';
import {ASSET_PROMPT,assetSchema,validateAsset,type AssetBrief,type SceneLayout} from './layout';
import {assetInput} from './asset-input';
import type {Texture} from './program';
const contract=digest([ASSET_PROMPT,JSON.stringify(assetSchema()),...['program.ts','mesh.ts','constraints.ts','distribution.ts','layout.ts','openings.ts','camera-fit.ts'].map(f=>readFileSync(join(import.meta.dirname,f),'utf8'))].join('\n'));
export function assetKey(job:any,plan:any,layout:SceneLayout,brief:AssetBrief,textures:Record<string,Texture>){return digest(JSON.stringify({input:assetInput(job.prompt,plan,layout,brief,textures),references:(job.images??(job.image?[job.image]:[])).map((i:any)=>i.id),model:job.modelSettings,provider:job.profile?.provider,engine:job.profile?.engineSha,generator:job.profile?.generatorSha,contract}));}
export class AssetCache{
 constructor(readonly root:string){}
 file(key:string){if(!/^[a-f0-9]{64}$/.test(key))throw Error('资产缓存键无效');return join(this.root,key+'.json');}
 get(key:string,brief:AssetBrief,layout:SceneLayout,textures:Record<string,Texture>){try{const file=this.file(key);if(!existsSync(file))return null;const m=read(file);if(m.key!==key||digest(JSON.stringify(m.value))!==m.geometrySha256)return null;validateAsset(m.value,brief,layout,textures);return m;}catch{return null;}}
 put(key:string,value:any,source:any){mkdirSync(this.root,{recursive:true});save(this.file(key),{key,value,geometrySha256:digest(JSON.stringify(value)),source,createdAt:new Date().toISOString()});}
}
export const assetCache=new AssetCache(join(DATA,'asset-cache'));
/** Import existing completed assets when the frozen plan/layout match exactly. */
export function cacheCheckpointAssets(job:any,plan:any,layout:SceneLayout,textures:Record<string,Texture>,snapshots:any[],cache:AssetCache=assetCache){
 let imported=0;
 for(const snapshot of snapshots){if(digest(JSON.stringify(snapshot.plan))!==digest(JSON.stringify(plan))||digest(JSON.stringify(snapshot.layout))!==digest(JSON.stringify(layout)))continue;
  for(const asset of snapshot.assets){const brief=layout.program.templates.find(t=>t.id===asset.id);if(!brief)continue;const key=assetKey(job,plan,layout,brief,textures);if(cache.get(key,brief,layout,textures))continue;try{validateAsset(asset.value,brief,layout,textures);cache.put(key,asset.value,{jobId:snapshot.manifest.sourceJobId,checkpointId:snapshot.manifest.id,pipelineVersion:asset.source.pipelineVersion,kind:'validated-checkpoint-import'});imported++;}catch{/* A cache miss must never invalidate usable source artifacts. */}}
 }
 return imported;
}
