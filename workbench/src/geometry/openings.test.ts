import {test,expect} from 'bun:test';
import {inspectOpenings,assertAssetOpenings,validateOpenings,validateOpeningBounds,openingSummary,type SpatialOpening} from './openings';
import {compileGeometryProgram,type GeometryProgram} from './program';
import {spaceSchema,validateSpace,applySurface} from './layout-stages';
import {validateAsset,assembleScene} from './layout';
import {assetInput} from './asset-input';
import {rayScene} from './camera-fit';
const pose={position:[0,0,0] as [number,number,number],rotation:[0,0,0] as [number,number,number],scale:[1,1,1] as [number,number,number]};
const box=(id:string,position:number[],size:number[],material='opaque')=>({...pose,id,material,position:position as any,shape:{type:'box' as const,size:size as any,radius:0}});
const opening:SpatialOpening={id:'portal',label:'通透区域',instanceId:'wall',center:[0,-.15,1.5],normal:[0,1,0],up:[0,0,1],width:1.6,height:2,clearDepth:.8,expectedBeyond:'geometry',beyondDescription:'后方房间结构',referenceIndices:[],evidence:'文字要求通透结构，尺度为推断'};
function scene(){const program:GeometryProgram={version:'geometry-v1',name:'开口结构',materials:[{id:'opaque',color:[.5,.5,.5,1],textureId:null,roughness:.8,metallic:0},{id:'glass',color:[.5,.5,.5,.1],textureId:null,roughness:.2,metallic:0}],templates:[{id:'frame',parts:[box('left',[-1.1,0,1.5],[.2,.3,3]),box('right',[1.1,0,1.5],[.2,.3,3]),box('lintel',[0,0,2.9],[2,.3,.2])]}],instances:[{...pose,id:'wall',label:'带开口结构',template:'frame',requirementIds:[]}]};return {program,spatialOpenings:[structuredClone(opening)]};}
test('通透开口、缺失后景与透明玻璃分开判断，不用实心板伪装门洞',()=>{
 const s=scene();expect(inspectOpenings(s).checks[0].status).toBe('missing-background');expect(()=>assertAssetOpenings(s,'frame')).not.toThrow();
 s.program.templates[0].parts.push(box('pane',[0,0,1.5],[2,.02,2.6],'glass'));expect(inspectOpenings(s).checks[0].blockedFraction).toBe(0);
 s.program.templates[0].parts.push(box('back',[0,2,1.5],[3,.1,3]));expect(inspectOpenings(s).checks[0].status).toBe('clear');
 s.program.templates[0].parts.push(box('cover',[0,0,1.5],[2,.1,2.6]));const report=inspectOpenings(s);expect(report.checks[0].status).toBe('blocked');expect(report.checks[0].blockers).toHaveProperty('wall__cover__opaque',25);expect(()=>assertAssetOpenings(s,'frame')).toThrow('资产自身封堵');
 expect(openingSummary(report).checks[0]).not.toHaveProperty('samples');expect(report.checks[0].samples).toHaveLength(25);
});
test('别的实例封堵在组装后发现，单资产检查不误归因',()=>{
 const s=scene();s.program.templates.push({id:'obstacle',parts:[box('panel',[0,0,1.5],[3,.2,3])]});s.program.instances.push({...pose,id:'other',label:'其他物体',template:'obstacle',position:[0,.4,0],requirementIds:[]});
 expect(assertAssetOpenings(s,'frame').checks[0].blockedFraction).toBe(0);expect(inspectOpenings(s).checks[0].blockers).toHaveProperty('other__panel__opaque',25);
});
test('净空约束随实例平移、旋转和非均匀缩放；远后墙不误判封口',()=>{
 const s=scene();s.program.templates[0].parts.push(box('back',[0,2,1.5],[3,.1,3]));s.program.instances[0]={...s.program.instances[0],position:[7,-3,4],rotation:[.3,.2,1.2],scale:[.7,2,1.3]};
 expect(inspectOpenings(s).checks[0].status).toBe('clear');s.program.templates[0].parts.push(box('wrong',[0,.3,1.5],[2,.1,2.6]));expect(inspectOpenings(s).checks[0].blockedFraction).toBe(1);
});
test('实际天空不要求伪造后景，旧记录缺失声明不假装完成检查',()=>{
 const s=scene();s.spatialOpenings[0].expectedBeyond='open-background';expect(inspectOpenings(s).checks[0].status).toBe('clear');
 expect(inspectOpenings({program:s.program}).status).toBe('not-declared');expect(inspectOpenings({...s,spatialOpenings:[]}).status).toBe('not-applicable');
});
test('单位、参考依据、身份与局部边界不可通过任意坐标绕过',()=>{
 const s=scene();validateOpenings(s.spatialOpenings,s.program.instances,0);
 expect(()=>validateOpenings([{...opening,normal:[0,2,0]}],s.program.instances,0)).toThrow('单位');
 expect(()=>validateOpenings([{...opening,instanceId:'missing'}],s.program.instances,0)).toThrow('实例');
 expect(()=>validateOpenings([{...opening,clearDepth:0}],s.program.instances,0)).toThrow('深度');
 expect(()=>validateOpenings([opening],s.program.instances,1)).toThrow('参考');
 const templates=[{id:'frame',bounds:{min:[-1.2,-.15,0],max:[1.2,.15,3]}}];validateOpeningBounds([opening],s.program.instances,templates);
 expect(()=>validateOpeningBounds([{...opening,center:[20,0,1.5]}],s.program.instances,templates)).toThrow('边界');
});
test('双面净空射线检测反向单面片；既有相机拾取保留背面剔除及近裁面',()=>{
 const s=scene();s.program.templates[0].parts=[{...pose,id:'sheet',material:'opaque',shape:{type:'grid',rows:2,columns:2,doubleSided:false,points:[[-1,0,0],[1,0,0],[-1,0,3],[1,0,3]]}}];
 const meshes=compileGeometryProgram(s.program).meshes;
 expect([rayScene(meshes)([0,-1,1.5],[0,1,0]),rayScene(meshes)([0,1,1.5],[0,-1,0])].filter(Boolean)).toHaveLength(1);
 expect(rayScene(meshes,{near:1e-5,doubleSided:true})([0,-.02,1.5],[0,1,0])).not.toBeNull();expect(rayScene(meshes)([0,-.02,1.5],[0,1,0])).toBeNull();
 expect(inspectOpenings(s).checks[0].blockedFraction).toBe(1);
});
test('空间声明跨材质计划、单资产输入和场景组装保留，封堵不能进入缓存',()=>{
 const s=scene(),second={...s.program.instances[0],id:'second',position:[5,0,0] as any};
 const space:any={version:'scene-space-v1',program:{version:'geometry-v1',name:'通透结构',templates:[{id:'frame',label:'框架',description:'真实开口',origin:'底面中心',bounds:{min:[-1.2,-.15,0],max:[1.2,.15,3]},maxParts:8}],instances:[...s.program.instances,second]},spatialOpenings:s.spatialOpenings,entities:[{instanceId:'wall',role:'subject',category:'框架'},{instanceId:'second',role:'context',category:'框架'}],cameras:[{name:'前面',referenceIndex:null,position:[0,-4,2],target:[0,0,1],fov:1},{name:'侧面',referenceIndex:null,position:[3,-4,2],target:[0,0,1],fov:1}],assumptions:['测试用通透结构']};
 const plan={requirements:[]};validateSpace(space,plan,0,'simple');expect(spaceSchema().required).toContain('spatialOpenings');
 const surface:any={version:'scene-surface-v1',materials:s.program.materials,textures:[],bindings:[{templateId:'frame',materialIds:['opaque','glass']}],assumptions:[],lighting:{direction:[0,1,-1],color:[1,1,1],intensity:1,ambientColor:[1,1,1],ambientIntensity:.5,points:[]}};
 const layout=applySurface(space,surface,plan,0,'simple'),asset:any={version:'asset-geometry-v1',template:s.program.templates[0]};
 expect(assetInput('通透结构',plan,layout,layout.program.templates[0],{}).spatialOpenings).toEqual(s.spatialOpenings);
 validateAsset(asset,layout.program.templates[0],layout,{});expect(assembleScene(layout,[asset],plan,0).spatialOpenings).toEqual(s.spatialOpenings);
 asset.template.parts.push(box('solid',[0,0,1.5],[2,.1,2.6]));expect(()=>validateAsset(asset,layout.program.templates[0],layout,{})).toThrow('封堵');
});
