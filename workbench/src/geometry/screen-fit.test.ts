import {test,expect} from 'bun:test';
import {fitScreenTargets,surfaceBindings} from './screen-fit';
import {compileGeometryProgram} from './program';
import {project} from './camera-fit';
const fixture=():any=>({program:{version:'geometry-v1',name:'几何',materials:[{id:'m',color:[1,1,1,1],roughness:.7,metallic:0,textureId:null}],templates:[{id:'t',parts:[{id:'p',material:'m',position:[0,0,.5],rotation:[0,0,0],scale:[1,1,1],shape:{type:'box',size:[1,1,1],radius:0}}]}],instances:[{id:'i',label:'实体',template:'t',position:[0,0,0],rotation:[0,0,.1],scale:[1,1,1],requirementIds:[]}]},cameras:[{referenceIndex:1,position:[3,-5,2],target:[0,0,.5],fov:1},{referenceIndex:2,position:[-4,-1,2],target:[0,0,.5],fov:1}]});
function rects(s:any){const p=compileGeometryProgram(s.program).meshes.flatMap(m=>m.geometry.positions),points=Array.from({length:p.length/3},(_,i)=>p.slice(i*3,i*3+3));return s.cameras.map(c=>{const v=points.map(p=>project(c,p));return {referenceIndex:c.referenceIndex,rect:[Math.min(...v.map(p=>p[0])),Math.min(...v.map(p=>p[1])),Math.max(...v.map(p=>p[0])),Math.max(...v.map(p=>p[1]))]};});}
test('两个图像约束恢复实例位置与大小，保持落地、方向和原始数据',()=>{
 const s=fixture(),desired=fixture(),before=JSON.stringify(s);desired.program.instances[0].position=[.3,-.2,0];desired.program.instances[0].scale=[.85,.85,.85];
 const result=fitScreenTargets(s,[{instanceId:'i',reason:'两个机位轮廓可对应',views:rects(desired)}]);expect(result.reports[0].accepted).toBe(true);expect(result.instances[0].position[0]).toBeCloseTo(.3,2);expect(result.instances[0].position[1]).toBeCloseTo(-.2,2);expect(result.instances[0].position[2]).toBe(0);expect(result.instances[0].scale[0]).toBeCloseTo(.85,2);expect(result.instances[0].rotation).toEqual(s.program.instances[0].rotation);expect(JSON.stringify(s)).toBe(before);
});
test('互相冲突的两个目标不强行修改，已吻合的实例保持不动',()=>{
 const s=fixture(),v=rects(s);expect(fitScreenTargets(s,[{instanceId:'i',reason:'检查',views:v}]).instances).toHaveLength(0);
 v[0].rect=[.05,.05,.15,.15];v[1].rect=[.8,.8,.98,.98];expect(fitScreenTargets(s,[{instanceId:'i',reason:'冲突',views:v}]).instances).toHaveLength(0);
});
test('拒绝未知机位、单机位、非法矩形和冻结开口宿主',()=>{
 const s=fixture(),v=rects(s);for(const views of [[v[0]],[v[0],{...v[1],referenceIndex:9}],[v[0],{...v[1],rect:[0,0,2,1]}]])expect(()=>fitScreenTargets(s,[{instanceId:'i',reason:'依据',views}])).toThrow();
 s.spatialOpenings=[{instanceId:'i'}];expect(()=>fitScreenTargets(s,[{instanceId:'i',reason:'依据',views:v}])).toThrow('宿主');
});
test('表面绑定明确部件和逐实例覆盖，未贴图仅是事实',()=>{
 const s=fixture();s.program.instances[0].surfaceOverrides=[{sourceMaterialId:'m',targetMaterialId:'m',uvScale:[2,2]}];const b=surfaceBindings(s);expect(b[0].textureId).toBeNull();expect(b[0].parts[0]).toMatchObject({templateId:'t',partId:'p',uvScale:[1,1]});expect(b[0].parts[0].instances[0].override.uvScale).toEqual([2,2]);
});
