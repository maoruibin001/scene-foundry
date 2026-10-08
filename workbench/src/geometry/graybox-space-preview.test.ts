import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createGrayboxSpacePreview,GRAYBOX_SPACE_PREVIEW} from './graybox-space-preview';
import {applyGrayboxSpaceRepair,grayboxSpaceRepairSchema,GRAYBOX_SPACE_REPAIR} from './graybox-space-repair';
import {read,save,digest} from '../store';
import {stable} from '../validated-cache';
import {assertRoleTools,serveCodexTools,withToolContinuation} from '../codex-tools';
import {modelTimeoutPolicy} from '../model-selection';
import {callCodex} from '../codex-provider';
import {applyGrayboxLocalParts} from './graybox-local-parts';
import {compileGeometryProgram} from './program';

function fixture(){
 const folder=mkdtempSync(join(tmpdir(),'graybox-preview-')),controller=new AbortController();
 const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},space:any={version:'scene-space-v1',program:{version:'geometry-v1',name:'预览测试',templates:[{id:'tree',label:'植物',description:'冠层',origin:'根部',maxParts:8,bounds:{min:[-1,-1,0],max:[1,1,3]}}],instances:[{...pose,id:'front',label:'近景',template:'tree',position:[1,2,0],requirementIds:['r']}]},cameras:[{name:'参考',referenceIndex:null,position:[0,-3,1.5],target:[0,3,1.5],fov:1},{name:'检查',referenceIndex:null,position:[1,-3,1.5],target:[0,3,1.5],fov:1}],entities:[],spatialRelations:[{id:'rel',critical:true,instanceIds:['front']}],spatialContacts:[],spatialOpenings:[],assumptions:[]};
 const sourceScene={...space,version:'scene-v1',program:{...space.program,materials:[{id:'blockout',color:[.5,.5,.5,1],roughness:1,metallic:0,textureId:null}],templates:[{id:'tree',parts:[{...pose,position:[0,0,1.5],id:'crown',material:'blockout',shape:{type:'box',size:[1,1,1],radius:0}}]}]},textures:[],textureReuse:[]};
 const patch=(x=.5)=>({version:GRAYBOX_SPACE_REPAIR,reason:'实际近景冠层侵占通道，依据原图与真实灰模局部调整而不新增删除对象。',instances:[{id:'front',position:[x,2,0],rotation:[0,0,0],scale:[1,1,1]}],templates:[],parts:[],cameras:[],contacts:[],checks:[{relationIds:['rel'],evidence:'源帧显示冠层与步道有明显不当重叠',expectedChange:'实际候选中步道连续可读并保留两侧围合'}]});
 let renders=0,fail=false,badPose=false,cancel=false;
 const render:any=async(scene:any,_images:any,_refs:any,dir:string)=>{
  renders++;if(fail)throw Error('fixture renderer error');if(cancel){controller.abort();controller.signal.throwIfAborted();}
  mkdirSync(join(dir,'capture'),{recursive:true});
  const frames=scene.cameras.map((c:any,i:number)=>{const file=`candidate-${i+1}.png`,bytes=Buffer.alloc(32);Buffer.from('89504e470d0a1a0a','hex').copy(bytes);bytes.writeUInt32BE(1600,16);bytes.writeUInt32BE(900,20);bytes.writeUInt32BE(renders,24);writeFileSync(join(dir,'capture',file),bytes);return {file,referenceIndex:c.referenceIndex,sha256:digest(bytes),pose:{selectedView:badPose?99:i,position:[c.position[0],c.position[2],-c.position[1]],target:[c.target[0],c.target[2],-c.target[1]],fov:c.fov}};});
  save(join(dir,'engine-preview-receipt.json'),{sceneSha256:digest(JSON.stringify(scene)),frames,report:{consoleErrors:[],pageErrors:[]}});return [];
 };
 const options:any={contractVersion:"graybox-space-preview-v4",space,sourceScene,images:[],folder:join(folder,'review'),signal:controller.signal,schema:grayboxSpaceRepairSchema(),apply:(p:any)=>applyGrayboxSpaceRepair(space,p,v=>v),buildScene:(s:any,p:any)=>({...sourceScene,cameras:s.cameras,spatialContacts:s.spatialContacts,program:{...sourceScene.program,templates:applyGrayboxLocalParts(sourceScene,s,p.parts).templates,instances:s.program.instances}}),render};
 return {folder,options,patch,controller,renders:()=>renders,setFail:()=>{fail=true},setBadPose:()=>{badPose=true},setCancel:()=>{cancel=true},close:()=>rmSync(folder,{recursive:true,force:true})};
}

