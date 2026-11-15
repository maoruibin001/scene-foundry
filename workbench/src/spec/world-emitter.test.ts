import {test,expect} from 'bun:test';
import {FogModeValue} from '@forgeax/engine/render';
import {buildFogComponent,emitSpecWorld} from './world-emitter';
import {planSpecExport} from './export-pack';
import {sampleSpec} from './fixtures';

test('世界导出:灯光按类型成组件、后处理挂在相机、平面反射走插件且只取一个平面',()=>{
 const s=sampleSpec(),st=s.lighting.states[0];
 st.lights.push({id:'spot-a',kind:'spot',position:[0,-12,16],direction:[0,0.6,-0.5],color:[1,1,1],intensity:500,range:60,innerConeDeg:10,outerConeDeg:20,width:null,height:null,castShadow:true});
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
 expect(w.deferred.map(d=>d.feature)).toEqual(['PlanarReflection:CORE_001','LightRange:spot-a']);
 expect(w.views[0].position).toEqual([0,1.65,25]);
});

test('平面反射所属族的光滑材质烘焙 planarReflection,其它材质不受影响',()=>{
 const s=sampleSpec();s.materials.push({...s.materials[0],id:'mirror',roughness:0.05});s.families[0].materialSlots={shell:'mirror'};
 s.lighting.states[0].post.planarReflections=[{object:'CORE_001',height:0,distortion:0}];
 const m=planSpecExport(s).materials;
 expect(m.find(x=>x.key==='mirror')!.options).toMatchObject({planarReflection:true});
 expect(m.find(x=>x.key==='steel')!.options).not.toHaveProperty('planarReflection');
});

test('Fog 导出固定 FogModeValue.exp 并钳制非法范围(杜绝 near >= far 或越界透明度)',()=>{
 const s=sampleSpec(),st=s.lighting.states[0]!;
 st.post.fog={color:[0.12,0.16,0.22],density:0.03,anisotropy:0.2,boundsMin:[-20,-20,0],boundsMax:[20,20,18],light:st.lights[0]!.id};
 const w=emitSpecWorld(s,{worldPackageId:'60fb39fb-420e-4aa5-8189-fd9c4d8369e7'});
 expect(w.components).toContain('Fog');
 const fog=(w.entities.fog as any).components.Fog;
 expect(fog.mode).toBe(FogModeValue.exp);
 expect(fog.heightFalloff).toBeGreaterThanOrEqual(0);
 expect(fog.maxOpacity).toBeGreaterThanOrEqual(0);
 expect(fog.maxOpacity).toBeLessThanOrEqual(1);
 expect(fog.near).toBeLessThan(fog.far);

 const clamped=buildFogComponent({color:[-0.5,Number.NaN,1.4] as any,density:-0.2,anisotropy:0,boundsMin:[-1,-1,-1],boundsMax:[1,1,1],light:'k',heightFalloff:-2,maxOpacity:3.5,near:500,far:100});
 expect(clamped.mode).toBe(FogModeValue.exp);
 expect(clamped.color).toEqual([0,0,1.4]);
 expect(clamped.density).toBe(0);
 expect(clamped.heightFalloff).toBe(0);
 expect(clamped.maxOpacity).toBe(1);
 expect(clamped.near).toBe(500);
 expect(clamped.far).toBeGreaterThan(clamped.near);
});

test('Skylight 半球反弹 groundColor 导出与巨构大空间自适应射程/阴影预算',()=>{
 // 1) 小包络场景(跨度 26m):默认按比例推导非黑 groundColor,射程上限保持 24m
 const small=sampleSpec();
 small.bounds={min:[-12,-13,-2],max:[12,13,18]};
 small.lighting.states[0]!.ambient={color:[0.6,0.75,0.95],intensity:0.55};
 small.lighting.states[0]!.lights.push({id:'spot_small',kind:'spot',position:[0,0,14],direction:[0,0,-1],color:[1,1,1],intensity:100,range:30,innerConeDeg:10,outerConeDeg:20,width:null,height:null,castShadow:false});
 const wSmall=emitSpecWorld(small,{worldPackageId:'60fb39fb-420e-4aa5-8189-fd9c4d8369e7'});
 const skySmall=(wSmall.entities.ambient as any).components.Skylight;
 expect(skySmall.groundColor).toEqual([0.252,0.345,0.513]);
 expect((wSmall.entities.light_spot_small as any).components.SpotLight.range).toBe(24);

 // 2) 巨构大厅(跨度 80m):显式 groundColor 透传,maxRange 扩展至 72m,shadowDistance 扩展至 120m(mapSize 2048),允许最多 2 盏聚光投影
 const large=sampleSpec();
 large.bounds={min:[-32,-40,-4],max:[32,40,28]}; // span = 80m -> maxRange = 72m, shadowDistance = 120m
 const st=large.lighting.states[0]!;
 st.ambient={color:[0.62,0.76,0.95],groundColor:[0.24,0.30,0.40],intensity:0.6};
 st.lights=[
  {id:'sun',kind:'directional',position:null,direction:[0.2,0.3,-0.9],color:[0.95,0.98,1],intensity:7,range:null,innerConeDeg:null,outerConeDeg:null,width:null,height:null,castShadow:true},
  {id:'core_shaft',kind:'spot',position:[0,0,24],direction:[0,0,-1],color:[0.2,0.82,1],intensity:900,range:52,innerConeDeg:18,outerConeDeg:34,width:null,height:null,castShadow:true},
  {id:'portal_back',kind:'spot',position:[0,36,12],direction:[0,-0.8,-0.4],color:[0.8,0.95,1],intensity:650,range:48,innerConeDeg:20,outerConeDeg:40,width:null,height:null,castShadow:true},
  {id:'extra_spot',kind:'spot',position:[14,0,10],direction:[-1,0,-0.5],color:[1,0.62,0.22],intensity:200,range:85,innerConeDeg:15,outerConeDeg:30,width:null,height:null,castShadow:true},
 ];
 const wLarge=emitSpecWorld(large,{worldPackageId:'60fb39fb-420e-4aa5-8189-fd9c4d8369e7'});
 expect((wLarge.entities.ambient as any).components.Skylight.groundColor).toEqual([0.24,0.30,0.40]);
 const dirComp=(wLarge.entities.light_sun as any).components.DirectionalLight;
 expect(dirComp.shadowDistance).toBe(120);
 expect(dirComp.mapSize).toBe(2048);
 // 52m 与 48m 聚光灯在 72m 上限内不被截断,且前 2 盏聚光保留投影
 expect((wLarge.entities.light_core_shaft as any).components.SpotLight).toMatchObject({range:52,castShadow:true});
 expect((wLarge.entities.light_portal_back as any).components.SpotLight).toMatchObject({range:48,castShadow:true});
 // 第 3 盏聚光投影被预算降级,且 85m 射程截到 72m
 expect((wLarge.entities.light_extra_spot as any).components.SpotLight).toMatchObject({range:72,castShadow:false});
 expect(wLarge.deferred.map(d=>d.feature)).toEqual(['LightRange:extra_spot','LightShadow:extra_spot']);
});
