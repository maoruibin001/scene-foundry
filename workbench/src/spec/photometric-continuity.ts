import {mkdirSync,writeFileSync} from 'node:fs';import {join} from 'node:path';
import type {SceneSpec} from './schema';import {applyAppearanceRevision} from './appearance-continuation';
/** Explicit opt-in conversion for a copied numeric intensity across unlike native units.
 * DirectionalLight is lux. SpotLight is candela. Preserve nominal on-axis illuminance
 * at the first frozen reference shot target, I_cd = E_lux * distance_m^2.
 * Cone/range/shadow/material effects remain subject to a real render and independent review. */
export function photometricContinuity(before:SceneSpec,current:SceneSpec){
 const target=current.shots[0]?.target;if(!target)throw Error('PHOTOMETRIC_REFERENCE_MISSING');
 const conversions:any[]=[];
 for(const state of current.lighting.states)for(const light of state.lights){const old=before.lighting.states.find(s=>s.id===state.id)?.lights.find(l=>l.id===light.id);
  if(!old||old.kind!=='directional'||light.kind!=='spot'||old.intensity!==light.intensity||!light.position||!light.direction)continue;
  const v=target.map((n,i)=>n-light.position![i]),distanceSquared=v.reduce((n,x)=>n+x*x,0),d=Math.sqrt(distanceSquared),dl=Math.hypot(...light.direction),cos=v.reduce((n,x,i)=>n+x*light.direction![i],0)/(d*dl);
  if(!Number.isFinite(d)||d<1||cos<Math.cos((light.innerConeDeg??0)*Math.PI/180))throw Error('PHOTOMETRIC_REFERENCE_OUTSIDE_INNER_CONE');
  const candela=Number((old.intensity*distanceSquared).toFixed(6));if(candela>10000)throw Error('PHOTOMETRIC_CONVERSION_EXCEEDS_ADMITTED_INTENSITY');
  conversions.push({state:state.id,light:light.id,sourceLux:old.intensity,copiedCandela:light.intensity,target,distanceSquared,distance:d,resolvedCandela:candela,nominalLuxBefore:light.intensity/distanceSquared,nominalLuxAfter:candela/distanceSquared});
 }
 if(!conversions.length)throw Error('NO_COPIED_CROSS_UNIT_INTENSITY');return {version:'photometric-continuity-v1',referenceShot:current.shots[0].id,formula:'I_cd = E_lux * distance_m^2; nominal on-axis value, excluding range fade/occlusion',conversions};
}
export function resolvePhotometricContinuity(before:SceneSpec,current:SceneSpec,dir:string){const audit=photometricContinuity(before,current);mkdirSync(dir,{recursive:true});const revision={id:'photometric-continuity',summary:'Preserve nominal illumination across an explicit directional-to-spot unit conversion at the frozen reference target',patches:audit.conversions.map(c=>({target:'light' as const,id:c.light,state:c.state,set:{intensity:c.resolvedCandela},reason:`Native units differ: ${c.sourceLux} lux × ${c.distanceSquared} m² = ${c.resolvedCandela} cd at frozen shot ${audit.referenceShot}; no geometry or other parameters changed.`}))};const r=applyAppearanceRevision(current,revision);for(const [name,value] of [['photometric-conversion.json',audit],['revision.json',revision],['continuation.json',r.receipt],['revised-spec.json',r.spec]])writeFileSync(join(dir,name as string),JSON.stringify(value,null,2));return r;}