test('真实预览仍冻结简报、语义与数量；超量坐标在渲染前拒绝且不耗额度',async()=>{
 const f=fixture();try{const t=createGrayboxSpacePreview(f.options);
  for(const p of [{...f.patch(),templates:[{id:'tree',description:'新冠层'}]},{...f.patch(),instances:[{...f.patch().instances[0],label:'新语义'}]},{...f.patch(),instances:[{...f.patch().instances[0],scale:[3,1,1]}]}])await expect(t.kit.call('preview_graybox_space',{patchJson:JSON.stringify(p)})).rejects.toThrow();
  expect(f.renders()).toBe(0);const schema=t.kit.definitions[0].inputSchema.properties.patchJson.description;expect(schema).toContain('"maxItems":0');
 }finally{f.close();}
});
test('最终只选择本轮已实际预览的补丁，保持模板和来源，伪造摘要或另改补丁均拒绝',async()=>{
 const f=fixture();try{const before=stable([f.options.space,f.options.sourceScene]),t=createGrayboxSpacePreview(f.options),p=f.patch();
  expect(()=>t.assertReviewed(p)).toThrow('GRAYBOX_PREVIEW_REQUIRED');expect(()=>t.kit.resolveOutput!({selectedPatchSha256:'a'.repeat(64),reason:'这是伪造的未实际运行候选摘要'})).toThrow('GRAYBOX_PREVIEW_REQUIRED');
  const result=await t.kit.call('preview_graybox_space',{patchJson:JSON.stringify(p)});expect(result.isError).not.toBe(true);expect(result.content.filter(x=>x.type==='image')).toHaveLength(2);
  const proof=t.assertReviewed(p);expect(t.kit.resolveOutput!({selectedPatchSha256:proof.patchSha256,reason:'观察两机位后保留实际候选并说明残留'})).toEqual(p);expect(()=>t.assertReviewed(f.patch(.4))).toThrow('GRAYBOX_PREVIEW_REQUIRED');
  expect(stable([f.options.space,f.options.sourceScene])).toBe(before);expect(read(join(f.options.folder,'1/scene.json')).program.templates).toEqual(f.options.sourceScene.program.templates);
 }finally{f.close();}
});
test('两次实际预览与候选图像在技术重试后保留，同候选不重复构建，来源变化拒绝恢复',async()=>{
 const f=fixture();try{let t=createGrayboxSpacePreview(f.options);for(const x of [.5,.4])await t.kit.call('preview_graybox_space',{patchJson:JSON.stringify(f.patch(x))});
  t=createGrayboxSpacePreview(f.options);const expanded=withToolContinuation({text:'原任务',images:[],tools:t.kit});expect(expanded.images).toHaveLength(4);expect(expanded.text).toContain('"used":2');
  await t.kit.call('preview_graybox_space',{patchJson:JSON.stringify(f.patch(.5))});expect(f.renders()).toBe(2);await expect(t.kit.call('preview_graybox_space',{patchJson:JSON.stringify(f.patch(.3))})).rejects.toThrow('上限');
  expect(()=>createGrayboxSpacePreview({...f.options,space:{...f.options.space,assumptions:['改变来源']}})).toThrow('契约');
 }finally{f.close();}
});
test('图片或回执被篡改时最终保存及恢复都拒绝，不能用先前成功标记放行',async()=>{
 for(const name of ['capture/candidate-1.png','engine-preview-receipt.json','patch.json']){const f=fixture();try{const t=createGrayboxSpacePreview(f.options);await t.kit.call('preview_graybox_space',{patchJson:JSON.stringify(f.patch())});writeFileSync(join(f.options.folder,'1',name),'tampered');expect(()=>t.assertReviewed(f.patch())).toThrow();expect(()=>createGrayboxSpacePreview(f.options)).toThrow();}finally{f.close();}}
});
test('失败渲染计入已用额度且不可选择；错误机位也不计为成功候选',async()=>{
 for(const mode of ['error','pose']){const f=fixture();try{mode==='error'?f.setFail():f.setBadPose();const t=createGrayboxSpacePreview(f.options),r=await t.kit.call('preview_graybox_space',{patchJson:JSON.stringify(f.patch())});expect(r.isError).toBe(true);expect(()=>t.assertReviewed(f.patch())).toThrow('GRAYBOX_PREVIEW_REQUIRED');expect(read(join(f.options.folder,'graybox-preview-audit.json')).used).toBe(1);}finally{f.close();}}
});
test('仅换理由或检查文案不消耗新预览；同画面失败无新改变时停止',async()=>{
 const f=fixture();try{const t=createGrayboxSpacePreview(f.options),p=f.patch();await t.kit.call('preview_graybox_space',{patchJson:JSON.stringify(p)});const words={...p,reason:p.reason+'另换一段说明但位置完全未变'};const r=await t.kit.call('preview_graybox_space',{patchJson:JSON.stringify(words)});expect(f.renders()).toBe(1);expect(JSON.parse((r.content[0] as any).text).patchSha256).toBe(digest(stable(p)));expect(()=>t.assertReviewed(words)).toThrow('GRAYBOX_PREVIEW_REQUIRED');}finally{f.close();}
 const g=fixture();try{g.setFail();const t=createGrayboxSpacePreview(g.options),p=g.patch();await t.kit.call('preview_graybox_space',{patchJson:JSON.stringify(p)});await expect(t.kit.call('preview_graybox_space',{patchJson:JSON.stringify({...p,reason:p.reason+'只换一句话'})})).rejects.toThrow('NO_NEW_CHANGE');expect(g.renders()).toBe(1);}finally{g.close();}
});
test('取消中断实际预览且持久化失败，不产生可选候选或重置额度',async()=>{
 const f=fixture();try{f.setCancel();const t=createGrayboxSpacePreview(f.options);await expect(t.kit.call('preview_graybox_space',{patchJson:JSON.stringify(f.patch())})).rejects.toThrow();const a=read(join(f.options.folder,'graybox-preview-audit.json'));expect(a.used).toBe(1);expect(a.attempts[0].status).toBe('failed');expect(()=>t.assertReviewed(f.patch())).toThrow('GRAYBOX_PREVIEW_REQUIRED');}finally{f.close();}
});
test('候选构建若偷偷替换局部几何，在实际渲染前拒绝',async()=>{
 const f=fixture();try{const build=f.options.buildScene;f.options.buildScene=(s:any,p:any)=>{const v=structuredClone(build(s,p));v.program.templates[0].parts[0].shape.size[0]=2;return v;};const t=createGrayboxSpacePreview(f.options);await expect(t.kit.call('preview_graybox_space',{patchJson:JSON.stringify(f.patch())})).rejects.toThrow('GEOMETRY_FROZEN');expect(f.renders()).toBe(0);}finally{f.close();}
});
test('专用灰模与资产上下文版本通过真实角色入口，但跨角色或未知工具保持拒绝',async()=>{
 const f=fixture();try{const t=createGrayboxSpacePreview(f.options);expect(()=>assertRoleTools('scene-space',t.kit)).not.toThrow();expect(()=>assertRoleTools('geometry-asset',t.kit)).toThrow('PROVIDER_TOOLS_INVALID');
  const asset:any={...t.kit,version:'asset-preview-context-v2',definitions:[{name:'preview_asset'}]};expect(()=>assertRoleTools('geometry-asset',asset)).not.toThrow();expect(()=>assertRoleTools('scene-space',asset)).toThrow('PROVIDER_TOOLS_INVALID');expect(()=>assertRoleTools('geometry-asset',{...asset,version:'unknown'})).toThrow('PROVIDER_TOOLS_INVALID');
  await expect(callCodex({role:'scene-space',system:'中文契约验证',text:'不启动模型',tools:t.kit},f.folder,'fixture-model',{})).rejects.toThrow('CODEX_ROUTE_UNVERIFIED');
  const server=serveCodexTools(t.kit);try{const arg=server.args.find(x=>x.startsWith('mcp_servers.scene_feedback.args='))!,[,url]=JSON.parse(arg.slice(arg.indexOf('=')+1));const list=await(await fetch(url,{method:'POST',body:JSON.stringify({method:'tools/list'})})).json();expect(list.tools.map((x:any)=>x.name)).toEqual(['preview_graybox_space','measure_graybox_space']);const other=await fetch(url,{method:'POST',body:JSON.stringify({method:'tools/call',params:{name:'preview_asset'}})});expect(other.status).toBe(400);}finally{server.close();}
 }finally{f.close();}
});
test('仅带实际灰模工具的空间修正增加渲染时间，初始规划和其他阶段时限不变且恢复仍有界',()=>{
 const p=modelTimeoutPolicy('high','scene-space',0,3600000,GRAYBOX_SPACE_PREVIEW);expect(p.timeoutMs).toBe(900000);expect(p.maxTimeoutMs).toBe(1800000);
 expect(modelTimeoutPolicy('high','scene-space').timeoutMs).toBe(300000);expect(modelTimeoutPolicy('high','scene-surface').timeoutMs).toBe(300000);expect(modelTimeoutPolicy('high','scene-space',1,90000,GRAYBOX_SPACE_PREVIEW).maxTimeoutMs).toBe(90000);
});

