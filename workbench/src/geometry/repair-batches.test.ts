import {test,expect} from 'bun:test';
import {repairExecutionContext,repairBatches,repairSourceContext,mergeRefinementPatches,repairPlanningContext} from './repair-batches';
const source:any={assumptions:[],program:{templates:[],instances:[{id:'i1',template:'a'},{id:'i2',template:'b'}],materials:[{id:'m1',textureId:'t'},{id:'m2',textureId:'t'}]},cameras:[{name:'参考机位'}]};
const goal=(id:string,props:any={})=>({id,kind:'geometry',templateIds:[id],instanceIds:[],materialIds:[],cameraNames:[],addGeometry:false,...props});
const patch=(id:string)=>({version:'scene-refinement-v3',reason:'实际画面差异',instances:[],cameras:[],materials:[],removeInstances:[],parts:[{templateId:id,part:{id:'surface'}}],removeParts:[],addTemplates:[],addEntities:[],textures:[],textureReuse:[],lighting:null,assumptions:[]});
test('独立资产可并行，共用模板、实例引用与共享纹理必须合并',()=>{
 expect(repairBatches({goals:[goal('a'),goal('b')]},source)).toHaveLength(2);
 expect(repairBatches({goals:[goal('a'),goal('x',{instanceIds:['i1']})]},source)).toHaveLength(1);
 expect(repairBatches({goals:[goal('a',{materialIds:['m1']}),goal('b',{materialIds:['m2']})]},source)).toHaveLength(1);
});
test('跨目标传递依赖与空间调整不会错误分片',()=>{
 expect(repairBatches({goals:[goal('a'),goal('b'),goal('c',{templateIds:['a','b']})]},source)).toHaveLength(1);
 expect(repairBatches({goals:[goal('a',{kind:'layout'}),goal('b',{kind:'camera'})]},source)).toHaveLength(1);
});
test('结构目标改机位时，依赖投影的独立几何必须联动；独立表面继续并行',()=>{
 const selection={goals:[goal('structure',{cameraNames:['参考机位']}),goal('lamps'),goal('fabric',{kind:'surface',materialIds:[]})]},original=JSON.stringify(selection);
 const groups=repairBatches(selection,source);
 expect(groups).toHaveLength(2);
 expect(groups.find(b=>b.goals.some(g=>g.id==='structure'))!.goals.map(g=>g.id)).toEqual(['structure','lamps']);
 expect(groups.find(b=>b.goals.some(g=>g.id==='fabric'))!.goals).toHaveLength(1);
 expect(JSON.stringify(selection)).toBe(original);
});
test('明确机位目标与几何联动；不改机位时保持独立资产并行',()=>{
 expect(repairBatches({goals:[goal('camera',{kind:'camera',templateIds:[],cameraNames:['参考机位']}),goal('a'),goal('b')]},source)).toHaveLength(1);
 expect(repairBatches({goals:[goal('a'),goal('b')]},source)).toHaveLength(2);
});
test('缩小可编辑上下文但保留冻结物件的范围、实例和相机',()=>{
 const anchors=[{id:'a',parts:[1,2],meshBounds:{min:[0,0,0],max:[1,1,1]}},{id:'b',parts:[3,4,5],meshBounds:{min:[2,0,0],max:[3,1,1]}}];
 const before=JSON.stringify(source),v=repairSourceContext(source,anchors,{goals:[goal('a')]});
 expect(v.program.templates).toEqual([anchors[0]]);expect(v.frozenTemplates[0]).toEqual({id:'b',meshBounds:anchors[1].meshBounds,partCount:3});
 expect(v.program.instances).toEqual(source.program.instances);expect(v.cameras).toEqual(source.cameras);expect(JSON.stringify(source)).toBe(before);
});
test('合并独立补丁保留所有更改，拒绝覆盖和重复光照',()=>{
 expect(mergeRefinementPatches([patch('a'),patch('b')]).parts).toHaveLength(2);
 expect(()=>mergeRefinementPatches([patch('a'),patch('a')])).toThrow('冲突');
 expect(()=>mergeRefinementPatches([{...patch('a'),lighting:{}},{...patch('b'),lighting:{}}])).toThrow('lighting');
 expect(()=>mergeRefinementPatches([])).toThrow('为空');
});

