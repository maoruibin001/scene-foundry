import {test,expect} from 'bun:test';
import {compileNormalScale,opticsQuality,volumeLightSelection,mirrorProjection,inspectSceneOptics} from './optics';
import {sampleSpec} from './fixtures';
import {materialOptions} from './export-pack';
import {sceneSpecErrors} from './schema';
import {DEFAULT_STANDARD_PROFILE,validateRenderProfile} from '@forgeax/engine/render';
import {emitSpecWorld,volumetricFogPlugin,planarReflectionPlugin} from './world-emitter';

test('generated near-horizontal normals are bounded, explicit strength and input bytes preserved',()=>{
 const pixels=new Uint8Array([255,128,129,255,128,128,255,255]),copy=pixels.slice();
 const limited=compileNormalScale(pixels,.12,.2,false);expect(limited.maxTiltDegrees).toBeCloseTo(8,8);expect(limited.effective).toBeLessThan(.12);
 expect(compileNormalScale(pixels,.12,.2,true).effective).toBe(.12);expect(pixels).toEqual(copy);
 expect(compileNormalScale(new Uint8Array([128,128,255,255]),.1,.2,false).effective).toBe(.1);
});
test('output quality is bounded and follows aspect; no scene IDs or fixed 640 image',()=>{
 expect(opticsQuality().planar).toMatchObject({width:1280,height:720});
 expect(validateRenderProfile({...DEFAULT_STANDARD_PROFILE,volumetricFog:opticsQuality().volumetricFog})).toBeNull();
 expect(opticsQuality(800,800).planar).toMatchObject({width:640,height:640});
 expect(opticsQuality(8000,8000).planar.width).toBeLessThanOrEqual(1280);
 expect(()=>opticsQuality(NaN,900)).toThrow();expect(()=>opticsQuality(0,900)).toThrow();
 expect(planarReflectionPlugin({object:'arbitrary',height:2,distortion:0})).toContain('width:1280,height:720');
 const s=sampleSpec();s.lighting.states[0]!.post.planarReflections=[{object:s.objects[0]!.id,height:0,distortion:0}];
 const world=emitSpecWorld(s,{worldPackageId:'60fb39fb-420e-4aa5-8189-fd9c4d8369e7',outputFrame:{width:800,height:800}});
 expect(world.views[0].frame).toEqual({width:800,height:800});expect(world.planarPlugin).toContain('width:640,height:640');
});
test('absorption preserves author color/distance, rejects incomplete or opaque contracts',()=>{
 const s=sampleSpec(),m={...s.materials[0]!,transmission:.9,attenuationColor:[.2,.5,.8] as [number,number,number],attenuationDistance:3};
 expect(materialOptions(m)).toMatchObject({attenuationColor:[.2,.5,.8],attenuationDistance:3});
 s.materials[0]=m;expect(sceneSpecErrors(s)).toEqual([]);
 delete s.materials[0]!.attenuationDistance;expect(sceneSpecErrors(s).some(x=>x.includes('吸收需要'))).toBe(true);
});
test('single medium supports fixed Engine Point+Spot without duplicated extinction; unsupported mixed sets fail',()=>{
 const st:any={lights:[{id:'arbitrary-a',kind:'point'},{id:'arbitrary-b',kind:'spot'},{id:'sun',kind:'directional'}],post:{fog:{light:'sun'},volumetric:{lights:['arbitrary-b','arbitrary-a']}}};
 expect(volumeLightSelection(st)).toMatchObject({light:'arbitrary-a',spotLight:'arbitrary-b',densityOwners:1});
 for(const ids of [[],['sun','arbitrary-a'],['arbitrary-a','arbitrary-a'],['missing']]){st.post.volumetric.lights=ids;expect(()=>volumeLightSelection(st)).toThrow();}
 delete st.post.volumetric.lights;expect(volumeLightSelection(st).light).toBe('sun');
 const src=volumetricFogPlugin({lightKey:'point',spotLightKey:'spot',boundsMin:[0,0,0],boundsMax:[10,10,10],extinction:.01,albedo:[1,1,1],anisotropy:0,heightFalloff:0,noise:0,maxDistance:20});
 expect(src.match(/component:VolumetricFog/g)).toHaveLength(1);expect(src).toContain('data:{light,spotLight,');
});
test('generic mirror projection and coverage expose conflicts without rewriting spec',()=>{
 const shot={id:'view',label:'view',position:[0,-10,2] as [number,number,number],target:[0,0,0] as [number,number,number],fovDeg:60};
 const projection=mirrorProjection(shot,[0,10,2],0)!;expect(projection.pixel[0]).toBeCloseTo(800);expect(projection.receiver).toEqual([0,0,0]);
 const s=sampleSpec();s.shots=[shot];s.lighting.states[0]!.lights=[{id:'any-id',kind:'point',position:[0,10,2],range:1,intensity:20} as any];
 const before=JSON.stringify(s),audit=inspectSceneOptics(s,[]);expect(audit.conflicts.some(x=>x.code==='LIGHT_TARGET_OUT_OF_RANGE')).toBe(true);expect(JSON.stringify(s)).toBe(before);
});
