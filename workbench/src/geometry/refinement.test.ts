import {test,expect} from 'bun:test';
import {applyRefinement,refinementSchema,REFINEMENT_PROMPT} from './refinement';
import {assertPlannedRepair} from './repair-goals';
import {repairBudget} from './repair-budget';
import {modelSchema} from '../model-schema';
const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},plan={requirements:[{id:'R1',critical:true,count:null}]};
const scene=():any=>({version:'scene-v1',program:{version:'geometry-v1',name:'未知形状',materials:[{id:'base',color:[1,1,1,1],roughness:.7,metallic:0,textureId:null}],templates:[{id:'subject',parts:[{...pose,id:'body',material:'base',shape:{type:'box',size:[1,1,1],radius:0}}]}],instances:[{...pose,id:'one',label:'主体',template:'subject',requirementIds:['R1']}]},entities:[{instanceId:'one',category:'任意类别',role:'subject'}],cameras:[{name:'参考',referenceIndex:1,position:[3,-4,2],target:[0,0,0],fov:1},{name:'检查',referenceIndex:null,position:[-3,4,2],target:[0,0,0],fov:1}],textures:[],textureReuse:[],lighting:{direction:[.5,.5,-.7],color:[1,1,1],intensity:1,ambientColor:[1,1,1],ambientIntensity:.2,points:[]},assumptions:[]});
const patch=():any=>({version:'scene-refinement-v1',reason:'依据真实画面纠正朝向',instances:[{...pose,id:'one',label:'主体',template:'subject',rotation:[0,0,.4],requirementIds:['R1']}],cameras:[],materials:[],parts:[],removeParts:[],addTemplates:[],addEntities:[],textures:[],textureReuse:[],lighting:null,assumptions:[]});
function complexRepairFixture(){
 const s=scene(),part=structuredClone(s.program.templates[0].parts[0]);
 s.program.templates[0].parts=Array.from({length:40},(_,i)=>({...structuredClone(part),id:'body'+i,position:[i*.1,0,0]}));
 s.program.templates.push({id:'unit',parts:[part]});
 for(let i=0;i<16;i++){s.program.instances.push({...structuredClone(s.program.instances[0]),id:'context'+i,template:'unit',position:[i,4,0]});s.entities.push({instanceId:'context'+i,category:'配套'+i%4,role:'context'});}
 const p={...patch(),version:'scene-refinement-v3',removeInstances:[],instances:[],parts:s.program.templates[0].parts.slice(0,33).map((part:any)=>({templateId:'subject',part:{...part,position:[...part.position.slice(0,2),.1]}}))};return {s,p};
}
test('复杂场景完整关联修改超过旧32上限；历史协议仍不能借新额度放行',()=>{
 const {s,p}=complexRepairFixture(),before=JSON.stringify(s),n=applyRefinement(s,p,plan,1,'complex');
 expect(n.program.templates[0].parts.filter(p=>p.position[2]===.1)).toHaveLength(33);expect(JSON.stringify(s)).toBe(before);
 expect(()=>applyRefinement(s,{...p,version:'scene-refinement-v2'},plan,1,'complex')).toThrow('修正数量超限：parts');
 expect(modelSchema('scene-refine',{repairComplexity:'complex'}).properties.parts.maxItems).toBe(96);
 expect(modelSchema('scene-refine',{repairComplexity:'medium'}).properties.parts.maxItems).toBe(64);
 expect(refinementSchema().properties.parts.maxItems).toBe(32);expect(repairBudget('complex').templates).toBe(6);
});
test('扩大编辑范围仍拒绝超出当前额度或总场景预算',()=>{
 const {s,p}=complexRepairFixture();p.parts=Array.from({length:97},(_,i)=>({templateId:'subject',part:{...structuredClone(s.program.templates[0].parts[0]),id:'extra'+i}}));
 expect(()=>applyRefinement(s,p,plan,1,'complex')).toThrow('修正数量超限：parts');
 const second=complexRepairFixture();for(const i of second.s.program.instances)i.template='subject';
 expect(()=>applyRefinement(second.s,second.p,plan,1,'complex')).toThrow('原复杂度预算');
});
test('增量修正保留原对象、未改资产和输入，原场景不被覆盖',()=>{
 const s=scene(),before=JSON.stringify(s),p=patch();p.cameras=[{...s.cameras[0],position:[3,-5,2]}];p.parts=[{templateId:'subject',part:{...s.program.templates[0].parts[0],uvScale:[2,2]}}];
 const n=applyRefinement(s,p,plan,1,'simple');expect(JSON.stringify(s)).toBe(before);expect(n.program.instances[0].rotation[2]).toBe(.4);expect(n.program.templates[0].parts[0].uvScale).toEqual([2,2]);expect(n.cameras[1]).toEqual(s.cameras[1]);expect(n.program.materials).toEqual(s.program.materials);
});
test('未观测的引用、重复补丁、冲突删除和空改进不能导出',()=>{
 let p=patch();p.parts=[{templateId:'missing',part:scene().program.templates[0].parts[0]}];expect(()=>applyRefinement(scene(),p,plan,1,'simple')).toThrow('不存在');
 p=patch();p.instances.push(p.instances[0]);expect(()=>applyRefinement(scene(),p,plan,1,'simple')).toThrow('重复');
 p=patch();p.parts=[{templateId:'subject',part:scene().program.templates[0].parts[0]}];p.removeParts=[{templateId:'subject',partId:'body',reason:'冲突'}];expect(()=>applyRefinement(scene(),p,plan,1,'simple')).toThrow('同时删除');
 p=patch();p.cameras=[{...scene().cameras[0],referenceIndex:2}];expect(()=>applyRefinement(scene(),p,plan,1,'simple')).toThrow('已有');
 p=patch();p.addTemplates=[{id:'unused',parts:scene().program.templates[0].parts}];expect(()=>applyRefinement(scene(),p,plan,1,'simple')).toThrow('实际场景实例');
 p=patch();p.instances=[];p.assumptions=['只改变说明'];expect(()=>applyRefinement(scene(),p,plan,1,'simple')).toThrow('没有任何');
});
test('新实例必须有真实几何和语义，不能移除关键需求或放宽复杂度',()=>{
 let p=patch();p.instances[0].requirementIds=[];expect(()=>applyRefinement(scene(),p,plan,1,'simple')).toThrow('关键需求');
 p=patch();p.instances.push({...p.instances[0],id:'two'});expect(()=>applyRefinement(scene(),p,plan,1,'simple')).toThrow('缺少语义');
 p.addEntities=[{instanceId:'two',category:'配套',role:'context'}];expect(applyRefinement(scene(),p,plan,1,'simple').entities).toHaveLength(2);
 p=patch();p.instances=Array.from({length:9},(_,i)=>({...p.instances[0],id:i?'extra'+i:'one'}));p.addEntities=p.instances.slice(1).map((i:any)=>({instanceId:i.id,category:'配套',role:'context'}));expect(()=>applyRefinement(scene(),p,plan,1,'simple')).toThrow('复杂度');
});
test('预算按实例展开计算，不允许用新增模板绕过部件上限',()=>{
 const s=scene(),p=patch();s.program.templates[0].parts=Array.from({length:100},(_,i)=>({...s.program.templates[0].parts[0],id:'part'+i}));p.instances.push({...p.instances[0],id:'two'});p.addEntities=[{instanceId:'two',category:'配套',role:'context'}];expect(()=>applyRefinement(s,p,plan,1,'simple')).toThrow('原复杂度预算');
});
test('修正契约严格且通用，不嵌入样例物体与坐标',()=>{
 const walk=(s:any)=>{if(s.type==='object'){expect(s.additionalProperties).toBe(false);expect(s.required).toEqual(Object.keys(s.properties));Object.values(s.properties).forEach(walk)}if(s.items)walk(s.items);s.anyOf?.forEach(walk)};walk(refinementSchema());expect(REFINEMENT_PROMPT).not.toContain('餐厅');expect(REFINEMENT_PROMPT).toContain('ForgeaX Engine');expect(REFINEMENT_PROMPT).toContain('所有说明使用中文');
});