test('正常候选回传同机位构图残差，恢复和最终选择验证测量文件，篡改不能放行',async()=>{
 const f=fixture();try{
  f.options.space.cameras[0].referenceIndex=1;f.options.sourceScene.cameras[0].referenceIndex=1;
  f.options.sourceScene.observedBindings=[{landmarkId:'L1',instanceIds:['front']}];
  f.options.observation={landmarks:[{id:'L1',label:'近景',critical:true,views:[{referenceIndex:1,box:[.25,.25,.75,.75],extent:'occluded',evidence:'原图遮挡但仍有可见边缘'}]}],cameras:[{referenceIndex:1,contentRect:[0,0,1,1]}]};
  const t=createGrayboxSpacePreview(f.options),r=await t.kit.call('preview_graybox_space',{patchJson:JSON.stringify(f.patch())}),context=JSON.parse((r.content[0] as any).text).referenceComposition;
  expect(context.rows).toHaveLength(1);expect(context.rows[0].edgeResidual).toBeNumber();expect(context.rows[0].sourceDelta.wasVisible).toBe(true);expect(context.quality).toBe('not-assessed');expect(t.assertReviewed(f.patch()).compositionSha256).toHaveLength(64);
  expect(t.kit.continuation!().text).toContain('referenceComposition');
  const changed=structuredClone(f.options.observation);changed.landmarks[0].views[0].box=[.2,.25,.75,.75];expect(()=>createGrayboxSpacePreview({...f.options,observation:changed})).toThrow('契约');
  save(join(f.options.folder,'1/reference-composition.json'),{...context,quality:'passed'});expect(()=>t.assertReviewed(f.patch())).toThrow('构图测量');expect(()=>createGrayboxSpacePreview(f.options)).toThrow('构图测量');
 }finally{f.close();}
});

