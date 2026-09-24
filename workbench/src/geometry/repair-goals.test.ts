import {test,expect} from 'bun:test';
import {validateRepairGoals,assertPlannedRepair,repairGoalsSchema,repairGoalContext,repairGoalReferences,REPAIR_GOALS_PROMPT} from './repair-goals';
import {modelSchema} from '../model-schema';
import {NoActionableChange} from '../contracts';
import {refinementFocus} from './refinement-focus';
import {repairBudget} from './repair-budget';
const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};
const plan={requirements:[{id:'R1'},{id:'R2'}]},frames=['reference-1.png','inspection-3.png'];
function scene():any{return {version:'scene-v1',program:{version:'geometry-v1',name:'通用空间',materials:[{id:'base',color:[.5,.5,.5,1],roughness:.8,metallic:0,textureId:null}],templates:['main','other'].map(id=>({id,parts:[{...pose,id:'body',material:'base',shape:{type:'box',size:[1,1,1],radius:0}}]})),instances:['main','other'].map((template,i)=>({...pose,id:'object'+i,label:'对象'+i,template,position:[i*3,0,0],requirementIds:['R1']}))},entities:[{instanceId:'object0',category:'主体',role:'subject'},{instanceId:'object1',category:'环境',role:'context'}],cameras:[{name:'主视角',referenceIndex:1,position:[3,-5,2],target:[0,0,0],fov:1}],textures:[],textureReuse:[],spatialOpenings:[],lighting:{direction:[0,1,-1],color:[1,1,1],intensity:1,ambientColor:[1,1,1],ambientIntensity:.3,points:[]},assumptions:[]};}
function selection():any{return {version:'scene-repair-goals-v1',summary:'先解决主体布局',goals:[{id:'G1',kind:'layout',dimension:'spatial',problem:'前后关系错误',whyPriority:'主体遮挡影响空间关系',expectedChange:'主体前后层次与原图一致',requirementIds:['R1'],instanceIds:['object0'],templateIds:[],materialIds:[],cameraNames:[],openingIds:[],addGeometry:false,evidence:[{frame:frames[0],referenceIndex:1,region:[.1,.2,.6,.8],observation:'主体遮住应可见的空间'}]}],deferred:[{problem:'局部表面污渍',reason:'不影响当前布局修正'}]};}
test('复杂场景六类关联结构可共同选择，但不能由多目标叠加绕过总范围',()=>{
 const s=scene();for(let i=0;i<5;i++)s.program.templates.push({...structuredClone(s.program.templates[0]),id:'structure'+i});
 const p=selection();p.goals[0].templateIds=s.program.templates.slice(0,6).map((t:any)=>t.id);
 expect(()=>validateRepairGoals(p,s,plan,1,frames)).toThrow('templateIds');
 expect(validateRepairGoals(p,s,plan,1,frames,repairBudget('complex'))).toBe(p);
 const schema=modelSchema('scene-repair-plan',{repairReferences:repairGoalReferences(s,plan,1,frames),repairComplexity:'complex'});
 expect(schema.properties.goals.items.anyOf[0].properties.templateIds.maxItems).toBe(6);
 p.goals.push({...structuredClone(p.goals[0]),id:'G2',templateIds:[s.program.templates[6].id]});
 expect(()=>validateRepairGoals(p,s,plan,1,frames,repairBudget('complex'))).toThrow('范围过大');
});
test('目标有真实证据和对象，读取布局范围不复制巨大形状数据',()=>{
 const s=scene(),before=JSON.stringify(s),p=selection();expect(validateRepairGoals(p,s,plan,1,frames)).toBe(p);
 const c=repairGoalContext(s);expect(c.templates[0]).toMatchObject({id:'main',partCount:1});expect(c.templates[0]).not.toHaveProperty('parts');expect(c.instances[0].projectedBounds).toHaveLength(1);expect(JSON.stringify(s)).toBe(before);
 const next=structuredClone(s);next.program.instances[0].position[0]=1;expect(assertPlannedRepair(s,next,p).changes.instanceIds).toEqual(['object0']);
});
test('拒绝不存在的引用、伪造证据和重复目标',()=>{
 for(const mutate of [(p:any)=>p.goals[0].instanceIds=['unknown'],(p:any)=>p.goals[0].requirementIds=['R99'],(p:any)=>p.goals[0].evidence[0].frame='fake.png',(p:any)=>p.goals[0].evidence[0].referenceIndex=2,(p:any)=>p.goals[0].evidence[0].region=[1,0,0,1],(p:any)=>p.goals.push(p.goals[0])]){
  const p=selection();mutate(p);expect(()=>validateRepairGoals(p,scene(),plan,1,frames)).toThrow('修正目标');
 }
 const p=selection();p.goals[0].evidence[0].referenceIndex=null;expect(validateRepairGoals(p,scene(),plan,0,frames)).toBe(p);
});
test('目标不能用只改相机、材质或说明假装完成布局，未选对象保持不变',()=>{
 const s=scene(),p=selection();
 for(const mutate of [(n:any)=>n.cameras[0].fov=.9,(n:any)=>n.program.materials[0].roughness=.5,(n:any)=>n.assumptions.push('已修好'),(n:any)=>n.program.instances[1].position[0]=1]){
  const n=structuredClone(s);mutate(n);expect(()=>assertPlannedRepair(s,n,p)).toThrow('修正目标');
 }
 const n=structuredClone(s);n.program.instances[0].position[0]=1;n.program.templates.push({...n.program.templates[0],id:'unplanned'});expect(()=>assertPlannedRepair(s,n,p)).toThrow('未选择新增几何');
});
test('空目标是停止信号，不触发无依据修改；每个目标必须分别落实',()=>{
 const p=selection();p.goals=[];expect(()=>validateRepairGoals(p,scene(),plan,1,frames)).toThrow(NoActionableChange);
 const two=selection();two.goals.push({...structuredClone(two.goals[0]),id:'G2',instanceIds:['object1']});validateRepairGoals(two,scene(),plan,1,frames);
 const n=scene();n.program.instances[0].position[0]=1;expect(()=>assertPlannedRepair(scene(),n,two)).toThrow('G2');n.program.instances[1].position[1]=1;expect(assertPlannedRepair(scene(),n,two).changes.instanceIds).toHaveLength(2);
});
test('只有已选择的开口进入专门修正，其他几何诊断不自动抢占本轮',()=>{
 const s=scene(),report:any={checks:[{id:'small',instanceId:'object0',status:'missing-background',blockers:{}},{id:'large',instanceId:'object1',status:'missing-background',blockers:{}}]};
 expect(refinementFocus(s,report,[])?.targets).toBeUndefined();expect(refinementFocus(s,report,['large'])!.targets.map(t=>t.id)).toEqual(['large']);
 const p=selection();p.goals[0].kind='opening';expect(()=>validateRepairGoals(p,s,plan,1,frames)).toThrow('开口目标');
});
test('表面和光照目标需对应真实变化；权重只决定优先级而非伪造分数',()=>{
 const s=scene(),p=selection();p.goals[0]={...p.goals[0],kind:'surface',dimension:'material',instanceIds:[],materialIds:['base']};validateRepairGoals(p,s,plan,1,frames);
 const n=structuredClone(s);n.program.materials[0].roughness=.6;expect(assertPlannedRepair(s,n,p).changes.materialIds).toEqual(['base']);
 p.goals[0]={...p.goals[0],kind:'lighting',materialIds:[]};validateRepairGoals(p,s,plan,1,frames);expect(()=>assertPlannedRepair(s,s,p)).toThrow('G1');const lit=structuredClone(s);lit.lighting.intensity=2;expect(assertPlannedRepair(s,lit,p).lighting).toBe(true);
 expect(REPAIR_GOALS_PROMPT).toContain('权重不允许改变真实评分');expect(REPAIR_GOALS_PROMPT).not.toContain('餐厅');
});
test('模型新角色使用严格契约，最多三个目标，不扩大原几何预算',()=>{
 expect(modelSchema('scene-repair-plan')).toEqual(repairGoalsSchema());
 const walk=(s:any)=>{if(s.type==='object'){expect(s.additionalProperties).toBe(false);expect(s.required).toEqual(Object.keys(s.properties));Object.values(s.properties).forEach(walk)}if(s.items)walk(s.items);s.anyOf?.forEach(walk)};walk(repairGoalsSchema());
 const p=selection();p.goals=Array.from({length:4},(_,i)=>({...p.goals[0],id:'G'+i}));expect(()=>validateRepairGoals(p,scene(),plan,1,frames)).toThrow('最多三个');
});
test('输出契约绑定实际ID和帧名，空类型不可臆造对象；地面不计入实体预算',()=>{
 const s=scene(),known=repairGoalReferences(s,plan,1,frames),schema=modelSchema('scene-repair-plan',{repairReferences:known}),g=schema.properties.goals.items.anyOf.find((v:any)=>v.properties.kind.enum[0]==='layout').properties;
 expect(g.instanceIds.items.enum).toEqual(['object0','object1']);expect(g.templateIds.items.enum).toEqual(['main','other']);expect(g.openingIds.maxItems).toBe(0);
 expect(g.evidence.items.properties.frame.enum).toEqual(frames);expect(g.evidence.items.properties.referenceIndex.enum).toEqual([1]);
 const noImage=repairGoalsSchema({...known,referenceCount:0});expect(noImage.properties.goals.items.anyOf[0].properties.evidence.items.properties.referenceIndex.type).toBe('null');
 s.entities.push({instanceId:'floor',role:'ground',category:'地面'});expect(repairGoalContext(s).budgetedEntityCount).toBe(2);
});