test('修改裁切时旧复用绑定不覆盖新片段，未改资源继续保留',()=>{const s=scene(),p=patch(),t={id:'patch',referenceIndex:1,quad:[[.2,.2],[.4,.2],[.4,.4],[.2,.4]],size:256,description:'局部表面'};s.textures=[t,{...t,id:'kept'}];s.textureReuse=[{textureId:'patch',assetId:'a'.repeat(64),reason:'旧资源'},{textureId:'kept',assetId:'b'.repeat(64),reason:'未改'}];p.textures=[{...t,quad:[[.3,.3],[.5,.3],[.5,.5],[.3,.5]]}];expect(applyRefinement(s,p,plan,1,'simple').textureReuse.map(x=>x.textureId)).toEqual(['kept']);p.textureReuse=[{textureId:'patch',assetId:'c'.repeat(64),reason:'显式新选择'}];expect(applyRefinement(s,p,plan,1,'simple').textureReuse.find(x=>x.textureId==='patch').assetId).toBe('c'.repeat(64));expect(s.textureReuse[0].assetId).toBe('a'.repeat(64));});

test('替换贴图释放仅因本次材质换图而退役的声明，保留来源与共享引用',()=>{
 const s=scene(),p=patch(),t={referenceIndex:1,quad:[[.2,.2],[.4,.2],[.4,.4],[.2,.4]],size:256,description:'局部表面'};
 s.textures=Array.from({length:24},(_,i)=>({...t,id:'texture'+i}));s.program.materials[0].textureId='texture0';s.textureReuse=[{textureId:'texture0',assetId:'a'.repeat(64),reason:'原始绑定'}];
 p.materials=[{...s.program.materials[0],textureId:'replacement'}];p.textures=[{...t,id:'replacement'}];const original=JSON.stringify(s);
 const n=applyRefinement(s,p,plan,1,'simple');expect(n.textures).toHaveLength(24);expect(n.textures.some(t=>t.id==='texture0')).toBe(false);expect(n.textures.some(t=>t.id==='texture1')).toBe(true);expect(n.textureReuse).toEqual([]);expect(JSON.stringify(s)).toBe(original);
 s.program.materials.push({...s.program.materials[0],id:'shared'});expect(()=>applyRefinement(s,p,plan,1,'simple')).toThrow('最多 24 个声明，实际 25 个');
});