test('历史v2真实预览证据可只读重开，不能偷换成新构图测量或重置次数',async()=>{
 const f=fixture();try{const options={...f.options,contractVersion:'graybox-space-preview-v2'},t=createGrayboxSpacePreview(options);await t.kit.call('preview_graybox_space',{patchJson:JSON.stringify(f.patch())});const before=t.assertReviewed(f.patch());expect(before.compositionSha256).toBeUndefined();const opened=createGrayboxSpacePreview(options);expect(opened.assertReviewed(f.patch())).toEqual(before);expect(f.renders()).toBe(1);expect(()=>createGrayboxSpacePreview(f.options)).toThrow('契约');}finally{f.close();}
});

test('廉价几何测量最多四个候选且技术恢复不归零，不能把测量结果当实际预览选择',async()=>{
 const f=fixture();try{let t=createGrayboxSpacePreview(f.options);for(const x of [.5,.4,.3,.2]){const r=await t.kit.call('measure_graybox_space',{patchJson:JSON.stringify(f.patch(x))});expect(r.content).toHaveLength(1);expect(JSON.parse((r.content[0] as any).text).quality).toBe('geometry-prediction-only');}
  expect(f.renders()).toBe(0);expect(()=>t.assertReviewed(f.patch())).toThrow('PREVIEW_REQUIRED');
  t=createGrayboxSpacePreview(f.options);await t.kit.call('measure_graybox_space',{patchJson:JSON.stringify({...f.patch(),reason:f.patch().reason+'仅换说明'})});await expect(t.kit.call('measure_graybox_space',{patchJson:JSON.stringify(f.patch(.1))})).rejects.toThrow('四个候选');
  await t.kit.call('preview_graybox_space',{patchJson:JSON.stringify(f.patch())});expect(f.renders()).toBe(1);expect(read(join(f.options.folder,'graybox-preview-audit.json'))).toMatchObject({used:1,measured:4});expect(t.kit.continuation!().text).toContain('measurementUsed');
 }finally{f.close();}
});


test('部件局部编辑能独立改变冠体，形状、材质、数量、三角形与来源实例不改',()=>{
 const f=fixture();try{const source=f.options.sourceScene,before=stable(source),edits=[{templateId:'tree',partId:'crown',position:[.15,0,1.5],rotation:[0,0,.1],scale:[1.2,1,1]}];
  const local=applyGrayboxLocalParts(source,f.options.space,edits),next={...source.program,templates:local.templates};
  expect(local.changed).toEqual(['tree/crown']);expect(local.templates[0].parts[0].shape).toEqual(source.program.templates[0].parts[0].shape);expect(local.templates[0].parts[0].material).toBe('blockout');
  expect(compileGeometryProgram(next).triangles).toBe(compileGeometryProgram(source.program).triangles);expect(stable(source)).toBe(before);
 }finally{f.close();}
});
test('部件越界、超比例、不完整形状、未知身份、重复和超额度均在渲染前拒绝',async()=>{
 const f=fixture();try{const t=createGrayboxSpacePreview(f.options),base={templateId:'tree',partId:'crown',position:[.1,0,1.5],rotation:[0,0,0],scale:[1,1,1]},p={...f.patch(),instances:[]};
  const cases=[{...base,partId:'new'},{...base,shape:{type:'box'}},{...base,scale:[2.1,1,1]},{...base,position:[1,0,1.5]}];
  for(const edit of cases)await expect(t.kit.call('preview_graybox_space',{patchJson:JSON.stringify({...p,parts:[edit]})})).rejects.toThrow();
  for(const edits of [[base,base],Array.from({length:25},()=>base)])await expect(t.kit.call('preview_graybox_space',{patchJson:JSON.stringify({...p,parts:edits})})).rejects.toThrow();
  expect(f.renders()).toBe(0);
 }finally{f.close();}
});