test('目标类型的字段约束提前进入输出格式，避免重复整轮规划后再纠正',()=>{
 const known={...repairGoalReferences(scene(),plan,1,frames),openingIds:['opening_a']},s=repairGoalsSchema(known);
 const choices=s.properties.goals.items.anyOf;
 expect(choices).toHaveLength(6);
 for(const v of choices){const p=v.properties,kind=p.kind.enum[0];
  expect(p.requirementIds.minItems).toBe(1);expect(p.evidence.minItems).toBe(1);
  if(kind==='opening'){expect(p.openingIds.minItems).toBe(1);expect(p.openingIds.items.enum).toEqual(['opening_a']);expect(p.cameraNames.maxItems).toBe(0);expect(p.materialIds.maxItems).toBe(0);}
  else expect(p.openingIds.maxItems).toBe(0);
  if(!['geometry','opening'].includes(kind))expect(p.addGeometry.enum).toEqual([false]);
  if(kind==='surface')expect(p.materialIds.minItems).toBe(1);if(kind==='camera')expect(p.cameraNames.minItems).toBe(1);
 }
 const noOpenings=repairGoalsSchema({...known,openingIds:[]});expect(noOpenings.properties.goals.items.anyOf.some((v:any)=>v.properties.kind.enum[0]==='opening')).toBe(false);
});

