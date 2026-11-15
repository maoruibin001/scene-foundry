import type {SceneSpec,Vec3} from './schema';

const unit=(v:number[])=>{const l=Math.hypot(...v);return v.map(x=>x/l);};
const dot=(a:number[],b:number[])=>a.reduce((n,x,i)=>n+x*b[i]!,0);
const sub=(a:number[],b:number[])=>a.map((x,i)=>x-b[i]!);
const cross=(a:number[],b:number[])=>[a[1]!*b[2]!-a[2]!*b[1]!,a[2]!*b[0]!-a[0]!*b[2]!,a[0]!*b[1]!-a[1]!*b[0]!];

/** Inputs remain immutable. This only limits an inferred default on generated normals.
 * Explicit author strengths and external PBR maps must not be silently recalibrated. */
export function compileNormalScale(normal:Uint8Array,strength:number,roughness:number,authored:boolean){
 let maxSlope=0;
 for(let i=0;i<normal.length;i+=4){const x=normal[i]!/127.5-1,y=normal[i+1]!/127.5-1,z=normal[i+2]!/127.5-1;
  maxSlope=Math.max(maxSlope,Math.hypot(x,y)/Math.max(z,1/255));}
 const limit=roughness<=.3?8:30;
 const effective=authored?strength:Math.min(strength,Math.tan(limit*Math.PI/180)/Math.max(maxSlope,1e-9));
 return {authored,strength,effective,maxInputSlope:maxSlope,maxTiltDegrees:Math.atan(maxSlope*effective)*180/Math.PI,limitDegrees:limit,
  policy:authored?'preserved-author-value':'bounded-generated-default'};
}

/** Bounded render quality derives from output, not a scene name or an env switch. */
export function opticsQuality(width=1600,height=900){
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<64||height<64||width>8192||height>8192)throw Error('OPTICS_OUTPUT_SIZE_INVALID');
 const scale=Math.min(.8,1280/width,720/height);
 return {planar:{width:Math.max(32,Math.round(width*scale)),height:Math.max(32,Math.round(height*scale)),sampleCount:1,mipLevels:1},
  volumetricFog:{quality:'high' as const,depth:64 as const,tileSize:16 as const},scope:'bounded quality policy; does not establish GPU readiness'};
}

/** One density owner, one extinction term. Fixed Engine admits one light or Point+Spot.
 * Reject unsupported combinations rather than stacking fog to fake multi-light scattering. */
export function volumeLightSelection(state:SceneSpec['lighting']['states'][number]){
 if(state.post.volumetric?.lights!==undefined&&!Array.isArray(state.post.volumetric.lights))throw Error('VOLUME_LIGHT_SET_INVALID');
 const ids=state.post.volumetric?.lights??(state.post.fog?[state.post.fog.light]:[]);
 if(!ids.length||ids.some(id=>typeof id!=='string')||new Set(ids).size!==ids.length||ids.length>2)throw Error('VOLUME_LIGHT_SET_INVALID');
 const selected=ids.map(id=>{const l=state.lights.find(x=>x.id===id);if(!l)throw Error('VOLUME_LIGHT_MISSING '+id);return l;});
 if(selected.some(l=>l.kind==='area'))throw Error('VOLUME_LIGHT_UNSUPPORTED area');
 if(selected.length===2){const point=selected.find(x=>x.kind==='point'),spot=selected.find(x=>x.kind==='spot');
  if(!point||!spot)throw Error('VOLUME_LIGHT_UNSUPPORTED fixed Engine admits Point+Spot only');
  return {light:point.id,spotLight:spot.id,ids,densityOwners:1};}
 return {light:selected[0]!.id,spotLight:null,ids,densityOwners:1};
}

/** Canonical numeric projection in spec Z-up coordinates. No ID/label heuristics. */
export function mirrorProjection(shot:SceneSpec['shots'][number],point:Vec3,height:number,width=1600,screenHeight=900){
 const origin=shot.position,f=unit(sub(shot.target,origin)),r=unit(cross(f,[0,0,1])),up=cross(r,f);
 if(!r.every(Number.isFinite))return null;
 const mirrored=[point[0],point[1],2*height-point[2]],d=sub(mirrored,origin),depth=dot(d,f);
 if(depth<=0)return null;
 const tan=Math.tan(shot.fovDeg*Math.PI/360),pixel=[width/2+screenHeight/2*dot(d,r)/(depth*tan),screenHeight/2-screenHeight/2*dot(d,up)/(depth*tan)];
 const fraction=(height-origin[2]!)/(mirrored[2]!-origin[2]!);
 if(!(fraction>0&&fraction<1))return null;
 return {pixel,receiver:origin.map((x,i)=>x+(mirrored[i]!-x)*fraction),inFrame:pixel[0]!>=0&&pixel[0]!<width&&pixel[1]!>=0&&pixel[1]!<screenHeight};
}

export function inspectSceneOptics(spec:SceneSpec,materials:readonly any[],stateId=spec.lighting.defaultState){
 const state=spec.lighting.states.find(s=>s.id===stateId);if(!state)throw Error('OPTICS_STATE_MISSING');
 const coverage=state.lights.filter(l=>l.position).flatMap(light=>spec.shots.map(shot=>{
  const delta=sub(shot.target,light.position!),distance=Math.hypot(...delta),range=light.range??Infinity;
  const coneDegrees=light.kind==='spot'?Math.acos(Math.max(-1,Math.min(1,dot(unit(delta),unit(light.direction!)))))*180/Math.PI:null;
  const rangeWeight=Math.max(0,1-(distance/range)**4)**2;
  return {light:light.id,shot:shot.id,distance,range:Number.isFinite(range)?range:null,rangeWeight,inRange:distance<range,coneDegrees,
   inCone:coneDegrees===null||coneDegrees<=(light.outerConeDeg??30),occlusion:'unmeasured',authority:'authored-values-preserved'};
 }));
 const hotspots=state.post.planarReflections.flatMap(plane=>state.lights.filter(l=>l.kind==='spot'||l.kind==='point').flatMap(light=>spec.shots.flatMap(shot=>{
  const projected=mirrorProjection(shot,light.position!,plane.height);return projected?[{light:light.id,shot:shot.id,plane:plane.object,...projected,occlusion:'unmeasured',kind:'potential-punctual-specular-hotspot'}]:[];
 })));
 return {version:'spec-optics-audit-v1',state:state.id,policy:'audit conflicts; never rewrite frozen spec',materials,coverage,hotspots,
  volume:state.post.volumetric?{...volumeLightSelection(state),extinction:state.post.volumetric.extinction,anisotropy:state.post.volumetric.anisotropy,
   scope:'authored medium and selected lights, not GPU scattering proof'}:null,
  conflicts:[...coverage.filter(x=>!x.inRange).map(x=>({code:'LIGHT_TARGET_OUT_OF_RANGE',light:x.light,shot:x.shot})),
   ...hotspots.filter(x=>x.inFrame).map(x=>({code:'POTENTIAL_MIRROR_HOTSPOT',light:x.light,shot:x.shot}))]};
}
