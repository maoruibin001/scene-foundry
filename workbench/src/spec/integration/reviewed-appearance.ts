import {validateSceneSpec,type SceneSpec} from '../schema';
import {specDigest} from '../continuation';

/** Adopt an immutable pipeline appearance result; never regenerate or move geometry. */
export function reviewedAppearanceReceipt(base:SceneSpec,result:SceneSpec,approvedSpecSha256:string,revision:string){
 validateSceneSpec(base);validateSceneSpec(result);
 if(specDigest(result)!==approvedSpecSha256)throw Error('REVIEWED_APPEARANCE_DIGEST_MISMATCH');
 const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
 for(const key of new Set([...Object.keys(base),...Object.keys(result)])){
  if(['materials','lighting','sourceEnvironment','provenance'].includes(key))continue;
  if(!same((base as any)[key],(result as any)[key]))throw Error('REVIEWED_APPEARANCE_NONVISUAL_CHANGE:'+key);
 }
 const environment=(s:SceneSpec)=>s.sourceEnvironment?Object.fromEntries(Object.entries(s.sourceEnvironment).filter(([k])=>k!=='lightingMode')):null;
 if(!same(environment(base),environment(result)))throw Error('REVIEWED_APPEARANCE_SOURCE_ENVIRONMENT_CHANGED');
 if(!same(base.lighting,result.lighting)&&result.sourceEnvironment?.lightingMode!=='spec')throw Error('REVIEWED_APPEARANCE_EXPLICIT_LIGHTING_REQUIRED');
 if(!same(base.materials.map(m=>m.id).sort(),result.materials.map(m=>m.id).sort()))throw Error('REVIEWED_APPEARANCE_MATERIAL_IDENTITIES_CHANGED');
 const changed=result.materials.filter(m=>!same(m,base.materials.find(b=>b.id===m.id)));
 if(!changed.length&&same(base.lighting,result.lighting)&&same(base.sourceEnvironment,result.sourceEnvironment))throw Error('REVIEWED_APPEARANCE_EMPTY');
 return {version:'reviewed-appearance-adoption-v1',baseSpecSha256:specDigest(base),resultSpecSha256:approvedSpecSha256,revision,
  retainedObjects:base.objects.map(o=>o.id),changedObjects:[],
  patches:[...changed.map(m=>({target:'material',id:m.id,set:structuredClone(m),reason:'Immutable reviewed pipeline appearance '+approvedSpecSha256})),
   ...result.sourceEnvironment?.lightingMode==='spec'?[{target:'sourceLightingMode',id:'*',set:{lightingMode:'spec'},reason:'Adopt the reviewed pipeline environment and lights'}]:[]],
  lightingSnapshot:structuredClone(result.lighting),scope:'Appearance snapshot adoption only; geometry, placement, shots, constraints and source mesh identities unchanged'};
}
