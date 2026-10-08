import {test,expect} from 'bun:test';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {validateReflectionProbes,reflectionProbeEntities,bindReflectionProbes,reflectionProbeSchema} from './reflection-probes';
import {reflectionFramesSettled,waitForReflections} from './reflection-ready.mjs';
import {bindCameraOutput} from './camera-output';
import {validateLighting,lightingSchema,LIGHTING_RULES} from './lighting';
import {prepareGeometryProject} from './prepare';
const p={position:[1,7,3],halfExtents:[8,15,5],intensity:.7,resolution:64 as const};
const world=readFileSync(resolve(import.meta.dirname,'../../../prototype/game/assets/world.pack.ts'),'utf8');
test('未声明时旧导出逐字不变；显式静态探针绑定固定公开组件和常量',()=>{
 for(const v of [undefined,null,[]])expect(bindReflectionProbes(world,v)).toBe(world);
 const out=bindReflectionProbes(world,[p]);expect(out).toContain('ReflectionProbe,Name,Transform]');expect(out).toContain('"updateIntent":REFLECTION_PROBE_UPDATE_ONCE');expect(out).toContain('"boxProjection":true');
 expect(reflectionProbeEntities([p]).localReflection0.components.Transform.pos).toEqual([1,3,-7]);expect(reflectionProbeEntities([p]).localReflection0.components.ReflectionProbe.halfExtents).toEqual([8,5,15]);
});
test('相机输出、局部灯和探针可组合；模板漂移不可静默遗漏',()=>{
 const withCamera=bindCameraOutput(world.replace('far:160','far:1000'),{antialias:'msaa',tonemap:'neutral',exposure:1});
 expect(bindReflectionProbes(withCamera,[p])).toContain('ANTIALIAS_MSAA');expect(bindReflectionProbes(withCamera,[p])).toContain('REFLECTION_PROBE_UPDATE_ONCE');
 for(const broken of [world.replace('perspective }','perspective as p }'),world.replace('Name,Transform]','Name]'),world.replace('ambient:{components:','ambientLight:{components:')])expect(()=>bindReflectionProbes(broken,[p])).toThrow('契约变化');
});
test('拒绝无效、无限、负尺寸、不支持分辨率和无界数量；schema与实际校验一致',()=>{
 for(const bad of [{},[null],[{...p,resolution:256}],[{...p,intensity:NaN}],[{...p,intensity:2.01}],[{...p,halfExtents:[-8,15,5]}],[{...p,position:[0,Infinity,0]}],[{...p,updateIntent:2}],[p,p,p]])expect(()=>validateReflectionProbes(bad)).toThrow('参数无效');
 for(const good of [null,[],[p],[p,{...p,resolution:128,intensity:0}]])expect(()=>validateReflectionProbes(good)).not.toThrow();
 expect(lightingSchema().properties.reflectionProbes).toEqual(reflectionProbeSchema());expect(LIGHTING_RULES).toContain('不会新增光源');
});
test('等待引擎完成帧而非固定延时；旧场景不增加等待；缺失帧不伪造就绪',async()=>{
 expect(reflectionFramesSettled(65,5,1)).toBe(true);expect(reflectionFramesSettled(64,5,1)).toBe(false);expect(reflectionFramesSettled(65,5,2)).toBe(false);expect(reflectionFramesSettled(NaN,5,1)).toBe(false);
 let reads=0;const result=await waitForReflections({evaluate:()=>++reads===1?5:65,waitForTimeout:async()=>{}},{reflectionProbeCount:1});expect(result.endFrame).toBe(65);expect(result.probeStateInspected).toBe(false);
 await waitForReflections({evaluate:()=>{throw Error('旧场景不得增加检查')}},{});
 const frames=[NaN,NaN,5,65];const delayed=await waitForReflections({evaluate:()=>frames.shift(),waitForTimeout:async()=>{}},{reflectionProbeCount:1});expect(delayed.startFrame).toBe(5);expect(delayed.endFrame).toBe(65);
});
test('真实prepare导出审计，不引入跨线程renderer依赖，不改输入数据或旧场景相机',()=>{
 const transform={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},lighting={direction:[0,0,-1],color:[1,1,1],intensity:1,ambientColor:[1,1,1],ambientIntensity:.2,points:[],reflectionProbes:[p]};
 const scene:any={version:'scene-v1',program:{version:'geometry-v1',name:'静态反射契约',materials:[{id:'m',color:[.5,.5,.5,1],roughness:.4,metallic:0,textureId:null}],templates:[{id:'t',parts:[{...transform,id:'p',material:'m',shape:{type:'box',size:[1,1,1],radius:0}}]}],instances:[{...transform,id:'i',label:'立体',template:'t',requirementIds:[]}]},cameras:[{name:'主',referenceIndex:1,position:[3,-5,2],target:[0,0,0],fov:1}],entities:[{instanceId:'i',role:'subject',category:'立体'}],lighting,textures:[],assumptions:[]};
 const before=JSON.stringify(scene),root=mkdtempSync(join(tmpdir(),'local-reflection-'));try{
  validateLighting(lighting);prepareGeometryProject(root,scene.program,{}, {id:'fixture',summary:'导出测试',scene,provenance:{test:true}});expect(JSON.stringify(scene)).toBe(before);
  expect(readFileSync(join(root,'game/assets/world.pack.ts'),'utf8')).toContain('localReflection0');
  const controller=readFileSync(join(root,'game/assets/camera.plugin.ts'),'utf8');expect(controller).toContain("inject:['world','gameHost']");expect(controller).not.toContain('ctx.renderer');
  expect(JSON.parse(readFileSync(join(root,'game/assets/scene-audit.json'),'utf8')).reflectionProbeCount).toBe(1);
  expect(JSON.parse(readFileSync(join(root,'reflection-probe-export.json'),'utf8')).authored).toEqual([p]);
  const config=JSON.parse(readFileSync(join(root,'game/forge.json'),'utf8'));expect(config.plugins[0]).toEqual({id:'reflection-components',name:'./assets/reflection-components.plugin.ts',realm:'engine',inject:[]});
  expect(readFileSync(join(root,'game/assets/reflection-components.plugin.ts'),'utf8')).toContain('ctx.world.components.register(ReflectionProbe)');
  delete scene.lighting.reflectionProbes;prepareGeometryProject(root,scene.program,{}, {id:'fixture',summary:'旧导出',scene,provenance:{test:true}});
  expect(readFileSync(join(root,'game/assets/world.pack.ts'),'utf8')).not.toContain('ReflectionProbe');expect(readFileSync(join(root,'game/assets/camera.plugin.ts'),'utf8')).not.toContain('ctx.renderer');
 }finally{rmSync(root,{recursive:true,force:true});}
});