function duplicateScene(){const s=scene();s.program.instances.push({...s.program.instances[0],id:'extra',label:'重复对象',position:[2,0,0]});s.entities.push({...s.entities[0],instanceId:'extra'});return s;}
function removalPatch():any{return {...patch(),version:'scene-refinement-v2',instances:[],removeInstances:[{instanceId:'extra',reason:'原图仅一组对象，重复实例遮挡了本应留空的通道'}]};}
test('移除错误重复实例及语义，同时保留原场景、共享几何与未改资源',()=>{
 const s=duplicateScene(),before=JSON.stringify(s),n=applyRefinement(s,removalPatch(),plan,1,'simple');
 expect(n.program.instances.map((i:any)=>i.id)).toEqual(['one']);expect(n.entities.map((e:any)=>e.instanceId)).toEqual(['one']);
 expect(n.program.templates).toEqual(s.program.templates);expect(n.program.materials).toEqual(s.program.materials);expect(n.cameras).toEqual(s.cameras);expect(JSON.stringify(s)).toBe(before);
 const selected:any={goals:[{id:'G1',kind:'layout',instanceIds:['extra'],templateIds:[],materialIds:[],cameraNames:[],addGeometry:false}]};
 expect(assertPlannedRepair(s,n,selected).removedInstanceIds).toEqual(['extra']);selected.goals[0].instanceIds=['one'];expect(()=>assertPlannedRepair(s,n,selected)).toThrow('未选择');
 expect(refinementSchema().properties.version.enum).toEqual(['scene-refinement-v3']);
});
test('删除必须有原对象、依据与新版契约，不能同时更新或新增同一实例',()=>{
 for(const mutate of [(p:any)=>p.removeInstances[0].instanceId='unknown',(p:any)=>p.removeInstances[0].reason=' ',(p:any)=>p.removeInstances.push({...p.removeInstances[0]}),(p:any)=>p.instances=[duplicateScene().program.instances[1]],(p:any)=>p.addEntities=[duplicateScene().entities[1]],(p:any)=>p.version='scene-refinement-v1',(p:any)=>delete p.removeInstances]){
  const p=removalPatch();mutate(p);expect(()=>applyRefinement(duplicateScene(),p,plan,1,'simple')).toThrow();
 }
 const old=patch();expect(()=>applyRefinement(scene(),old,plan,1,'simple')).not.toThrow();
});
test('删除不能破坏明确数量、关键需求、复杂度或冻结开口宿主',()=>{
 const s=duplicateScene(),p=removalPatch();expect(()=>applyRefinement(s,p,{requirements:[{id:'R1',critical:true,count:2}]},1,'simple')).toThrow('明确数量');
 s.program.instances[0].requirementIds=[];expect(()=>applyRefinement(s,p,plan,1,'simple')).toThrow('关键需求');
 const medium=duplicateScene();medium.program.instances=Array.from({length:8},(_,i)=>({...medium.program.instances[0],id:i?'extra'+i:'one'}));medium.entities=medium.program.instances.map((i:any,k:number)=>({instanceId:i.id,role:k?'context':'subject',category:'类别'+k%3}));p.removeInstances[0].instanceId='extra1';expect(()=>applyRefinement(medium,p,plan,1,'medium')).toThrow('原复杂度');
 const opening=duplicateScene();opening.spatialOpenings=[{id:'door',instanceId:'extra'}];p.removeInstances[0].instanceId='extra';expect(()=>applyRefinement(opening,p,plan,1,'simple')).toThrow('冻结开口');
});
