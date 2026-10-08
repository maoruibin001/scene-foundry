import {test,expect} from 'bun:test';
import {applyGrayboxSpaceRepair,grayboxSpaceRepairSchema,GRAYBOX_SPACE_REPAIR} from './graybox-space-repair';
import {modelSchema} from '../model-schema';
const space=()=>({version:'scene-space-v1',program:{templates:[{id:'tree',label:'植物',description:'原始轮廓',origin:'根部原点',maxParts:32,bounds:{min:[-1,-1,0],max:[1,1,3]}}],instances:[{id:'front',label:'近景',template:'tree',position:[1,2,0],rotation:[0,0,0],scale:[1,1,1],requirementIds:['R1']},{id:'back',label:'远景',template:'tree',position:[1,5,0],rotation:[0,0,0],scale:[1,1,1],requirementIds:['R1']}]},cameras:[{name:'参考',referenceIndex:1,position:[0,-2,1.5],target:[0,5,1.5],fov:1}],entities:[{instanceId:'front',category:'植物',role:'subject'},{instanceId:'back',category:'植物',role:'context'}],observedBindings:[{landmarkId:'plant',instanceIds:['front','back']}],spatialRelations:[{id:'REL1',critical:true,description:'两侧围合',instanceIds:['front','back']}],spatialOpenings:[],spatialContacts:[],assumptions:['不可见背面推断']});
const patch=()=>({version:GRAYBOX_SPACE_REPAIR,reason:'原图两侧植物夹住步道，实际近景位置偏右；依据实例编号向路径移动。',instances:[{id:'front',position:[.5,2,0],rotation:[0,0,0],scale:[1,1,1]}],templates:[],parts:[],cameras:[],contacts:[],checks:[{relationIds:['REL1'],evidence:'实际参考机位近景植物与步道之间有空隙',expectedChange:'下一轮参考机位的通道边界由植物衔接'}]});
test('只改已有实例坐标，语义、关系、开口、预算与未列对象逐字保留；来源不改',()=>{
 const source=space(),before=JSON.stringify(source),next=applyGrayboxSpaceRepair(source,patch(),v=>v);
 expect(next.value.program.instances[0].position).toEqual([.5,2,0]);expect(next.value.program.instances[1]).toEqual(source.program.instances[1]);
 for(const k of ['entities','spatialRelations','observedBindings','spatialOpenings','spatialContacts','assumptions','cameras'])expect(next.value[k]).toEqual(source[k]);
 expect(next.value.program.templates).toEqual(source.program.templates);expect(next.changes.instances).toEqual(['front']);expect(JSON.stringify(source)).toBe(before);
});
test('模板简报和预算冻结，不能改文字却用旧几何预览',()=>{
 const p={...patch(),templates:[{id:'tree',description:'改描述',origin:'根部',bounds:{min:[-1,-1,0],max:[1.2,1,3]}}]};expect(()=>applyGrayboxSpaceRepair(space(),p,v=>v)).toThrow('额度');
});
test('未知身份、重复、附加字段、需求重写与数量增删都拒绝',()=>{
 const p=patch();for(const edit of [{...p.instances[0],id:'new'},{...p.instances[0],requirementIds:[]},{...p.instances[0],template:'new'}])expect(()=>applyGrayboxSpaceRepair(space(),{...p,instances:[edit]},v=>v)).toThrow();
 expect(()=>applyGrayboxSpaceRepair(space(),{...p,instances:[...p.instances,...p.instances]},v=>v)).toThrow('重复');
 expect(()=>applyGrayboxSpaceRepair(space(),{...p,entities:[]},v=>v)).toThrow('字段');
});
test('拒绝非有限坐标、不正尺度、超过局部尺度、边界翻转与过大修改集',()=>{
 const p=patch();for(const v of [[0,1,1],[3,1,1],[NaN,1,1]])expect(()=>applyGrayboxSpaceRepair(space(),{...p,instances:[{...p.instances[0],scale:v}]},v=>v)).toThrow();
 const t={id:'tree',description:'改变范围',origin:'根部',bounds:{min:[-1,-1,0],max:[.5,1,-1]}};expect(()=>applyGrayboxSpaceRepair(space(),{...p,templates:[t]},v=>v)).toThrow('额度');
 expect(()=>applyGrayboxSpaceRepair(space(),{...p,instances:Array.from({length:13},()=>p.instances[0])},v=>v)).toThrow('额度');
});
test('机位编号与接触身份保留，接缝采样不能删除',()=>{
 const s=space();s.spatialContacts=[{id:'seam',kind:'seam',aId:'front',bId:'back',points:[[0,0,0],[0,1,0]],evidence:'真实连接',referenceIndices:[1]}] as any;
 const p={...patch(),cameras:[{name:'参考',position:[0,-2,1.6],target:[0,5,1.5],fov:1}],contacts:[{id:'seam',points:[[0,.1,0],[0,1.1,0]]}]};
 const n=applyGrayboxSpaceRepair(s,p,v=>v).value;expect(n.cameras[0].referenceIndex).toBe(1);expect(n.spatialContacts[0].kind).toBe('seam');
 expect(()=>applyGrayboxSpaceRepair(s,{...p,contacts:[{id:'seam',points:[[0,.1,0]]}]},v=>v)).toThrow('采样数');
});
test('空补丁、只有原因或只改未知关系不触发原画面重跑，完整布局校验仍执行',()=>{
 const p={...patch(),instances:[]};expect(()=>applyGrayboxSpaceRepair(space(),p,v=>v)).toThrow('NO_ACTIONABLE_CHANGE');
 expect(()=>applyGrayboxSpaceRepair(space(),{...patch(),checks:[{...patch().checks[0],relationIds:['unknown']}]},v=>v)).toThrow('冻结关系');
 expect(()=>applyGrayboxSpaceRepair(space(),patch(),()=>{throw Error('contact bounds');})).toThrow('contact bounds');
});
test('同scene-space角色仅补丁请求采用紧凑schema，初始规划保持原全量契约',()=>{
 const schema=grayboxSpaceRepairSchema();expect(schema.properties.version.enum).toEqual([GRAYBOX_SPACE_REPAIR]);expect(schema.properties.instances.items.properties.requirementIds).toBeUndefined();
 expect(modelSchema('scene-space',{grayboxRepair:true})).toEqual(schema);expect(modelSchema('scene-space').properties.version.enum).toEqual(['scene-space-v1']);
});