test('规划摘要保留全部对象身份与非正常开口，不传入冗余细部，不修改原证据',()=>{
 const input={scene:{instances:[{id:'主体',position:[.123456,0,0]}],spatialOpenings:[{id:'门',label:'门',instanceId:'主体',expectedBeyond:'geometry',referenceIndices:[1],width:1.123456,evidence:'完整来源'}],openingDiagnostics:{checks:[{id:'正常',status:'clear'},{id:'门',status:'blocked',blockedFraction:.123456}]}},geometryVisibility:{views:[{cameraName:'原机位',referenceIndex:1,instances:[{number:1,frameFraction:.12345,visibleParts:[{partId:'表面',materialId:'颜色',rect:[0,0,1,1]}]}],instanceOcclusions:[{front:[1,'表面'],behind:[2,'后景']}],nearestPartOcclusions:[1,2,3]}]}};
 const before=JSON.stringify(input),c=repairPlanningContext(input);
 expect(c.scene.openingDiagnostics.clearCount).toBe(1);expect(c.scene.openingDiagnostics.checks.map(x=>x.id)).toEqual(['门']);
 expect(c.scene.spatialOpenings[0]).toMatchObject({id:'门',instanceId:'主体'});expect(c.scene.spatialOpenings[0]).not.toHaveProperty('width');
 expect(c.geometryVisibility.views[0].instances[0].visibleMaterials).toEqual(['颜色']);expect(c.geometryVisibility.views[0].instanceOcclusions).toEqual(input.geometryVisibility.views[0].instanceOcclusions);
 expect(c.scene.instances[0].position[0]).toBe(.1235);expect(JSON.stringify(input)).toBe(before);
});

test('表面与几何并行写入同一部件时拒绝合并，独立表面保留',()=>{
 const surface={...patch('b'),parts:[],surfaceUpdates:[{templateId:'a',partId:'surface',material:null,uvScale:[2,2],uvTransform:null,smoothAngle:null}]};
 expect(()=>mergeRefinementPatches([patch('a'),surface])).toThrow('表面与几何');
 expect(mergeRefinementPatches([patch('b'),surface]).surfaceUpdates).toHaveLength(1);
});

 test('表面目标只省略网格顶点，完整几何修复保留顶点且不改源输入',()=>{
 const anchors=[{id:'a',parts:[{id:'布面',shape:{type:'grid',rows:2,columns:2,points:[[0,0,0],[1,0,0],[0,1,0],[1,1,0]],doubleSided:true}}]}];
 const before=JSON.stringify(anchors),surface=repairSourceContext(source,anchors,{goals:[goal('a',{kind:'surface'})]});
 expect(surface.surfaceOnly).toBe(true);expect(surface.program.templates[0].parts[0].shape).toMatchObject({pointCount:4,pointsOmitted:true});expect(surface.program.templates[0].parts[0].shape).not.toHaveProperty('points');
 expect(repairSourceContext(source,anchors,{goals:[goal('a')]}).program.templates[0].parts[0].shape.points).toHaveLength(4);expect(JSON.stringify(anchors)).toBe(before);
 });

test('混合材质与几何目标不附带表面对象的密集网格，几何目标仍保留必要数据',()=>{
 const points=Array.from({length:5000},(_,i)=>[i*.01,1,2]),anchors=[{id:'a',parts:[{id:'books',material:'wood',position:[1,2,3],shape:{type:'grid',rows:50,columns:100,points}}]},{id:'b',parts:[{id:'ceiling',shape:{type:'box',size:[5,4,3]}}]}],before=JSON.stringify(anchors);
 const out=repairSourceContext(source,anchors,{goals:[goal('a',{kind:'surface'}),goal('b')]});
 expect(out.surfaceOnly).toBe(false);expect(out.program.templates[0].parts[0].shape).not.toHaveProperty('points');expect(out.program.templates[0].parts[0].shape.pointBounds).toEqual({min:[0,1,2],max:[49.99,1,2]});expect(out.program.templates[1].parts[0]).toEqual(anchors[1].parts[0]);
 expect(JSON.stringify(out).length).toBeLessThan(before.length/10);expect(JSON.stringify(anchors)).toBe(before);expect(out.program.instances).toEqual(source.program.instances);expect(out.program.materials).toEqual(source.program.materials);expect(out.cameras).toEqual(source.cameras);
});
test('大几何与解析别名可按需读取，摘要不改源几何与精确变换',()=>{
 const shape={type:'grid',rows:100,columns:100,points:Array.from({length:10000},()=>[.123456789,0,1])},p={id:'grid',shape,geometry:shape,op:'grid',position:[.123456789,0,1]},anchors=[{id:'a',parts:[p]}],before=JSON.stringify(p);
 const out=repairSourceContext(source,anchors,{goals:[goal('a')]});const v=out.program.templates[0].parts[0];expect(v.geometryReadRequired).toBe(true);expect(v.sourcePartSha256).toHaveLength(64);expect(v.position).toEqual(p.position);expect(v).not.toHaveProperty('geometry');expect(JSON.stringify(p)).toBe(before);
});

