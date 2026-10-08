import {test,expect} from 'bun:test';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {bindCameraOutput,validateCameraOutput,cameraOutputSchema} from './camera-output';
import {lightingSchema,validateLighting} from './lighting';
import {prepareGeometryProject} from './prepare';
const world="import { Camera, perspective } from '@forgeax/engine/render';\nCamera:{...perspective({fov:1,near:.1,far:1000}),clearColor:[0,0,0,1]}";
const profile={antialias:'msaa' as const,tonemap:'neutral' as const,exposure:1};
test('历史场景显示保持逐字相同，新增档使用固定Engine公开常量而非猜测数值',()=>{
 expect(bindCameraOutput(world)).toBe(world);expect(bindCameraOutput(world,null)).toBe(world);
 const result=bindCameraOutput(world,profile);
 expect(result).toContain('perspective, ANTIALIAS_MSAA, TONEMAP_NEUTRAL }');
 expect(result).toContain('antialias:ANTIALIAS_MSAA,tonemap:TONEMAP_NEUTRAL,exposure:1,clearColor:');
 expect(result).toContain('fov:1,near:.1,far:1000');
 expect(bindCameraOutput(world,{antialias:'none',tonemap:'none',exposure:1})).toContain('ANTIALIAS_NONE,tonemap:TONEMAP_NONE');
});
test('拒绝无效显示组合、非有限曝光、非法注入和不可导出的参数',()=>{
 for(const input of [{},{...profile,antialias:'taa'},{...profile,tonemap:'constructor'},{...profile,exposure:NaN},{...profile,exposure:Infinity},{...profile,exposure:0},{...profile,exposure:4.01},{...profile,exposure:'1'},{...profile,autoExposure:true},[],1])expect(()=>validateCameraOutput(input)).toThrow('相机显示参数无效');
});
test('关闭色调映射不会静默接受不生效的曝光，数值边界明确定义',()=>{
 expect(()=>validateCameraOutput({...profile,tonemap:'none',exposure:2})).toThrow('曝光不生效');
 for(const exposure of [.1,4])expect(()=>validateCameraOutput({...profile,exposure})).not.toThrow();
 const schema=cameraOutputSchema().anyOf[0];expect(schema.properties?.exposure.maximum).toBe(4);
 expect(lightingSchema().properties.cameraOutput).toEqual(cameraOutputSchema());
});
test('相机模板变化时显式失败，不悄悄丢弃被请求的显示参数',()=>{
 expect(()=>bindCameraOutput(world.replace('perspective }','perspective as other }'),profile)).toThrow('契约变化');
 expect(()=>bindCameraOutput(world+' clearColor:[1,1,1,1]',profile)).toThrow('契约变化');
});
test('实际场景导出接通参数与审计，场景几何光源机位数据不被改写',()=>{
 const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},lighting={cameraOutput:profile,direction:[0,0,-1],color:[1,1,1],intensity:1,ambientColor:[1,1,1],ambientIntensity:.2,points:[]};
 const scene:any={version:'scene-v1',program:{version:'geometry-v1',name:'显示契约',materials:[{id:'m',color:[.5,.5,.5,1],roughness:.6,metallic:0,textureId:null}],templates:[{id:'t',parts:[{...pose,id:'p',material:'m',shape:{type:'box',size:[1,1,1],radius:0}}]}],instances:[{...pose,id:'i',label:'立体',template:'t',requirementIds:[]}]},cameras:[{name:'主',referenceIndex:1,position:[3,-5,2],target:[0,0,0],fov:1}],entities:[{instanceId:'i',role:'subject',category:'立体'}],lighting,textures:[],assumptions:[]};
 const before=JSON.stringify(scene),root=mkdtempSync(join(tmpdir(),'camera-output-'));
 try{expect(validateLighting(lighting)).toBe(lighting);prepareGeometryProject(root,scene.program,{}, {id:'fixture',summary:'导出测试',scene,provenance:{test:true}});
 expect(JSON.stringify(scene)).toBe(before);
 const built=readFileSync(join(root,'game/assets/world.pack.ts'),'utf8');expect(built).toContain('antialias:ANTIALIAS_MSAA');expect(built).toContain('tonemap:TONEMAP_NEUTRAL');
 const receipt=JSON.parse(readFileSync(join(root,'camera-output-export.json'),'utf8'));expect(receipt.authored).toEqual(profile);expect(receipt.legacyDefault).toBe(false);
 const audit=JSON.parse(readFileSync(join(root,'game/assets/scene-audit.json'),'utf8'));expect(audit.views[0].position).toEqual([3,2,5]);
 delete scene.lighting.cameraOutput;prepareGeometryProject(root,scene.program,{}, {id:'fixture',summary:'历史测试',scene,provenance:{test:true}});expect(readFileSync(join(root,'game/assets/world.pack.ts'),'utf8')).not.toContain('ANTIALIAS_MSAA');expect(JSON.parse(readFileSync(join(root,'camera-output-export.json'),'utf8')).legacyDefault).toBe(true);
 }finally{rmSync(root,{recursive:true,force:true});}
});