const contourPart=(shape:any)=>({templateId:'tree',partId:'crown',position:[0,0,1.5],rotation:[0,0,0],scale:[1,1,1],shape});
const coarseCrown=(width=1)=>({type:'cushion',size:[width,.7,1],roundness:2,seamDepth:0,segments:4});
test('轮廓替换实际改变编译网格，保留主体、共享实例、材料与源几何',()=>{
 const f=fixture();try{
  f.options.space.program.instances.push({...f.options.space.program.instances[0],id:'back',position:[1,5,0]});
  const source=f.options.sourceScene,before=stable(source),local=applyGrayboxLocalParts(source,f.options.space,[contourPart(coarseCrown())]);
  expect(local.changed).toEqual(['tree/crown']);expect(local.templates[0].parts[0].shape.type).toBe('cushion');expect(local.templates[0].parts[0].material).toBe('blockout');
  const next={...source.program,templates:local.templates};expect(next.instances.map(i=>i.id)).toEqual(['front','back']);
  expect(stable(compileGeometryProgram(next))).not.toBe(stable(compileGeometryProgram(source.program)));expect(stable(source)).toBe(before);
 }finally{f.close();}
});
test('只改轮廓也必须独立测量及实际预览，位置相同不能误复用；恢复不重新渲染',async()=>{
 const f=fixture();try{
  let t=createGrayboxSpacePreview(f.options);const a={...f.patch(),instances:[],parts:[contourPart(coarseCrown())]},b={...a,parts:[contourPart(coarseCrown(.8))]};
  const measured=await t.kit.call('measure_graybox_space',{patchJson:JSON.stringify(a)});expect(f.renders()).toBe(0);expect(measured.content).toHaveLength(1);expect(()=>t.assertReviewed(a)).toThrow('PREVIEW_REQUIRED');
  for(const p of [a,b])await t.kit.call('preview_graybox_space',{patchJson:JSON.stringify(p)});
  const pa=t.assertReviewed(a),pb=t.assertReviewed(b);expect(pa.spaceSha256).toBe(pb.spaceSha256);expect(pa.canonicalSceneSha256).not.toBe(pb.canonicalSceneSha256);expect(f.renders()).toBe(2);
  t=createGrayboxSpacePreview(f.options);expect(t.assertReviewed(b)).toEqual(pb);expect(f.renders()).toBe(2);
 }finally{f.close();}
});
test('未知/细节几何、超分段、越界及过量轮廓均在渲染前拒绝，不耗测量或预览',async()=>{
 const f=fixture();try{
  const t=createGrayboxSpacePreview(f.options),p={...f.patch(),instances:[]};
  for(const shape of [{type:'scatter'},{type:'grid'},{...coarseCrown(),segments:9},{...coarseCrown(),size:[4,1,1]}])await expect(t.kit.call('preview_graybox_space',{patchJson:JSON.stringify({...p,parts:[contourPart(shape)]})})).rejects.toThrow();
  for(const parts of [Array.from({length:7},(_,i)=>({...contourPart(coarseCrown()),partId:'part'+i})),['a','b','c'].map(templateId=>({...contourPart(coarseCrown()),templateId}))])await expect(t.kit.call('measure_graybox_space',{patchJson:JSON.stringify({...p,parts})})).rejects.toThrow('轮廓替换最多');
  expect(f.renders()).toBe(0);expect(JSON.parse(t.kit.continuation!().text)).toMatchObject({used:0,measurementUsed:0});
 }finally{f.close();}
});
test('shape省略或null逐字保留原轮廓；同轮廓换文字不触发渲染',async()=>{
 const f=fixture();try{
  const source=f.options.sourceScene,p=contourPart(null),local=applyGrayboxLocalParts(source,f.options.space,[p]);expect(local.changed).toEqual([]);expect(local.templates).toEqual(source.program.templates);
  const t=createGrayboxSpacePreview(f.options);await expect(t.kit.call('preview_graybox_space',{patchJson:JSON.stringify({...f.patch(),instances:[],parts:[contourPart(source.program.templates[0].parts[0].shape)]})})).rejects.toThrow('NO_ACTIONABLE_CHANGE');expect(f.renders()).toBe(0);
 }finally{f.close();}
});
test('历史v3测量预览仍可只读重开；旧补丁或旧证据不能偷换轮廓',async()=>{
 const f=fixture();try{
  const options={...f.options,contractVersion:'graybox-space-preview-v3'},t=createGrayboxSpacePreview(options),p={...f.patch(),version:'graybox-space-repair-v2'};
  await t.kit.call('preview_graybox_space',{patchJson:JSON.stringify(p)});const proof=t.assertReviewed(p);expect(createGrayboxSpacePreview(options).assertReviewed(p)).toEqual(proof);expect(f.renders()).toBe(1);
  await expect(t.kit.call('preview_graybox_space',{patchJson:JSON.stringify({...p,version:GRAYBOX_SPACE_REPAIR,parts:[contourPart(coarseCrown())]})})).rejects.toThrow('旧预览证据');
  expect(()=>applyGrayboxSpaceRepair(f.options.space,{...p,parts:[contourPart(coarseCrown())]},v=>v)).toThrow('旧姿态契约');expect(()=>createGrayboxSpacePreview(f.options)).toThrow('契约');
 }finally{f.close();}
});
test('空间相同但冠体不同必须分别真实预览，旧空间摘要不能误复用其他局部几何',async()=>{
 const f=fixture();try{let t=createGrayboxSpacePreview(f.options);const patches=[.1,.2].map(x=>({...f.patch(),instances:[],parts:[{templateId:'tree',partId:'crown',position:[x,0,1.5],rotation:[0,0,0],scale:[1,1,1]}]}));
  for(const p of patches)await t.kit.call('preview_graybox_space',{patchJson:JSON.stringify(p)});expect(f.renders()).toBe(2);
  const first=t.assertReviewed(patches[0]),last=t.assertReviewed(patches[1]);expect(first.spaceSha256).toBe(last.spaceSha256);expect(first.canonicalSceneSha256).not.toBe(last.canonicalSceneSha256);
  t=createGrayboxSpacePreview(f.options);expect(t.kit.resolveOutput!({selectedPatchSha256:last.patchSha256,reason:'选择真实冠体候选且明确保留未验证的质量差距'})).toEqual(patches[1]);expect(t.kit.continuation!().images).toHaveLength(4);
 }finally{f.close();}
});

