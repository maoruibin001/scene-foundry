import {test,expect} from 'bun:test';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateScene,sceneSchema,semanticCounts,type SceneInput} from './scene-contract';
import {compileGeometryProgram} from './program';
import {prepareGeometryProject} from './prepare';
import {sceneComplexity} from './run';
import {analyzeSceneRun} from './runtime-metrics.mjs';
const pose={position:[0,0,0] as [number,number,number],rotation:[0,0,0] as [number,number,number],scale:[1,1,1] as [number,number,number]};
const plan={requirements:[{id:'shape',critical:true,count:null}]};
const scene=():SceneInput=>({version:'scene-v1',program:{version:'geometry-v1',name:'任意形状验证',materials:[{id:'surface',color:[1,1,1,1],roughness:.7,metallic:0,textureId:'patch'}],templates:[{id:'novel',parts:[{...pose,id:'solid',material:'surface',uvScale:[3,2],shape:{type:'box',size:[2,1,2],radius:.1}}]}],instances:[{...pose,id:'one',label:'未知类别物体',template:'novel',requirementIds:['shape']}]},entities:[{instanceId:'one',role:'subject',category:'new_shape'}],cameras:[{name:'参考机位',referenceIndex:1,position:[4,-6,3],target:[0,0,0],fov:1},{name:'检查机位',referenceIndex:null,position:[-4,6,3],target:[0,0,0],fov:1}],textures:[{id:'patch',referenceIndex:1,quad:[[.2,.2],[.4,.2],[.4,.4],[.2,.4]],size:256,description:'当前图片的表面'}],lighting:{direction:[-.3,.5,-.8],color:[1,.9,.8],intensity:2,ambientColor:[.8,.9,1],ambientIntensity:.4,points:[{position:[0,0,4],color:[1,1,1],intensity:1,range:5}]},assumptions:['背面为推断']});
test('中文语义类别通过同一契约，计数不依赖英文命名或对象原型',()=>{
 const schema=sceneSchema().properties.entities.items.properties.category;
 for(const category of ['曲面采光构件','旋转展示台','new_shape','constructor','__proto__']){
  const s=scene();s.entities[0].category=category;
  expect(new RegExp(schema.pattern).test(category)).toBe(true);
  expect(validateScene(s,plan,1).entities[0].category).toBe(category);
 }
 for(const category of ['', '   ',' 前导空格','尾随空格 ','控制\n字符','分类\u0000','长'.repeat(57)]){
  const s=scene();s.entities[0].category=category;
  expect(new RegExp(schema.pattern).test(category)).toBe(false);
  expect(()=>validateScene(s,plan,1)).toThrow('实体分类无效');
 }
 const counts=JSON.parse(JSON.stringify(semanticCounts(['曲面采光构件','曲面采光构件','constructor','__proto__'].map(category=>({category})))));
 expect(counts['曲面采光构件']).toBe(2);expect(counts.constructor).toBe(1);expect(counts.__proto__).toBe(1);
});
test('任意类别场景保留所有参考机位，缺失需求与来源不能通过',()=>{
 expect(validateScene(scene(),plan,1)).toBeTruthy();let s=scene();s.cameras[0].referenceIndex=null;expect(()=>validateScene(s,plan,1)).toThrow('参考图');
 s=scene();s.program.instances[0].requirementIds=[];expect(()=>validateScene(s,plan,1)).toThrow('关键需求');
 s=scene();s.textures[0].referenceIndex=2;expect(()=>validateScene(s,plan,1)).toThrow('引用');
 s=scene();s.textures[0].quad=[[0,0],[1,0],[1,1],[0,1]];expect(()=>validateScene(s,plan,1)).toThrow('整幅场景');
 s=scene();s.textures[0].quad=[[.1,.1],[.4,.4],[.4,.1],[.1,.4]];expect(()=>validateScene(s,plan,1)).toThrow('四角顺序');
 expect(sceneSchema().properties.program.properties.templates.items.properties.parts.items.properties).toHaveProperty('uvScale');
 expect(sceneComplexity(scene(),'complex',1).passed).toBe(false);
});
test('三维几何使用本任务纹理且 UV 尺度生效，导出相机光照来自输入',()=>{
 const s=scene(),texture={width:1,height:1,rgba8:Buffer.from([70,120,160,255]).toString('base64'),colorSpace:'srgb' as const},registry={patch:texture};
 const a=compileGeometryProgram(s.program,registry),base=structuredClone(s.program);delete base.templates[0].parts[0].uvScale;const b=compileGeometryProgram(base,registry);
 expect(a.meshes[0].geometry.uvs).toEqual(b.meshes[0].geometry.uvs.map((n:number,k:number)=>n*(k%2?2:3)));
 const root=mkdtempSync(join(tmpdir(),'scene-contract-'));
 try{const prepared=prepareGeometryProject(root,s.program,registry,{id:'fixture',summary:'只验证数据导出',scene:s,provenance:{test:true}}),audit=JSON.parse(readFileSync(join(root,'game/assets/scene-audit.json'),'utf8'));
  expect(audit.views[0].position).toEqual([4,3,6]);expect(audit.views[1].position).toEqual([-4,3,-6]);expect(audit.landmarks[0].role).toBe('subject');
  expect(audit.views[0].cruise.status).toBe('ready');expect(audit.views[0].cruise.origin).toEqual(audit.views[0].position);
  expect(readFileSync(join(root,'game/assets/world.pack.ts'),'utf8')).toContain('pos:[0,4,0]');
  expect(readFileSync(join(root,'game/assets/camera.plugin.ts'),'utf8')).toContain('audit.views.length');
  expect(prepareGeometryProject(root,s.program,registry,{id:'fixture',summary:'只验证数据导出',scene:s,provenance:{test:true}}).brief.packageId).toBe(prepared.brief.packageId);
 }finally{rmSync(root,{recursive:true,force:true})}
});
test('连续采集的真实位置离开已验证路径时运动硬检查失败',()=>{
 const cruise={status:'ready',origin:[0,1,5],displacement:[.5,0,0]};
 const audit={views:[{cruise}],parts:[{id:'a'}],landmarks:[{id:'a',role:'subject',position:[0,1,0],size:[3,3,3]},{id:'b',role:'context',position:[0,1,-4],size:[1,1,1]}]};
 const samples=Array.from({length:7},(_,i)=>({name:'frame'+i,kind:i===0?'view':'continuous',selectedView:0,position:[i===0?0:.1*(i-1),1,5],target:[0,1,0],fov:1,at:i*1000,frames:i*60,frameTimes:Array(180).fill(1000/60),parts:[{id:'a',loaded:true}],ambiguousSource:false}));
 expect(analyzeSceneRun(samples,audit).cameraEvidence.tourClearance.status).toBe('verified');
 samples.at(-1)!.position=[.5,1,5.1];const outside=analyzeSceneRun(samples,audit);expect(outside.hard.cameraMotion).toBe(false);expect(outside.cameraEvidence.tourClearance.status).toBe('failed');
});
test('未加载网格和静止相机不能被多机位截图冒充运行通过',()=>{
 const audit={views:[{},{}],parts:[{id:'a'}],landmarks:[{id:'a',role:'subject',position:[0,1,0],size:[3,3,3]},{id:'b',role:'context',position:[0,1,-4],size:[1,1,1]}]};
 const samples=Array.from({length:8},(_,i)=>({name:'frame'+i,kind:i<2?'view':'continuous',selectedView:i<2?i:0,position:[i<2?i:.1*(i-2),1,5],target:[0,1,0],fov:1,at:i*1000,frames:i*60,frameTimes:Array(180).fill(1000/60),parts:[{id:'a',loaded:true}],ambiguousSource:false}));
 expect(Object.values(analyzeSceneRun(samples,audit).hard).every(Boolean)).toBe(true);
 samples[5].parts[0].loaded=false;expect(analyzeSceneRun(samples,audit).hard.entitiesLoaded).toBe(false);
 for(const s of samples)s.position=[0,1,5];expect(analyzeSceneRun(samples,audit).hard.cameraMotion).toBe(false);
});
