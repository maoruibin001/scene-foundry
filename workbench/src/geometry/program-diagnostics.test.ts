import {test,expect} from 'bun:test';
import {validateGeometryProgram} from './program';
const program=():any=>({version:'geometry-v1',name:'网格诊断',materials:[{id:'surface',color:[1,1,1,1],roughness:.8,metallic:0,textureId:null}],templates:[{id:'template_a',parts:[{id:'curved_a',material:'surface',position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],shape:{type:'grid',rows:2,columns:2,points:[[0,0,0],[1,0,0],[0,1,0],[1,1,.1]],doubleSided:true}}]}],instances:[{id:'instance_a',label:'曲面',template:'template_a',position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],requirementIds:[]}]});
test('网格点数错误返回所属模板和部件及准确期望值，不改写模型数据',()=>{
 const p=program();p.templates[0].parts[0].shape.points.push([1,1,.1]);const before=JSON.stringify(p);
 expect(()=>validateGeometryProgram(p)).toThrow('模板 template_a / 部件 curved_a：曲面网格点数不符：rows=2、columns=2，应有 4 个点，实际 5 个');expect(JSON.stringify(p)).toBe(before);
});
test('非法网格坐标精确到索引，合法网格仍通过相同预算验证',()=>{
 const p=program();expect(validateGeometryProgram(p)).toEqual({triangles:4,parts:1});p.templates[0].parts[0].shape.points[2]=[0,Infinity,0];expect(()=>validateGeometryProgram(p)).toThrow('points[2] 无效');
});
