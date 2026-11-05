import {test,expect} from 'bun:test';
import {emitSpecWorld} from './world-emitter';
import {planSpecExport} from './export-pack';
import {sampleSpec} from './fixtures';

test('世界导出:灯光按类型成组件、后处理挂在相机、平面反射走插件且只取一个平面',()=>{
 const s=sampleSpec(),st=s.lighting.states[0];
 st.lights.push({id:'spot-a',kind:'spot',position:[0,-12,16],direction:[0,0.6,-0.5],color:[1,1,1],intensity:500,range:30,innerConeDeg:10,outerConeDeg:20,width:null,height:null,castShadow:true});
 st.lights.push({id:'panel',kind:'area',position:[0,0,18],direction:[0,0,-1],color:[1,1,1],intensity:5,range:20,innerConeDeg:null,outerConeDeg:null,width:4,height:4,castShadow:false});
 st.post.ssr={maxDistance:20,thickness:0.3,maxRoughness:0.4};
 st.post.planarReflections=[{object:'CORE_001',height:0,distortion:0.02},{object:'CORE_001',height:1,distortion:0}];
 const w=emitSpecWorld(s,{worldPackageId:'60fb39fb-420e-4aa5-8189-fd9c4d8369e7'});
 expect(w.components).toEqual(expect.arrayContaining(['AmbientOcclusion','DirectionalLight','RectAreaLight','ScreenSpaceReflection','SpotLight']));
 const cam=(w.entities.camera as any).components;
 expect(cam.Camera.tonemap).toBe(4);expect(cam.Camera.bloom).toBe(1);expect(cam.ScreenSpaceReflection.maxDistance).toBe(20);
 expect((w.entities['light_spot-a'.replace('-','_')] as any).components.Transform.pos).toEqual([0,16,12]);
 expect(w.planar).toEqual({object:'CORE_001',height:0,distortion:0.02});
 expect(w.planarPlugin).toContain("inject:['world','gameHost','executionBootstrapHost']");
 expect(w.deferred.map(d=>d.feature)).toEqual(['PlanarReflection:CORE_001']);
 expect(w.views[0].position).toEqual([0,1.65,25]);
});

test('平面反射所属族的光滑材质烘焙 planarReflection,其它材质不受影响',()=>{
 const s=sampleSpec();s.materials.push({...s.materials[0],id:'mirror',roughness:0.05});s.families[0].materialSlots={shell:'mirror'};
 s.lighting.states[0].post.planarReflections=[{object:'CORE_001',height:0,distortion:0}];
 const m=planSpecExport(s).materials;
 expect(m.find(x=>x.key==='mirror')!.options).toMatchObject({planarReflection:true});
 expect(m.find(x=>x.key==='steel')!.options).not.toHaveProperty('planarReflection');
});
