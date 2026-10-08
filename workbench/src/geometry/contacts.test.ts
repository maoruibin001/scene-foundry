import {test,expect} from 'bun:test';
import {inspectContacts,contactSummary,assetContacts,validateContacts,validateContactBounds,triangleDistanceSquared,type SpatialContact} from './contacts';
import {transformPoint,type GeometryProgram} from './program';
import {validateAsset,assembleScene} from './layout';
import {applySurface,spaceSchema} from './layout-stages';
import {assetInput} from './asset-input';
import {assertCheckpointSpace} from './checkpoint-space';

const pose={position:[0,0,0] as [number,number,number],rotation:[0,0,0] as [number,number,number],scale:[1,1,1] as [number,number,number]};
const box=(id:string,size=[2,2,2],position=[0,0,0])=>({...pose,id,position:position as any,material:'stone',shape:{type:'box' as const,size:size as any,radius:0}});
const contact:SpatialContact={id:'joint',label:'连续构件接缝',kind:'seam',aId:'left',bId:'right',points:[[1,-.5,0],[1,.5,0]],referenceIndices:[],evidence:'文字明确要求相接；尺寸为测试设定'};
function scene(){const program:GeometryProgram={version:'geometry-v1',name:'连续构件',materials:[{id:'stone',color:[.5,.5,.5,1],roughness:.8,metallic:0,textureId:null}],templates:[{id:'first',parts:[box('body')]},{id:'second',parts:[box('body')]}],instances:[{...pose,id:'left',template:'first',position:[-1,0,1],label:'左构件',requirementIds:[]},{...pose,id:'right',template:'second',position:[1,0,1],label:'右构件',requirementIds:[]}]};return {program,spatialContacts:[structuredClone(contact)]};}
const briefs=()=>['first','second'].map(id=>({id,label:id,description:'真实实体连接',origin:'几何中心',bounds:{min:[-1,-1,-1],max:[1,1,1]},maxParts:8,materialIds:['stone']}));
test('共享接口从一侧局部坐标推导到另一侧，实际贴合与边界内缩的留缝可区分',()=>{
 const s=scene();expect(assetContacts(s,'second')[0].localPoints).toEqual([[-1,-.5,0],[-1,.5,0]]);
 expect(inspectContacts(s).checks[0].status).toBe('connected');
 s.program.templates[1].parts=[box('body',[1.6,2,2],[.2,0,0])];
 const report=inspectContacts(s);expect(report.checks[0].status).toBe('gap');expect(report.checks[0].maximumDistanceMeters).toBeCloseTo(.4,8);
 expect(report.checks[0].samples.filter(s=>s.status==='gap').every(s=>s.instanceId==='right')).toBe(true);
 expect(contactSummary(report).checks[0].failedSamples).toHaveLength(2);
});
test('包围盒接触而表面缺失不能误报贴合；不移动原几何以伪造结果',()=>{
 const s=scene();s.program.templates[1].parts=[box('bottom',[2,2,.2],[0,0,-.9]),box('top',[2,2,.2],[0,0,.9])];
 const original=JSON.stringify(s);expect(inspectContacts(s).checks[0].maximumDistanceMeters).toBeCloseTo(.8,8);expect(JSON.stringify(s)).toBe(original);
});
test('旋转和非均匀缩放后按世界米制距离检查，另一实例缺失不被单资产预览误归因',()=>{
 const s=scene(),group={position:[7,-3,4] as any,rotation:[.3,.2,1.2] as any,scale:[.7,2,1.3] as any};
 s.program.instances=s.program.instances.map(i=>({...i,position:transformPoint(i.position,group),rotation:group.rotation,scale:group.scale}));
 expect(inspectContacts(s).checks[0].status).toBe('connected');
 const partial={...s,program:{...s.program,templates:[s.program.templates[0]]}};
 const own=inspectContacts(partial,{assetTemplateId:'first'});expect(own.checks[0].status).toBe('connected');expect(own.checks[0].samples.every(s=>s.instanceId==='left')).toBe(true);
 validateContactBounds(s.spatialContacts,s.program.instances,briefs());
 s.program.templates[1].parts=[box('body',[1.6,2,2],[.2,0,0])];expect(inspectContacts(s).checks[0].maximumDistanceMeters).toBeCloseTo(.28,7);
});
test('无参考依据的接近不强迫粘连；旧记录、显式空数组与透明表面分别表述',()=>{
 const s=scene();expect(inspectContacts({program:s.program}).status).toBe('not-declared');expect(inspectContacts({...s,spatialContacts:[]}).status).toBe('not-applicable');
 s.program.materials[0].color[3]=.3;expect(inspectContacts(s).checks[0].samples.every(s=>s.status==='missing-surface')).toBe(true);
});
test('错误身份、虚构参考、重复接缝点和越界连接在空间规划阶段明确拒绝',()=>{
 const s=scene();validateContacts(s.spatialContacts,s.program.instances,0);validateContactBounds(s.spatialContacts,s.program.instances,briefs());
 expect(()=>validateContacts([{...contact,bId:'absent'}],s.program.instances,0)).toThrow('实例');
 expect(()=>validateContacts([contact],s.program.instances,1)).toThrow('参考');
 expect(()=>validateContacts([{...contact,points:[[1,0,0],[1,0,0]]}],s.program.instances,0)).toThrow('重复');
 expect(()=>validateContactBounds([{...contact,points:[[-1,0,0]]}],s.program.instances,briefs())).toThrow('right');
 expect(()=>validateContactBounds([{...contact,points:[[2,0,0]]}],s.program.instances,briefs())).toThrow('left');
});
test('冻结连接贯穿材质、资产、组装及恢复检查；接缝疑点保留可评分产物',()=>{
 const s=scene(),templates=briefs(),plan={requirements:[]};
 const space:any={version:'scene-space-v1',...s,program:{...s.program,templates:templates.map(({materialIds,...brief})=>brief)},entities:[{instanceId:'left',role:'subject',category:'构件'},{instanceId:'right',role:'context',category:'构件'}],cameras:[{name:'前方',referenceIndex:null,position:[0,-5,3],target:[0,0,1],fov:1},{name:'侧方',referenceIndex:null,position:[5,0,3],target:[0,0,1],fov:1}],assumptions:['尺度为推断']};delete space.program.materials;
 const surface:any={version:'scene-surface-v1',materials:s.program.materials,textures:[],bindings:templates.map(t=>({templateId:t.id,materialIds:t.materialIds})),lighting:{direction:[0,1,-1],color:[1,1,1],intensity:1,ambientColor:[1,1,1],ambientIntensity:.5,points:[]},assumptions:[]};
 const layout=applySurface(space,surface,plan,0,'simple');expect(spaceSchema().required).toContain('spatialContacts');expect(layout.spatialContacts).toEqual(space.spatialContacts);
 expect(assetInput('连接构件',plan,layout,layout.program.templates[1],{}).spatialContacts[0].localPoints[0]).toEqual([-1,-.5,0]);
 const assets:any[]=s.program.templates.map(template=>({version:'asset-geometry-v1',template}));assets[1].template.parts=[box('body',[1.6,2,2],[.2,0,0])];
 const measured=validateAsset(assets[1],layout.program.templates[1],layout,{});expect(measured.contacts.checks[0].status).toBe('gap');
 const assembled=assembleScene(layout,assets,plan,0);expect(assembled.spatialContacts).toEqual(space.spatialContacts);expect(inspectContacts(assembled).checks[0].status).toBe('gap');
 expect(()=>assertCheckpointSpace(space,layout)).not.toThrow();const changed=structuredClone(space);changed.spatialContacts[0].points[0][1]=-.7;expect(()=>assertCheckpointSpace(changed,layout)).toThrow('不一致');
});
test('重复模板的每个连接实例分别收到其局部约束',()=>{
 const s=scene();s.program.instances[1].template='first';s.program.templates.pop();const inputs=assetContacts(s,'first');expect(inputs.map(c=>c.instanceId)).toEqual(['left','right']);expect(inputs[1].localPoints[0][0]).toBe(-1);
 expect(inspectContacts(s).checks[0].status).toBe('connected');
});
test('最近表面距离覆盖面内、边、顶点和退化三角形',()=>{
 const a:any=[0,0,0],b:any=[2,0,0],c:any=[0,2,0];expect(triangleDistanceSquared([.5,.5,1],a,b,c)).toBeCloseTo(1,10);
 expect(triangleDistanceSquared([2,2,0],a,b,c)).toBeCloseTo(2,10);expect(triangleDistanceSquared([-1,0,0],a,b,c)).toBe(1);
 expect(triangleDistanceSquared([1,1,0],a,b,b)).toBe(1);expect(triangleDistanceSquared([1,0,0],a,a,a)).toBe(1);
});
