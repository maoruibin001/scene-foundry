import {test,expect} from 'bun:test';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {bindPointShadows,validatePointShadows,pointShadowSchema} from './point-shadows';
import {validateLighting,lightingSchema} from './lighting';
import {prepareGeometryProject} from './prepare';
import {bindReflectionProbes} from './reflection-probes';
import {bindCameraOutput} from './camera-output';
const point={position:[2,3,4],color:[1,.8,.6],intensity:21,range:10.5},shadow={normalBias:.0002,depthBias:.00001};
const world="import { Camera, PointLight, perspective } from '@forgeax/engine/render';\nsceneComponents:[Camera,PointLight,Name,Transform],Camera:{...perspective({far:1000}),clearColor:[0,0,0,1]},localLight0:{components:{Transform:{pos:[2,4,-3]},PointLight:{\"color\":[1,0.8,0.6],\"intensity\":21,\"range\":10.5}}},ambient:{components:{}}";
test('未指定和null保持旧世界逐字一致；开启保留原灯位、强度与其他字段',()=>{
 for(const p of [point,{...point,shadow:null}])expect(bindPointShadows(world,[p])).toBe(world);
 const out=bindPointShadows(world,[{...point,shadow}]);expect(out).toContain('PointLightShadow,Name,Transform]');expect(out).toContain('"normalBias":0.0002');expect(out).toContain('"depthBias":0.00001');expect(out).toContain('"farPlane":10.5');expect(out).toContain('"mapSize":512');expect(out).toContain('"intensity":21');expect(out).toContain('pos:[2,4,-3]');expect(out.match(/PointLightShadow:/g)).toHaveLength(1);
});
test('无效字段与容量在编译前失败，远平面必须超过固定近面',()=>{
 for(const s of [{},[],true,1,{...shadow,normalBias:NaN},{...shadow,normalBias:Infinity},{...shadow,normalBias:-1},{...shadow,normalBias:.051},{...shadow,depthBias:-1},{...shadow,depthBias:.006},{...shadow,depthBias:'0'},{...shadow,mapSize:8192}])expect(()=>validatePointShadows([{...point,shadow:s as any}])).toThrow('参数无效');
 expect(()=>validatePointShadows([{...point,range:.1,shadow}])).toThrow('参数无效');expect(()=>validatePointShadows(Array.from({length:3},()=>({...point,shadow})))).toThrow('数量超限');
 expect(()=>validatePointShadows([{...point,shadow:{normalBias:0,depthBias:0}},{...point,shadow:{normalBias:.05,depthBias:.005}}])).not.toThrow();
});
test('灯光共享schema和实际校验覆盖新增能力，老range下限不受影响',()=>{
 const lighting={direction:[0,0,-1],color:[1,1,1],intensity:1,ambientColor:[1,1,1],ambientIntensity:.2,points:[{...point,range:.1}]};
 expect(validateLighting(lighting)).toBe(lighting);expect(lightingSchema().properties.points.items.properties.shadow).toEqual(pointShadowSchema());
 expect(()=>validateLighting({...lighting,points:[{...point,range:.1,shadow}]})).toThrow('点光阴影');
});
test('导出锚点漂移或重复不可静默丢弃请求',()=>{
 for(const s of [world.replace('localLight0:','missing:'),world.replace('Name,Transform]','Name]'),world.replace('PointLight, perspective','perspective'),world+world])expect(()=>bindPointShadows(s,[{...point,shadow}])).toThrow('契约变化');
});
test('相机输出、局部反射、点光阴影可在同一个正常世界组合',()=>{
 let out=bindPointShadows(world,[{...point,shadow}]);out=bindCameraOutput(out,{antialias:'msaa',tonemap:'neutral',exposure:1});out=bindReflectionProbes(out,[{position:[0,0,2],halfExtents:[5,5,3],intensity:.4,resolution:64}]);
 expect(out).toContain('PointLightShadow');expect(out).toContain('ReflectionProbe');expect(out).toContain('ANTIALIAS_MSAA');expect(out).toContain('REFLECTION_PROBE_UPDATE_ONCE');
});
test('实际prepare贯通带点光阴影、相机和反射的完整正常导出；输入及旧世界不变',()=>{
 const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},scene:any={version:'scene-v1',program:{version:'geometry-v1',name:'点光遮挡',materials:[{id:'m',color:[.5,.5,.5,1],roughness:.6,metallic:0,textureId:null}],templates:[{id:'t',parts:[{...pose,id:'p',material:'m',shape:{type:'box',size:[1,1,1],radius:0}}]}],instances:[{...pose,id:'i',label:'立体',template:'t',requirementIds:[]}]},cameras:[{name:'主',referenceIndex:1,position:[3,-5,2],target:[0,0,0],fov:1}],entities:[{instanceId:'i',role:'subject',category:'立体'}],lighting:{direction:[0,0,-1],color:[1,1,1],intensity:1,ambientColor:[1,1,1],ambientIntensity:.2,points:[point],spots:[],cameraOutput:{antialias:'msaa',tonemap:'neutral',exposure:1},reflectionProbes:[{position:[0,0,2],halfExtents:[5,5,3],intensity:.4,resolution:64}]},textures:[],assumptions:[]};
 const root=mkdtempSync(join(tmpdir(),'point-shadow-')),options=()=>({id:'fixture',summary:'导出',scene,provenance:{test:true}});
 try{
  prepareGeometryProject(root,scene.program,{},options());const legacy=readFileSync(join(root,'game/assets/world.pack.ts'),'utf8');
  scene.lighting.points=[{...point,shadow:null}];prepareGeometryProject(root,scene.program,{},options());expect(readFileSync(join(root,'game/assets/world.pack.ts'),'utf8')).toBe(legacy);
  scene.lighting.points=[{...point,shadow}];const input=JSON.stringify(scene);prepareGeometryProject(root,scene.program,{},options());expect(JSON.stringify(scene)).toBe(input);
  const built=readFileSync(join(root,'game/assets/world.pack.ts'),'utf8');expect(built).toContain('PointLightShadow');expect(built).toContain('localReflection0');expect(built).toContain('ANTIALIAS_MSAA');expect(JSON.parse(readFileSync(join(root,'point-shadow-export.json'),'utf8')).authored).toEqual([shadow]);
 }finally{rmSync(root,{recursive:true,force:true});}
});
