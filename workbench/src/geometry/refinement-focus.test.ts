import {test,expect} from 'bun:test';
import {refinementFocus,assertRefinementFocus,FOCUSED_REFINEMENT_PROMPT} from './refinement-focus';
import {applyRefinement} from './refinement';
const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};
const box=(id:string,position:number[],size:number[])=>({...pose,id,position,material:'base',shape:{type:'box',size,radius:0}});
function scene():any{return {version:'scene-v1',program:{version:'geometry-v1',name:'通透结构',materials:[{id:'base',color:[.5,.5,.5,1],roughness:.8,metallic:0,textureId:null}],templates:[{id:'frame',parts:[box('left',[-1.1,0,1.5],[.2,.3,3]),box('right',[1.1,0,1.5],[.2,.3,3]),box('lintel',[0,0,2.9],[2,.3,.2])]}],instances:[{...pose,id:'entry',label:'通透结构',template:'frame',requirementIds:['R1']}]},entities:[{instanceId:'entry',category:'结构',role:'subject'}],cameras:[{name:'参考',referenceIndex:1,position:[0,-4,2],target:[0,0,1.5],fov:1},{name:'检查',referenceIndex:null,position:[3,-4,2],target:[0,0,1.5],fov:1}],textures:[],textureReuse:[],lighting:{direction:[0,1,-1],color:[1,1,1],intensity:1,ambientColor:[1,1,1],ambientIntensity:.3,points:[]},assumptions:[],spatialOpenings:[{id:'portal',label:'通透区域',instanceId:'entry',center:[0,-.15,1.5],normal:[0,1,0],up:[0,0,1],width:1.6,height:2,clearDepth:.8,expectedBeyond:'geometry',beyondDescription:'有纵深的后部空间',referenceIndices:[1],evidence:'参考可见通透结构，距离为推断'}]};}
const solved=(s:any)=>{const n=structuredClone(s);n.program.templates[0].parts.push(box('back',[0,2,1.5],[3,.2,3]));return n;};
test('真实网格选择缺口；空天、缺声明和已合格场景不强制增加几何',()=>{
 const s=scene(),before=JSON.stringify(s),f=refinementFocus(s)!;
 expect(f.targets.map(c=>c.id)).toEqual(['portal']);expect(f.editableTemplateIds).toEqual(['frame']);expect(f.fixedOpeningInstanceIds).toEqual(['entry']);
 expect(refinementFocus(solved(s))).toBeNull();s.spatialOpenings[0].expectedBeyond='open-background';expect(refinementFocus(s)).toBeNull();delete s.spatialOpenings;expect(refinementFocus(s)).toBeNull();expect(JSON.parse(before).program).toEqual(s.program);
});
test('只改说明、只有窄柱或近处封堵，均不能充当完整后景修复',()=>{
 const s=scene(),f=refinementFocus(s)!;expect(()=>assertRefinementFocus(s,s,f)).toThrow('目标尚未落实');
 const narrow=structuredClone(s);narrow.program.templates[0].parts.push(box('pillar',[0,2,1.5],[.1,.2,3]));expect(()=>assertRefinementFocus(s,narrow,f)).toThrow('目标尚未落实');
 const blocked=structuredClone(s);blocked.program.templates[0].parts.push(box('cover',[0,.2,1.5],[3,.2,3]));expect(()=>assertRefinementFocus(s,blocked,f)).toThrow('目标尚未落实');
 expect(assertRefinementFocus(s,solved(s),f).checks[0].emptyBeyondFraction).toBe(0);
});
test('相机、开口坐标、原资源与固定实例不能改变以绕过诊断',()=>{
 const s=scene(),f=refinementFocus(s)!;
 for(const mutate of [(n:any)=>n.cameras[0].position[0]=8,(n:any)=>n.spatialOpenings[0].width=.1,(n:any)=>n.program.instances[0].position[0]=8,(n:any)=>n.program.materials[0].color[3]=.1]){
  const n=solved(s);mutate(n);expect(()=>assertRefinementFocus(s,n,f)).toThrow('空间缺陷修正');
 }
 const before=JSON.stringify(s);assertRefinementFocus(s,solved(s),f);expect(JSON.stringify(s)).toBe(before);
});
test('跨实例遮挡按真实网格归属处理，清除障碍仍需保留开口后景',()=>{
 const s=solved(scene());s.program.templates.push({id:'obstacle',parts:[box('cover',[0,.3,1.5],[3,.2,3])]});s.program.instances.push({...pose,id:'blocker',label:'可移动物体',template:'obstacle',requirementIds:['R1']});
 const f=refinementFocus(s)!;expect(f.targets[0].status).toBe('blocked');expect(f.editableTemplateIds).toEqual(['frame','obstacle']);expect(f.movableInstanceIds).toEqual(['blocker']);
 const n=structuredClone(s);n.program.instances[1].position=[6,0,0];expect(assertRefinementFocus(s,n,f).checks[0].status).toBe('clear');
});
test('移除有依据的错误遮挡实例仍验证后景，宿主与无关实体不得移除',()=>{
 const s=solved(scene());s.program.templates.push({id:'obstacle',parts:[box('cover',[0,.3,1.5],[3,.2,3])]});s.program.instances.push({...pose,id:'blocker',label:'错误遮挡物',template:'obstacle',requirementIds:[]});s.entities.push({instanceId:'blocker',category:'遮挡物',role:'context'});
 const focus=refinementFocus(s)!,n=structuredClone(s);n.program.instances=n.program.instances.filter((i:any)=>i.id!=='blocker');n.entities=n.entities.filter((i:any)=>i.instanceId!=='blocker');expect(assertRefinementFocus(s,n,focus).checks[0].status).toBe('clear');
 const wrong=structuredClone(s);wrong.program.instances=wrong.program.instances.filter((i:any)=>i.id!=='entry');wrong.entities=wrong.entities.filter((i:any)=>i.instanceId!=='entry');expect(()=>assertRefinementFocus(s,wrong,focus)).toThrow('固定实例');
});
test('修复目标不能破坏另一个原本正常的开口',()=>{
 const s=scene();s.program.templates[0].parts.push(box('second_back',[5,2,1.5],[3,.2,3]));s.spatialOpenings.push({...s.spatialOpenings[0],id:'second',center:[5,-.15,1.5]});const f=refinementFocus(s)!;expect(f.targets).toHaveLength(1);
 const n=solved(s);n.program.templates[0].parts.push(box('wrong_cover',[5,0,1.5],[3,.2,3]));expect(()=>assertRefinementFocus(s,n,f)).toThrow('新的严重');
});
test('正常增量契约与焦点检查共同执行，未改模板保留且不放宽原复杂度',()=>{
 const s=scene();s.program.templates.push({id:'decoration',parts:[box('small',[5,0,0],[.3,.3,.3])]});s.program.instances.push({...pose,id:'decor',label:'配套',template:'decoration',requirementIds:[]});s.entities.push({instanceId:'decor',category:'装饰',role:'context'});
 const f=refinementFocus(s)!,p={version:'scene-refinement-v1',reason:'补上原图要求的后部结构',instances:[],cameras:[],materials:[],parts:[{templateId:'frame',part:box('back',[0,2,1.5],[3,.2,3])}],removeParts:[],addTemplates:[],addEntities:[],textures:[],textureReuse:[],lighting:null,assumptions:[]};
 const n=applyRefinement(s,p,{requirements:[{id:'R1',critical:true,count:null}]},1,'simple');expect(assertRefinementFocus(s,n,f).checks[0].status).toBe('clear');n.program.templates[1].parts[0].position[0]=6;expect(()=>assertRefinementFocus(s,n,f)).toThrow('无关模板');
 expect(FOCUSED_REFINEMENT_PROMPT).not.toContain('餐厅');expect(FOCUSED_REFINEMENT_PROMPT).toContain('全部需求独立验收');
});