test('规划合并重复的逐部件实例绑定，保留每个部件身份和覆盖范围',()=>{const bindings=[{id:'m',textureId:null,parts:[{templateId:'t',partId:'p1',shape:'box',uvScale:[1,1],instances:[{id:'i',override:null}]},{templateId:'t',partId:'p2',shape:'grid',uvScale:[2,1],instances:[{id:'i',override:null}]}]}];const input={surfaceBindings:bindings},before=JSON.stringify(input),out=repairPlanningContext(input);expect(out.surfaceBindings[0].templates[0]).toMatchObject({templateId:'t',partIds:['p1','p2'],shapes:['box','grid'],instances:[{id:'i',override:null}]});expect(JSON.stringify(input)).toBe(before);});

test('有限调用合并独立组而非丢目标，耦合组不能拆开',()=>{
 const selection={goals:[goal('a'),goal('b'),goal('c'),goal('d'),goal('e',{templateIds:['a','b']})]},old=JSON.stringify(selection);
 const batches=repairBatches(selection,source,2);expect(batches).toHaveLength(2);
 expect(batches.flatMap(b=>b.goals.map(g=>g.id)).sort()).toEqual(['a','b','c','d','e']);
 const coupled=batches.find(b=>b.goals.some(g=>g.id==='a'))!;expect(coupled.goals.map(g=>g.id)).toContain('b');expect(coupled.goals.map(g=>g.id)).toContain('e');expect(JSON.stringify(selection)).toBe(old);
 expect(repairBatches(selection,source,1)).toHaveLength(1);expect(()=>repairBatches(selection,source,0)).toThrow('额度');
});

test('执行上下文排除无关表面，但选中共享材质必须保留跨模板引用',()=>{
 const x={repairGoals:{goals:[goal('a',{materialIds:['shared']})]},sourceScene:source,surfaceBindings:[{id:'local',parts:[{templateId:'a',partId:'p'},{templateId:'b',partId:'q'}]},{id:'shared',parts:[{templateId:'a',partId:'s'},{templateId:'b',partId:'t'}]},{id:'unrelated',parts:[{templateId:'c',partId:'u'}]}]},old=JSON.stringify(x),v=repairExecutionContext(x);
 expect(v.surfaceBindings.map((m:any)=>m.id)).toEqual(['local','shared']);expect(v.surfaceBindings[0].parts).toHaveLength(1);expect(v.surfaceBindings[1].parts).toHaveLength(2);expect(v.sourceScene).toBe(x.sourceScene);expect(JSON.stringify(x)).toBe(old);
 const byInstance=repairExecutionContext({...x,repairGoals:{goals:[goal('only',{templateIds:[],instanceIds:['i2']})]}});expect(byInstance.surfaceBindings.map((m:any)=>m.parts[0].templateId)).toEqual(['b','b']);
 expect(repairExecutionContext({...x,repairGoals:{goals:[goal('light',{kind:'lighting'})]}}).surfaceBindings).toBe(x.surfaceBindings);
});

 test('全局光照和表面须在同一候选预览联合检查，避免彼此独立而反馈失真',()=>{const s={goals:[goal('fabric',{kind:'surface',materialIds:['m1']}),goal('light',{kind:'lighting',templateIds:[]})]};expect(repairBatches(s,source)).toHaveLength(1);expect(repairBatches({goals:[goal('a'),goal('b')]},source)).toHaveLength(2);});
