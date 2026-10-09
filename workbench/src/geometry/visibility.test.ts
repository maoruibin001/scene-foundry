import {compileGeometryProgram} from './program';
import {test,expect} from 'bun:test';
import {rasterVisibility,sceneVisibility,visibilityContext} from './visibility';
import {ray,cameraRay,rayScene} from './camera-fit';
import {assertVisibilityCamera} from './visibility-evidence';

const camera={position:[0,-5,1],target:[0,0,1],fov:1};
const pose={rotation:[0,0,0],scale:[1,1,1]};
function scene():any{return {program:{version:'geometry-v1',name:'前后遮挡',materials:[{id:'surface',color:[.5,.5,.5,1],roughness:1,metallic:0,textureId:null}],templates:[{id:'object',parts:[{...pose,position:[0,0,0],id:'panel',material:'surface',shape:{type:'box',size:[1,.2,2],radius:0}}]}],instances:[{...pose,id:'front',label:'前方物体',template:'object',position:[0,0,1],requirementIds:[]},{...pose,id:'back',label:'后方物体',template:'object',position:[0,2,1],requirementIds:[]}]},cameras:[{...camera,name:'正面',referenceIndex:1}],textures:[],entities:[],lighting:{},assumptions:[]};}
const mesh=(id:string,positions:number[])=>({name:id,entityId:id,geometry:{positions,indices:[0,1,2]}});

test('两层深度定位实际遮挡部件，完全被遮挡物不会伪称可见',()=>{
 const s=scene(),before=JSON.stringify(s),r=sceneVisibility(s),v=r.views[0];
 expect(v.instances.map(i=>i.instanceId)).toEqual(['front']);
 expect(v.occlusions[0]).toMatchObject({front:{instanceId:'front',partId:'panel'},behind:{instanceId:'back',partId:'panel'}});
 expect(v.occlusions[0].pixels).toBeGreaterThan(100);expect(v.instances[0].visibleParts[0].materialId).toBe('surface');
 expect(visibilityContext(r).views[0]).not.toHaveProperty('labelsBase64');expect(JSON.stringify(s)).toBe(before);
});

test('半透明及含透明纹理不会作为实心遮挡层；缺失纹理明确排除',()=>{
 const s=scene();s.program.materials.push({...s.program.materials[0],id:'glass',color:[1,1,1,.4]});s.program.templates.push({id:'glass',parts:[{...s.program.templates[0].parts[0],material:'glass'}]});s.program.instances[0].template='glass';
 let r=sceneVisibility(s);expect(r.excludedMaterials).toEqual(['glass']);expect(r.views[0].instances.map(i=>i.instanceId)).toEqual(['back']);
 s.program.materials[1].color[3]=1;s.program.materials[1].textureId='tile';r=sceneVisibility(s,{tile:{width:1,height:1,colorSpace:'srgb',rgba8:Buffer.from([255,255,255,128]).toString('base64')}});
 expect(r.excludedMaterials).toEqual(['glass']);expect(sceneVisibility(s).excludedMaterials).toEqual(['glass']);
});

test('光栅可见性与独立三角形射线一致，覆盖遮挡、斜面、近面裁剪和背面剔除',()=>{
 const c={position:[0,0,0],target:[0,1,0],fov:1.2};
 const meshes=[mesh('far',[-3,5,-3,3,5,-3,0,5,3]),mesh('slanted',[-1,2,-.8,1,4,-.8,0,3,1]),mesh('nearclip',[-.08,.06,-.1,.8,1,-.15,.1,1,.8]),mesh('backface',[-3,1,-3,0,1,3,3,1,-3])];
 const width=64,height=36,r=rasterVisibility(meshes,c,width,height,.1,20),hit=rayScene(meshes,{near:0,far:30});let checked=0;
 for(let y=1;y<height;y+=3)for(let x=1;x<width;x+=3){
  const direction=ray(c,[(x+.5)/width,(y+.5)/height],width/height),origin=direction.map(v=>v*.1/direction[1]),h=hit(origin,direction),id=r.front[y*width+x];
  expect(id<0?null:meshes[id].name).toBe(h?.meshId??null);checked++;
 }
 expect(checked).toBeGreaterThan(200);
});

test('同一实例的部件自遮挡可诊断，多个参考机位分别计算',()=>{
 const s=scene();s.program.instances=s.program.instances.slice(0,1);s.program.templates[0].parts.push({...s.program.templates[0].parts[0],id:'rear_panel',position:[0,1,0]});
 s.cameras.push({...camera,name:'背面',referenceIndex:2,position:[0,5,1],target:[0,0,1]});
 const r=sceneVisibility(s);expect(r.views[0].occlusions[0]).toMatchObject({front:{partId:'panel',instanceId:'front'},behind:{partId:'rear_panel',instanceId:'front'}});
 expect(r.views[1].occlusions[0].front.partId).toBe('rear_panel');
 expect(r.palette).toHaveLength(1);
});

