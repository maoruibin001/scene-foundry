import {test,expect} from 'bun:test';
import {degeneratePrimaryUv,bindWorldSurfaceVariants} from './surface-mapping';
import {transformedOpticalMesh,surfaceClearance,placeReflectionProbe,boundSpotIlluminance,type OpticalMesh} from './optical-export';
import {sampleSpec} from './fixtures';import {emitSpecWorld} from './world-emitter';
import {Materials} from '@forgeax/engine/render';
test('zero UV slots derive world variants without editing geometry or valid UV users',()=>{
 const pos=new Float32Array([0,0,0,1,0,0,0,0,1]),zero={attributes:{position:pos,uv:new Float32Array(6)}},valid={attributes:{uv:new Float32Array([0,0,1,0,0,1])}},a={key:'a',slots:{shell:'metal'}},b={key:'b',slots:{shell:'metal'}},materials:any[]=[{key:'metal',options:{baseColor:[.3,.3,.3,1],metallic:.5,roughness:.4},surface:{pattern:'panel',tilesPerMeter:.25}}];
 const bytes=Buffer.from(pos.buffer).toString('hex');expect(degeneratePrimaryUv(zero)).toBe(true);expect(degeneratePrimaryUv(valid)).toBe(false);
 const audit=bindWorldSurfaceVariants([a,b],materials,m=>m===a?zero:valid);expect(a.slots.shell).toBe('metal-world-surface');expect(b.slots.shell).toBe('metal');expect(audit).toHaveLength(1);expect(Buffer.from(pos.buffer).toString('hex')).toBe(bytes);
 const built=Materials.standard(materials[1].options as any);expect((built as any).values.triplanarSpace).toBe(1);expect((built as any).values.triplanarScale).toBe(.25);
});
const plane:OpticalMesh={id:'floor',positions:new Float32Array([-10,0,-10,10,0,-10,0,0,10]),indices:new Uint16Array([0,1,2]),min:[-10,0,-10],max:[10,0,10]};
test('triangle clearance and probe placement respect rotations and real empty room volume',()=>{
 expect(surfaceClearance([0,3,0],[plane]).clearanceMeters).toBe(3);
 const p=placeReflectionProbe([[0,.1,0],[0,3,0]],[plane]);expect(p.position).toEqual([0,3,0]);expect(p.clearanceMeters).toBe(3);expect(()=>placeReflectionProbe([[0,.1,0]],[plane])).toThrow('CLEARANCE');
 const mesh=transformedOpticalMesh({id:'p',pos:[0,2,0],quat:[0,0,0,1],scale:[1,1,1]},{attributes:{position:plane.positions},indices:plane.indices});expect(surfaceClearance([0,3,0],[mesh]).clearanceMeters).toBe(1);expect(plane.positions[1]).toBe(0);
});
test('closest target receiver protects its upper surface, without dimming unrelated or already safe lights',()=>{
 const spec=sampleSpec(),light:any={...spec.lighting.states[0].lights[0],kind:'spot',position:[0,0,70],direction:[0,0,-1],range:120,outerConeDeg:25,intensity:253920};
 const receiver={...plane,id:'body',min:[-10,10,-10],max:[10,46,10]} as OpticalMesh,room={...plane,id:'room',min:[-100,-40,-100],max:[100,80,100]} as OpticalMesh;
 const r=boundSpotIlluminance(light,[0,0,24],[room,receiver]);expect(r.audit.receiver).toBe('body');expect(r.audit.nearestReceiverDistance).toBe(24);expect(r.light.intensity).toBe(220*24*24);expect(light.intensity).toBe(253920);expect(r.audit.unoccludedLuxAfter).toBe(220);
 expect(boundSpotIlluminance({...light,intensity:100},[0,0,24],[receiver]).light.intensity).toBe(100);
});
test('giant vertical range stays admitted, SSR is clamped, static probe opt-out preserved, requested spec immutable',()=>{
 const s=sampleSpec();s.bounds={min:[-40,-40,-40],max:[40,40,80]};const st=s.lighting.states[0];st.post.ssr={maxDistance:60,thickness:1,maxRoughness:.5};st.lights=[{...st.lights[0],kind:'spot',position:[0,0,70],direction:[0,0,-1],range:115,intensity:500,castShadow:true}];
 const before=JSON.stringify(s),w=emitSpecWorld(s,{worldPackageId:'60fb39fb-420e-4aa5-8189-fd9c4d8369e7',opticalMeshes:[plane]});expect((w.entities.light_key as any).components.SpotLight).toMatchObject({range:115,mapSize:1024,nearPlane:.25});expect((w.entities.camera as any).components.ScreenSpaceReflection.maxRoughness).toBe(.28);expect(w.entities.environmentProbe).toBeDefined();expect(w.opticalAudit.probePlacement.clearanceMeters).toBeGreaterThan(.25);expect(JSON.stringify(s)).toBe(before);
 st.post.reflectionProbe=null;expect(emitSpecWorld(s,{worldPackageId:'60fb39fb-420e-4aa5-8189-fd9c4d8369e7',opticalMeshes:[plane]}).entities.environmentProbe).toBeUndefined();
});