test('新工具直接公开由补丁契约派生的结构，不在字符串描述中隐藏检查和轮廓字段',()=>{
 const f=fixture();try{const t=createGrayboxSpacePreview({...f.options,contractVersion:GRAYBOX_SPACE_PREVIEW}),schema=t.kit.definitions[0].inputSchema;
  expect(schema.required).toEqual(grayboxSpaceRepairSchema().required);expect(schema.properties.patchJson).toBeUndefined();
  expect(schema.properties.checks.items.required).toEqual(['relationIds','evidence','expectedChange']);expect(schema.properties.templates.maxItems).toBe(0);expect(schema.properties.parts.items.properties.shape).toBeDefined();
  expect(()=>assertRoleTools('scene-space',t.kit)).not.toThrow();
 }finally{f.close();}
});

test('原生补丁的校验拒绝保留具体参数和缺失字段，校正后才消耗测量与真实预览额度',async()=>{
 const f=fixture();try{const t=createGrayboxSpacePreview({...f.options,contractVersion:GRAYBOX_SPACE_PREVIEW}),auditFile=join(f.folder,'tool-calls.jsonl'),server=serveCodexTools(t.kit,undefined,auditFile);
  try{const arg=server.args.find(x=>x.startsWith('mcp_servers.scene_feedback.args='))!,[,url]=JSON.parse(arg.slice(arg.indexOf('=')+1));
   const call=async(name:string,p:any)=>(await(await fetch(url,{method:'POST',body:JSON.stringify({method:'tools/call',params:{name,arguments:p}})})).json());
   const bad={...f.patch(),checks:[{id:'rel',evidence:'源帧显示冠层与步道有明显不当重叠',expected:'预期通道可见'}]},r=await call('measure_graybox_space',bad);
   expect(r.isError).toBe(true);expect(r.content[0].text).toContain('relationIds');expect(r.content[0].text).toContain('expectedChange');expect(r.content[0].text).toContain('未允许');
   expect(f.renders()).toBe(0);expect(JSON.parse(t.kit.continuation!().text)).toMatchObject({used:0,measurementUsed:0});
   const rows=readFileSync(auditFile,'utf8').trim().split('\n').map(x=>JSON.parse(x));expect(rows[1].arguments).toEqual(bad);expect(rows[2].isError).toBe(true);expect(rows[2].error).toBe(r.content[0].text);
   const measured=await call('measure_graybox_space',f.patch());expect(measured.isError).not.toBe(true);expect(f.renders()).toBe(0);
   const viewed=await call('preview_graybox_space',f.patch());expect(viewed.isError).not.toBe(true);expect(f.renders()).toBe(1);expect(t.assertReviewed(f.patch()).patchSha256).toHaveLength(64);
   const after=readFileSync(auditFile,'utf8').trim().split('\n').map(x=>JSON.parse(x));expect(after.at(-1).contentTypes).toEqual(['text','image','image']);expect(readFileSync(auditFile,'utf8')).not.toContain('base64');
   const opened=createGrayboxSpacePreview({...f.options,contractVersion:GRAYBOX_SPACE_PREVIEW});expect(opened.assertReviewed(f.patch())).toEqual(t.assertReviewed(f.patch()));expect(JSON.parse(opened.kit.continuation!().text)).toMatchObject({used:1,measurementUsed:1});
  }finally{server.close();}
 }finally{f.close();}
});

