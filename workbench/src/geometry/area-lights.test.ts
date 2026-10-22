import {test,expect} from 'bun:test';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {areaLightSchema,validateAreaLights,areaLightEntities,bindAreaLights} from './area-lights';
import {lightingSchema,validateLighting,LIGHTING_RULES} from './lighting';
import {bindReflectionProbes} from './reflection-probes';
import {bindCameraOutput} from './camera-output';
import {prepareGeometryProject} from './prepare';
const area=()=>({position:[1,7,3],direction:[0,0,-1],up:[0,1,0],color:[1,.8,.6],intensity:20,range:3,width:.3,height:.2});
const light=()=>({direction:[0,0,-1],color:[1,1,1],intensity:1,ambientColor:[1,1,1],ambientIntensity:.2,points:[]});
const world=readFileSync(resolve(import.meta.dirname,'../../../prototype/game/assets/world.pack.ts'),'utf8');
const rotate=(q:number[],v:number[])=>{const [x,y,z,w]=q,[a,b,c]=v;return [(1-2*y*y-2*z*z)*a+(2*x*y-2*z*w)*b+(2*x*z+2*y*w)*c,(2*x*y+2*z*w)*a+(1-2*x*x-2*z*z)*b+(2*y*z-2*x*w)*c,(2*x*z-2*y*w)*a+(2*y*z+2*x*w)*b+(1-2*x*x-2*y*y)*c];};
test('legacy absent/null/empty keeps world bytes and does not require a new component',()=>{
 for(const v of [undefined,null,[]])expect(bindAreaLights(world,v)).toBe(world);
 expect(()=>validateLighting(light())).not.toThrow();
 expect(lightingSchema().properties.areaLights).toEqual(areaLightSchema());
});
test('emitting +Z, up and position map to Engine for floor/wall/slanted sources',()=>{
 for(const [direction,up] of [[[0,0,-1],[0,1,0]],[[0,0,1],[0,-1,0]],[[1,0,0],[0,0,1]],[[-1,0,0],[0,0,1]],[[0,1,0],[0,0,1]],[[0,-1,0],[0,0,1]],[[.3,.4,-.5],[0,1,.2]]] as number[][][]){
  const p={...area(),direction,up},e=areaLightEntities([p]).areaLight0.components;
  expect(e.Transform.pos).toEqual([1,3,-7]);expect(Math.hypot(...e.Transform.quat)).toBeCloseTo(1,10);
  const emitted=rotate(e.Transform.quat,[0,0,1]),expected=[direction[0],direction[2],-direction[1]].map(x=>x/Math.hypot(...direction));
  emitted.forEach((v,i)=>expect(v).toBeCloseTo(expected[i],10));
  const vertical=rotate(e.Transform.quat,[0,1,0]),mappedUp=[up[0],up[2],-up[1]];
  expect(vertical.reduce((n,v,i)=>n+v*mappedUp[i],0)).toBeGreaterThan(0);
  expect(e.RectAreaLight).toEqual({color:p.color,intensity:20,width:.3,height:.2,range:3});
 }
});
test('rejects nonfinite, parallel axes, absent data, unsupported shadows and out-of-range values',()=>{
 for(const change of [{direction:[0,0,0]},{direction:[0,0,1],up:[0,0,-1]},{up:[0,0,0]},{intensity:NaN},{intensity:1001},{position:[0,Infinity,0]},{width:0},{height:21},{range:0},{color:[-1,0,0]},{castShadow:true},{constructor:1},{toString:1},{direction:undefined}])expect(()=>validateAreaLights([{...area(),...change}])).toThrow();
 for(const bad of [{},[null],Array.from({length:5},area)])expect(()=>validateAreaLights(bad)).toThrow();
 expect(()=>validateAreaLights([{...area(),intensity:0,width:20,height:.05}])).not.toThrow();
});
test('shared local-light budget requires replacing sources instead of increasing prior total',()=>{
 const point={position:[0,0,1],color:[1,1,1],intensity:2,range:3};
 const spot={...point,direction:[0,0,-1],innerConeDeg:10,outerConeDeg:60,castShadow:false};
 expect(()=>validateLighting({...light(),points:Array(16).fill(point),spots:Array(4).fill(spot),areaLights:[area()]})).toThrow('总数');
 expect(()=>validateLighting({...light(),points:Array(12).fill(point),spots:Array(4).fill(spot),areaLights:Array.from({length:4},area)})).not.toThrow();
 expect(LIGHTING_RULES).toContain('不同于点光坎德拉');expect(LIGHTING_RULES).toContain('不提供面光阴影');
});
test('export composes with reflection and camera settings and fails on template drift',()=>{
 const reflection={position:[0,4,3],halfExtents:[3,5,3],intensity:.5,resolution:64 as const};
 const a=bindAreaLights(bindReflectionProbes(bindCameraOutput(world,{antialias:'msaa',tonemap:'neutral',exposure:1}),[reflection]),[area()]);
 expect(a).toContain('RectAreaLight');expect(a).toContain('ANTIALIAS_SMAA');expect(a).toContain('REFLECTION_PROBE_UPDATE_ONCE');
 for(const broken of [world.replace('perspective }','perspective as p }'),world.replace('Name,Transform]','Name]'),world.replace('ambient:{components:','ambientLight:{components:')])expect(()=>bindAreaLights(broken,[area()])).toThrow('契约变化');
});
test('normal prepare exports authored emitter, no scene geometry or source data changes',()=>{
 const transform={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};
 const scene:any={version:'scene-v1',program:{version:'geometry-v1',name:'面光导出',materials:[{id:'m',color:[.5,.5,.5,1],roughness:.4,metallic:0,textureId:null}],templates:[{id:'t',parts:[{...transform,id:'p',material:'m',shape:{type:'box',size:[1,1,1],radius:0}}]}],instances:[{...transform,id:'i',label:'立体',template:'t',requirementIds:[]}]},cameras:[{name:'主',referenceIndex:1,position:[3,-5,2],target:[0,0,0],fov:1}],entities:[{instanceId:'i',role:'subject',category:'立体'}],lighting:{...light(),areaLights:[area()]},textures:[],assumptions:[]};
 const before=JSON.stringify(scene),root=mkdtempSync(join(tmpdir(),'scene-area-light-'));
 try{const output=prepareGeometryProject(root,scene.program,{}, {id:'fixture',summary:'面光契约',scene,provenance:{test:true}});expect(output.triangles).toBe(12);expect(JSON.stringify(scene)).toBe(before);
 const text=readFileSync(join(root,'game/assets/world.pack.ts'),'utf8');expect(text).toContain('RectAreaLight,Name,Transform]');expect(text).toContain('areaLight0');expect(text).not.toContain('ctx.renderer');
 const evidence=JSON.parse(readFileSync(join(root,'area-light-export.json'),'utf8'));expect(evidence.authored).toEqual([area()]);expect(evidence.entities.areaLight0.components.RectAreaLight.width).toBe(.3);
 // prepare binds area lights before camera output; the appended RectAreaLight symbol must not hide the camera's import.
 scene.lighting.cameraOutput={antialias:'msaa',tonemap:'neutral',exposure:1.2};prepareGeometryProject(root,scene.program,{}, {id:'fixture',summary:'面光与显示',scene,provenance:{test:true}});
 const both=readFileSync(join(root,'game/assets/world.pack.ts'),'utf8');expect(both).toContain('RectAreaLight,Name,Transform]');expect(both).toContain('antialias:ANTIALIAS_SMAA,tonemap:TONEMAP_NEUTRAL,exposure:1.2');expect(both.match(/import \{[^;\n]+ \} from '@forgeax\/engine\/render';/g)!.length).toBe(1);
 delete scene.lighting.cameraOutput;
 for(const value of [undefined,null,[]]){scene.lighting.areaLights=value;prepareGeometryProject(root,scene.program,{}, {id:'fixture',summary:'旧数据',scene,provenance:{test:true}});expect(readFileSync(join(root,'game/assets/world.pack.ts'),'utf8')).not.toContain('RectAreaLight');expect(()=>readFileSync(join(root,'area-light-export.json'))).toThrow();}
 }finally{rmSync(root,{recursive:true,force:true});}
});
