import type {SceneSpec} from './schema';
/** Audit the density function and the native light semantics before spending on a render. */
export function lightingSemantics(spec:SceneSpec){
 const issues:any[]=[];
 for(const st of spec.lighting.states){
  for(const l of st.lights)if(l.kind==='directional'&&l.position!==null)issues.push({code:'DIRECTIONAL_POSITION_UNUSED',state:st.id,light:l.id,position:l.position,reason:'Native DirectionalLight has no positional transform. A positioned local fixture requires a positional light kind; this field cannot place a directional source inside a skylight.'});
  const v=st.post.volumetric,f=st.post.fog;if(!v||!f)continue;
  const samples=spec.shots.map(s=>{const h=Math.max(0,s.target[2]-f.boundsMin[2]),upper=Math.exp(-v.heightFalloff*h);return {shot:s.id,heightAboveVolumeBottom:h,maxDensity:upper,maxR8:Math.round(upper*255)};});
  if(samples.length&&samples.every(s=>s.maxR8===0))issues.push({code:'VOLUME_QUANTIZED_AWAY_AT_ALL_TARGETS',state:st.id,ratePerMeter:v.heightFalloff,boundsMin:f.boundsMin,boundsMax:f.boundsMax,samples,reason:'The emitted density is exp(-heightFalloff*heightAboveVolumeBottom), then noise only reduces it, then R8 quantization. All inspection targets have zero upper-bound density; this cannot produce an aerial shaft there.'});
 }
 return {version:'lighting-semantics-v1',issues};
}