function texturedScene(){const s=scene();s.textures=[{id:'paint',referenceIndex:1,quad:[[0,0],[.1,0],[.1,.1],[0,.1]],size:256,description:'局部表面'}];s.program.materials[0].textureId='paint';s.textureReuse=[{textureId:'paint',assetId:'a'.repeat(64),reason:'已存表面'}];return s;}
test('结构目标已选材质允许贴图修正，无关共享材质仍受保护',()=>{
 const s=texturedScene(),p=selection();p.goals[0].kind='geometry';p.goals[0].templateIds=['main'];p.goals[0].materialIds=['base'];
 const n=structuredClone(s);n.program.templates[0].parts[0].position=[.2,0,0];n.textures[0].description='修正裁切';n.textureReuse=[];
 expect(assertPlannedRepair(s,n,p).changedTextureIds).toEqual(['paint']);
 s.program.materials.push({...s.program.materials[0],id:'shared'});n.program.materials.push({...s.program.materials[1]});
 expect(()=>assertPlannedRepair(s,n,p)).toThrow('已选材质范围');
 n.textures[0]=structuredClone(s.textures[0]);n.textureReuse=structuredClone(s.textureReuse);n.textures.push({...n.textures[0],id:'independent',description:'独立裁切'});n.program.materials[0].textureId='independent';
 expect(assertPlannedRepair(s,n,p).changedTextureIds).toEqual(['independent']);
});
test('有表面目标或新增几何也不能放开其他既有材质和纹理',()=>{
 const s=texturedScene(),p=selection();p.goals[0].addGeometry=true;p.goals[0].kind='geometry';const n=structuredClone(s);n.program.instances[0].position[0]=1;n.textureReuse=[];
 expect(()=>assertPlannedRepair(s,n,p)).toThrow('已选材质范围');
 p.goals[0].addGeometry=false;p.goals.push({...structuredClone(p.goals[0]),id:'surface',kind:'surface',materialIds:['other']});
 expect(()=>assertPlannedRepair(s,n,p)).toThrow('已选材质范围');
});
test('各表面目标必须改变本目标的材质或贴图，不能借其他表面通过',()=>{
 const s=texturedScene();s.program.materials.push({...s.program.materials[0],id:'plain',textureId:null});
 const p=selection();p.goals[0]={...p.goals[0],kind:'surface',instanceIds:[],materialIds:['base']};p.goals.push({...structuredClone(p.goals[0]),id:'surface2',materialIds:['plain']});
 const n=structuredClone(s);n.textureReuse=[];expect(()=>assertPlannedRepair(s,n,p)).toThrow('surface2');n.program.materials[1].roughness=.7;expect(assertPlannedRepair(s,n,p).changedTextureIds).toEqual(['paint']);
});