test('物体表皮和底层不会吞掉跨物体遮挡；运行机位不一致时拒绝定位证据',()=>{
 const s=scene();s.program.templates[0].parts.push({...s.program.templates[0].parts[0],id:'skin',position:[0,-.02,0]});
 const r=sceneVisibility(s);expect(r.views[0].instanceOcclusions[0]).toMatchObject({front:{instanceId:'front',partId:'skin'},behind:{instanceId:'back',partId:'skin'}});
 const c={...camera,name:'正面',referenceIndex:1},pose={selectedView:0,position:[0,1,5],target:[0,1,0],fov:1};
 expect(()=>assertVisibilityCamera(c,pose,0,1600,900)).not.toThrow();
 for(const p of [{...pose,fov:1.1},{...pose,position:[1,1,5]},{...pose,selectedView:1},{}])expect(()=>assertVisibilityCamera(c,p,0,1600,900)).toThrow('采集机位');
 expect(()=>assertVisibilityCamera(c,pose,0,1600,1000)).toThrow('画幅');
});

test('诊断使用实例覆盖后的真实材质和透明度，身份仍能回指原模板部件',()=>{const s=scene();s.program.materials.push({...s.program.materials[0],id:'transparent',color:[1,1,1,.2],textureId:null});s.program.instances[0].surfaceOverrides=[{sourceMaterialId:'surface',targetMaterialId:'transparent',uvScale:null}];let r=sceneVisibility(s);expect(r.views[0].instances.map(i=>i.instanceId)).toEqual(['back']);s.program.materials[1].color[3]=1;r=sceneVisibility(s);expect(r.views[0].parts[0]).toMatchObject({instanceId:'front',sourceMaterialId:'surface',materialId:'transparent',partId:'panel'});});

test('正交光栅的每像素可见身份和深度与独立网格射线一致，含倾斜面及近裁剪',()=>{
 const s=scene(),c={...s.cameras[0],projection:'orthographic',orthographicHeight:4};
 s.program.instances[1].position=[.7,2.2,1];s.program.instances[1].rotation=[0,0,.4];
 const meshes=compileGeometryProgram(s.program).meshes,w=64,h=64,r=rasterVisibility(meshes,c,w,h,.1,20),cast=rayScene(meshes,{near:.1,far:20});let hits=0;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const beam=cameraRay(c,[(x+.5)/w,(y+.5)/h],1),hit=cast(beam.origin,beam.direction),at=r.front[y*w+x];if(hit){expect(at).toBeGreaterThanOrEqual(0);expect(meshes[at].name).toBe(hit.meshId);expect(r.depth[y*w+x]).toBeCloseTo(hit.distance,6);hits++;}else expect(at).toBe(-1);}
 expect(hits).toBeGreaterThan(100);
});

test('实际相机投影回执拒绝投影、范围、裁剪及宽高比不一致，旧无回执不能证明当前契约',()=>{
 const c:any={...camera,name:'正面',referenceIndex:1,projection:'orthographic',orthographicHeight:4,frame:{width:900,height:900}};
 const projection={projection:1,fov:0,aspect:1,left:-2,right:2,bottom:-2,top:2,near:.1,far:1000};
 const pose={selectedView:0,position:[0,1,5],target:[0,1,0],fov:c.fov,cameraProjection:projection};
 expect(()=>assertVisibilityCamera(c,pose,0,900,900,true)).not.toThrow();
 for(const patch of [{projection:0},{top:3},{near:.2},{far:500}])expect(()=>assertVisibilityCamera(c,{...pose,cameraProjection:{...projection,...patch}},0,900,900,true)).toThrow();
 expect(()=>assertVisibilityCamera(c,{...pose,cameraProjection:undefined},0,900,900,true)).toThrow('缺少实际');
 const perspective={...c,projection:'perspective'},p={...pose,cameraProjection:{...projection,projection:0,fov:c.fov}};
 expect(()=>assertVisibilityCamera(perspective,p,0,900,900,true)).not.toThrow();
 for(const patch of [{fov:c.fov+.1},{aspect:16/9}])expect(()=>assertVisibilityCamera(perspective,{...p,cameraProjection:{...p.cameraProjection,...patch}},0,900,900,true)).toThrow('实际透视');
});