test('新结构化契约拒绝字符串补丁，历史v4轮廓证据只读重开且不自动迁移来源',async()=>{
 const f=fixture();try{const old=createGrayboxSpacePreview(f.options),p={...f.patch(),instances:[],parts:[contourPart(coarseCrown())]};
  await old.kit.call('preview_graybox_space',{patchJson:JSON.stringify(p)});const proof=old.assertReviewed(p);expect(createGrayboxSpacePreview(f.options).assertReviewed(p)).toEqual(proof);expect(f.renders()).toBe(1);
  expect(()=>createGrayboxSpacePreview({...f.options,contractVersion:GRAYBOX_SPACE_PREVIEW})).toThrow('契约');
  const native=createGrayboxSpacePreview({...f.options,folder:join(f.folder,'native'),contractVersion:GRAYBOX_SPACE_PREVIEW});await expect(native.kit.call('measure_graybox_space',{patchJson:JSON.stringify(p)})).rejects.toThrow('templates');expect(f.renders()).toBe(1);
 }finally{f.close();}
});
test('只有部件文字身份但无姿态变化不浪费预览，部件候选篡改后不能保存或恢复',async()=>{
 const f=fixture();try{const t=createGrayboxSpacePreview(f.options),part={templateId:'tree',partId:'crown',position:[0,0,1.5],rotation:[0,0,0],scale:[1,1,1]};
  await expect(t.kit.call('preview_graybox_space',{patchJson:JSON.stringify({...f.patch(),instances:[],parts:[part]})})).rejects.toThrow('NO_ACTIONABLE_CHANGE');expect(f.renders()).toBe(0);
  const p={...f.patch(),instances:[],parts:[{...part,position:[.1,0,1.5]}]};await t.kit.call('preview_graybox_space',{patchJson:JSON.stringify(p)});
  const changed=read(join(f.options.folder,'1/patch.json'));changed.parts[0].scale[0]=1.1;save(join(f.options.folder,'1/patch.json'),changed);
  expect(()=>t.assertReviewed(p)).toThrow();expect(()=>createGrayboxSpacePreview(f.options)).toThrow();
 }finally{f.close();}
});

test('新组群结构经过正常测量、实际预览与证据恢复；整组源几何不可被偷偷换回',async()=>{
 const f=fixture();try{
  f.options.contractVersion=GRAYBOX_SPACE_PREVIEW;
  f.options.buildScene=(s:any,p:any)=>({...f.options.sourceScene,cameras:s.cameras,spatialContacts:s.spatialContacts,program:{...f.options.sourceScene.program,templates:applyGrayboxLocalParts(f.options.sourceScene,s,p.parts,p.groups??[]).templates,instances:s.program.instances}});
  const p={...f.patch(),instances:[],groups:[{templateId:'tree',parts:[{id:'connected',position:[0,0,1.5],rotation:[0,0,0],scale:[1,1,1],shape:{type:'branchCrown',size:[1.5,1.5,2.6],habit:'upright',stems:3,leafPairs:4,leafLength:.2,leafWidth:.5,curl:.15,seed:1,segments:2,layer:'whole'}}]}]};
  let t=createGrayboxSpacePreview(f.options);expect(()=>t.assertReviewed(p)).toThrow('PREVIEW_REQUIRED');
  await t.kit.call('measure_graybox_space',p);expect(f.renders()).toBe(0);const result=await t.kit.call('preview_graybox_space',p);expect(result.isError).not.toBe(true);expect(f.renders()).toBe(1);
  const proof=t.assertReviewed(p);expect(read(join(f.options.folder,'1/scene.json')).program.templates[0].parts[0].shape.type).toBe('branchCrown');
  t=createGrayboxSpacePreview(f.options);expect(t.assertReviewed(p)).toEqual(proof);expect(f.renders()).toBe(1);
  const bad=structuredClone(p);bad.groups[0].parts[0].shape.seed=2;expect(()=>t.assertReviewed(bad)).toThrow('PREVIEW_REQUIRED');
 }finally{f.close();}
});

test('v7在渲染或测量前拒绝详细阶段必然超额的枝冠，v6旧回执可原样读取',async()=>{
 const f=fixture();try{
  const other={...structuredClone(f.options.space.program.templates[0]),id:'other',maxParts:64};f.options.space.program.templates.push(other);
  const base=f.options.space.program.instances[0];for(let i=0;i<3;i++)f.options.space.program.instances.push({...structuredClone(base),id:'other'+i,template:'other'});
  f.options.sourceScene.program.templates.push({...structuredClone(f.options.sourceScene.program.templates[0]),id:'other'});
  f.options.buildScene=(s:any,p:any)=>({...f.options.sourceScene,cameras:s.cameras,spatialContacts:s.spatialContacts,program:{...f.options.sourceScene.program,templates:applyGrayboxLocalParts(f.options.sourceScene,s,p.parts,p.groups??[]).templates,instances:s.program.instances}});
  const p={...f.patch(),instances:[],groups:[{templateId:'tree',parts:[{id:'connected',position:[0,0,1.5],rotation:[0,0,0],scale:[1,1,1],shape:{type:'branchCrown',size:[1.5,1.5,2.6],habit:'upright',stems:16,leafPairs:20,leafLength:.2,leafWidth:.5,curl:.15,seed:1,segments:2,layer:'whole'}}]}]};
  const options={...f.options,contractVersion:GRAYBOX_SPACE_PREVIEW},tool=createGrayboxSpacePreview(options);
  for(const name of ['measure_graybox_space','preview_graybox_space'])await expect(tool.kit.call(name,p)).rejects.toThrow('PROCEDURAL_BUDGET_INFEASIBLE');
  expect(f.renders()).toBe(0);expect(JSON.parse(tool.kit.continuation!().text)).toMatchObject({used:0,measurementUsed:0});expect(tool.kit.instructions).toContain('各模板额度');
  const oldOptions={...options,folder:join(f.folder,'old-v6'),contractVersion:'graybox-space-preview-v6'},old=createGrayboxSpacePreview(oldOptions);
  await old.kit.call('preview_graybox_space',p);const proof=old.assertReviewed(p);expect(createGrayboxSpacePreview(oldOptions).assertReviewed(p)).toEqual(proof);expect(f.renders()).toBe(1);
  const bounded=structuredClone(p);bounded.groups[0].parts[0].shape.stems=2;bounded.groups[0].parts[0].shape.leafPairs=3;
  await tool.kit.call('measure_graybox_space',bounded);await tool.kit.call('preview_graybox_space',bounded);expect(tool.assertReviewed(bounded).patchSha256).toHaveLength(64);expect(f.renders()).toBe(2);
 }finally{f.close();}
});

test('通用组群通过真实工具契约进入预览与恢复；历史v7仍保留枝冠限制',async()=>{
 const f=fixture();try{
  f.options.contractVersion=GRAYBOX_SPACE_PREVIEW;
  f.options.buildScene=(s:any,p:any)=>({...f.options.sourceScene,cameras:s.cameras,spatialContacts:s.spatialContacts,program:{...f.options.sourceScene.program,templates:applyGrayboxLocalParts(f.options.sourceScene,s,p.parts,p.groups??[]).templates,instances:s.program.instances}});
  const part=(id:string,x:number,size:number[])=>({id,position:[x,0,1.5],rotation:[0,0,0],scale:[1,1,1],shape:{type:'box',size,radius:0}});
  const p={...f.patch(),instances:[],groups:[{templateId:'tree',parts:[part('left',-.6,[.2,.5,2]),part('right',.6,[.2,.5,2])]}]};
  const t=createGrayboxSpacePreview(f.options);expect(()=>assertRoleTools('scene-space',t.kit)).not.toThrow();
  await t.kit.call('preview_graybox_space',p);expect(t.assertReviewed(p).canonicalSceneSha256).toHaveLength(64);
  expect(createGrayboxSpacePreview(f.options).assertReviewed(p)).toEqual(t.assertReviewed(p));expect(f.renders()).toBe(1);
  const old=createGrayboxSpacePreview({...f.options,contractVersion:'graybox-space-preview-v7',folder:join(f.folder,'old-v7')});
  await expect(old.kit.call('preview_graybox_space',{...p,version:'graybox-space-repair-v4'})).rejects.toThrow('历史组群');expect(f.renders()).toBe(1);
 }finally{f.close();}
});
