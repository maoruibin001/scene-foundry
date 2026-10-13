import {test,expect} from 'bun:test';
import {join} from 'node:path';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {fitGrayboxSpace,spaceFitRule,GRAYBOX_SPACE_FIT,GRAYBOX_SPACE_FIT_LIMITS,occlusionOvershoot,fitOcclusionRule} from './graybox-space-fit';
import {createGrayboxSpacePreview,GRAYBOX_SPACE_PREVIEW} from './graybox-space-preview';
import {applyGrayboxSpaceRepair,grayboxSpaceRepairSchema,GRAYBOX_SPACE_REPAIR} from './graybox-space-repair';
import {applyGrayboxLocalParts} from './graybox-local-parts';
import {assertRoleTools,serveCodexTools} from '../codex-tools';
import {read,save,digest} from '../store';

const space={program:{instances:[{id:'a',position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},{id:'b',position:[5,0,0],rotation:[0,0,0],scale:[1,1,1]}]},cameras:[{name:'ref',referenceIndex:1,projection:'perspective',position:[0,-10,2],target:[0,0,2],fov:1}]};
const base=()=>({version:'v',reason:'r',instances:[],templates:[],parts:[],cameras:[],contacts:[],checks:[{relationIds:['rel']}]});
// Synthetic measurement: one target per instance whose residual is the distance of its x from a goal; b regresses when a passes 1.5.
const measurer=(goal=2)=>(patch:any)=>{
 const pose=(id:string)=>patch.instances.find((i:any)=>i.id===id)??space.program.instances.find(i=>i.id===id);
 const a=pose('a'),b=pose('b'),ea=Math.abs(a.position[0]-goal)/10,eb=a.position[0]>1.5?.2:Math.abs(b.position[0]-5)/10;
 return {rows:[{targetId:'ta',referenceIndex:1,instanceIds:['a'],edgeResidual:ea,sourceDelta:{edgeResidual:ea-goal/10}},{targetId:'tb',referenceIndex:1,instanceIds:['b'],edgeResidual:eb,sourceDelta:{edgeResidual:eb}}]};
};
const jointFit=(r:any)=>({passed:r.rows[1].edgeResidual<.05});

// Occluded target: moving 'a' in +x gives a tiny edge-residual gain but exposes the target (outsideTargetFraction grows).
const occMeasurer=(patch:any)=>{
 const a=patch.instances.find((i:any)=>i.id==='a')??space.program.instances.find(i=>i.id==='a');
 const x=a.position[0],ea=Math.abs(x-2)/100,outside=Math.min(1,Math.max(0,x)/2);
 return {rows:[{targetId:'ta',referenceIndex:1,instanceIds:['a'],extent:'occluded',edgeResidual:ea,outsideTargetFraction:outside,spanRatio:[1,1],sourceDelta:{edgeResidual:ea-0.02}}]};
};
test('遮挡项：开启后拒绝靠暴露被遮挡目标换取的边缘小改善',()=>{
 const common={space,basePatch:base(),instanceIds:['a'],referenceIndices:[],measure:occMeasurer,sourceReport:()=>occMeasurer(base()),jointFit:()=>({passed:true})} as any;
 const without=fitGrayboxSpace(common);
 const withOcc=fitGrayboxSpace({...common,occlusion:true});
 const xw=without.patch.instances.find((i:any)=>i.id==='a')?.position[0]??0;
 const xo=withOcc.patch.instances.find((i:any)=>i.id==='a')?.position[0]??0;
 expect(xw).toBeGreaterThan(0.5);              // without occlusion it moves to expose (lower edge residual)
 expect(xo).toBeLessThan(xw);                  // occlusion keeps it from exposing the occluded target
 expect(withOcc.report.improved).toBe(false);  // nothing beats the base once exposure is penalised
});
test('occlusionOvershoot 只罚遮挡/部分目标的超出暴露；fitOcclusionRule 由策略开关控制',()=>{
 expect(occlusionOvershoot({extent:'full',outsideTargetFraction:0.9})).toBe(0);
 expect(occlusionOvershoot({extent:'unknown',outsideTargetFraction:0.9})).toBe(0);
 expect(occlusionOvershoot({extent:'occluded',outsideTargetFraction:0.5,spanRatio:[1,1]})).toBeCloseTo(0.5,5);
 expect(occlusionOvershoot({extent:'partial',outsideTargetFraction:0.2,spanRatio:[1.4,1]})).toBeCloseTo(0.4,5);
 expect(fitOcclusionRule({grayboxFitOcclusionPolicy:'graybox-fit-occlusion-v1'})).toBe(true);
 expect(fitOcclusionRule({})).toBe(false);expect(fitOcclusionRule(null)).toBe(false);
});


test('数值拟合降低已测残差，每个采用候选通过jointFit，越过跨目标退步即停',()=>{
 const r=fitGrayboxSpace({space,basePatch:base(),instanceIds:['a'],referenceIndices:[],measure:measurer(),sourceReport:()=>measurer()(base()),jointFit});
 expect(r.report).toMatchObject({version:GRAYBOX_SPACE_FIT,improved:true,requiresActualPreview:true,requiresIndependentAcceptance:true,quality:'not-assessed'});
 const x=r.patch.instances.find((i:any)=>i.id==='a').position[0];expect(x).toBeGreaterThan(1);expect(x).toBeLessThanOrEqual(1.5);
 expect(r.report.after.objective).toBeLessThan(r.report.before.objective);expect(r.report.after.jointFit.passed).toBe(true);
 expect(r.report.evaluations).toBeLessThanOrEqual(GRAYBOX_SPACE_FIT_LIMITS.evaluationsPerCall);
 // Only the listed identities move; the frozen rows and checks are preserved verbatim.
 expect(r.patch.instances.map((i:any)=>i.id)).toEqual(['a']);expect(r.patch.checks).toEqual(base().checks);
});
test('机位拟合保持fov与俯仰范围，缩放保持来源0.5至2倍；预算与非法输入在测量前拒绝',()=>{
 let calls=0;const measure=(p:any)=>{calls++;const c=p.cameras[0]??space.cameras[0],e=Math.abs(c.fov-3)/10+Math.abs((p.instances[0]?.scale[0]??1)-9)/100;return {rows:[{targetId:'t',referenceIndex:1,instanceIds:['a'],edgeResidual:e,sourceDelta:{edgeResidual:0}}]};};
 const r=fitGrayboxSpace({space,basePatch:base(),instanceIds:['a'],referenceIndices:[1],measure,sourceReport:()=>measure(base()),jointFit:()=>({passed:true}),maxEvaluations:150});
 expect(r.patch.cameras[0].fov).toBeLessThanOrEqual(2.2);expect(r.patch.instances[0].scale[0]).toBeLessThanOrEqual(2);expect(calls).toBe(r.report.evaluations);expect(r.report.evaluations).toBeLessThanOrEqual(150);
 for(const bad of [{instanceIds:['a','a']},{instanceIds:['zzz']},{referenceIndices:[7]},{instanceIds:[],referenceIndices:[]},{instanceIds:['a','b','a','b','a','b','a']},{maxEvaluations:999}])
  expect(()=>fitGrayboxSpace({space,basePatch:base(),instanceIds:['a'],referenceIndices:[],measure,sourceReport:()=>measure(base()),jointFit:()=>({passed:true}),...bad} as any)).toThrow('灰模数值拟合');
 expect(()=>fitGrayboxSpace({space,basePatch:{...base(),checks:[]},instanceIds:['a'],referenceIndices:[],measure,sourceReport:()=>measure(base()),jointFit:()=>({passed:true})})).toThrow('checks');
 expect(spaceFitRule({grayboxFitPolicy:GRAYBOX_SPACE_FIT})).toBe(true);expect(spaceFitRule({})).toBe(false);expect(spaceFitRule({grayboxFitPolicy:null})).toBe(false);
});

function fixture(){
 const folder=mkdtempSync(join(tmpdir(),'graybox-fit-')),controller=new AbortController();
 const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},s:any={version:'scene-space-v1',program:{version:'geometry-v1',name:'拟合测试',templates:[{id:'tree',label:'植物',description:'冠层',origin:'根部',maxParts:8,bounds:{min:[-1,-1,0],max:[1,1,3]}}],instances:[{...pose,id:'front',label:'近景',template:'tree',position:[1,2,0],requirementIds:['r']}]},cameras:[{name:'参考',referenceIndex:1,position:[0,-3,1.5],target:[0,3,1.5],fov:1},{name:'检查',referenceIndex:null,position:[1,-3,1.5],target:[0,3,1.5],fov:1}],entities:[],spatialRelations:[{id:'rel',critical:true,instanceIds:['front']}],spatialContacts:[]};
 const sourceScene={...s,version:'scene-v1',observedBindings:[{landmarkId:'L1',instanceIds:['front']}],program:{...s.program,materials:[{id:'blockout',color:[.5,.5,.5,1],roughness:1,metallic:0,textureId:null}],templates:[{id:'tree',parts:[{...pose,position:[0,0,1.5],id:'crown',material:'blockout',shape:{type:'box',size:[1,1,1],radius:0}}]}]},textures:[],textureReuse:[]};
 const patch=(x=1)=>({version:GRAYBOX_SPACE_REPAIR,reason:'实际近景冠层偏离原图位置，依据原图与真实灰模局部调整而不新增删除对象。',instances:x===1?[]:[{id:'front',position:[x,2,0],rotation:[0,0,0],scale:[1,1,1]}],templates:[],parts:[],cameras:[],contacts:[],checks:[{relationIds:['rel'],evidence:'源帧显示冠层偏右且占幅不符原图',expectedChange:'实际候选中冠层居中且占幅接近原图'}]});
 let renders=0;
 const render:any=async(scene:any,_i:any,_r:any,dir:string)=>{renders++;mkdirSync(join(dir,'capture'),{recursive:true});
  const frames=scene.cameras.map((c:any,i:number)=>{const file=`candidate-${i+1}.png`,bytes=Buffer.alloc(32);Buffer.from('89504e470d0a1a0a','hex').copy(bytes);bytes.writeUInt32BE(1600,16);bytes.writeUInt32BE(900,20);bytes.writeUInt32BE(renders,24);writeFileSync(join(dir,'capture',file),bytes);return {file,referenceIndex:c.referenceIndex,sha256:digest(bytes),pose:{selectedView:i,position:[c.position[0],c.position[2],-c.position[1]],target:[c.target[0],c.target[2],-c.target[1]],fov:c.fov,cameraProjection:{projection:0,fov:c.fov,near:.1,far:1000,aspect:16/9}}};});
  save(join(dir,'engine-preview-receipt.json'),{sceneSha256:digest(JSON.stringify(scene)),frames,report:{consoleErrors:[],pageErrors:[]}});return [];};
 const observation={landmarks:[{id:'L1',label:'近景',critical:true,views:[{referenceIndex:1,box:[.4,.25,.6,.75],extent:'occluded',evidence:'原图遮挡但仍有可见边缘'}]}],cameras:[{referenceIndex:1,contentRect:[0,0,1,1]}]};
 const options:any={contractVersion:GRAYBOX_SPACE_PREVIEW,space:s,sourceScene,observation,images:[],folder:join(folder,'review'),signal:controller.signal,schema:grayboxSpaceRepairSchema(),spaceFit:true,jointFitNet:true,apply:(p:any)=>applyGrayboxSpaceRepair(s,p,v=>v),buildScene:(sp:any,p:any)=>({...sourceScene,cameras:sp.cameras,spatialContacts:sp.spatialContacts,program:{...sourceScene.program,templates:applyGrayboxLocalParts(sourceScene,sp,p.parts).templates,instances:sp.program.instances}}),render};
 return {folder,options,patch,renders:()=>renders,close:()=>rmSync(folder,{recursive:true,force:true})};
}

test('fit_graybox_space只在当前契约与策略开放；结果只是预测，须真实预览后才可选择，额度恢复不重置',async()=>{
 const f=fixture();try{
  let t=createGrayboxSpacePreview(f.options);
  expect(t.kit.definitions.map((d:any)=>d.name)).toEqual(['preview_graybox_space','measure_graybox_space','fit_graybox_space']);expect(t.kit.instructions).toContain('graybox-space-fit-v1');
  expect(()=>assertRoleTools('scene-space',t.kit)).not.toThrow();expect(()=>assertRoleTools('scene-space',{...t.kit,version:'graybox-space-preview-v14'})).toThrow('PROVIDER_TOOLS_INVALID');
  const server=serveCodexTools(t.kit);server.close();
  const args={basePatch:f.patch(),instanceIds:['front'],referenceIndices:[]};
  const out=JSON.parse((await t.kit.call('fit_graybox_space',args)).content[0].text);
  expect(out.quality).toBe('geometry-prediction-only');expect(out.report.improved).toBe(true);expect(out.report.after.objective).toBeLessThan(out.report.before.objective);expect(out.report.after.jointFit.passed).toBe(true);expect(f.renders()).toBe(0);
  expect(()=>t.kit.resolveOutput!({selectedPatchSha256:out.report.selectedPatchSha256,reason:'这个摘要只是程序预测，还没有真实Engine预览'})).toThrow('PREVIEW_REQUIRED');
  const shown=JSON.parse((await t.kit.call('preview_graybox_space',out.patch)).content[0].text);expect(shown.jointFit.passed).toBe(true);
  expect(t.kit.resolveOutput!({selectedPatchSha256:shown.patchSha256,reason:'拟合候选经真实预览后选择并说明残留'})).toEqual(out.patch);
  const first=read(join(f.options.folder,'graybox-preview-audit.json'));expect(first.spaceFits).toHaveLength(1);expect(first.spaceFitMeasured).toBe(out.report.evaluations);
  // Same input reuses evidence; reopening keeps the spent budget; the cap applies across reopenings.
  t=createGrayboxSpacePreview(f.options);await t.kit.call('fit_graybox_space',args);expect(read(join(f.options.folder,'graybox-preview-audit.json')).spaceFits).toHaveLength(1);
  expect(JSON.parse(t.kit.continuation!().text).spaceFits).toHaveLength(1);
  await t.kit.call('fit_graybox_space',{...args,basePatch:f.patch(.5)});
  t=createGrayboxSpacePreview(f.options);await expect(t.kit.call('fit_graybox_space',{...args,basePatch:f.patch(.2)})).rejects.toThrow('额度');
  const audit=read(join(f.options.folder,'graybox-preview-audit.json'));audit.spaceFits[0].result.report.evaluations=0;save(join(f.options.folder,'graybox-preview-audit.json'),audit);
  expect(()=>createGrayboxSpacePreview(f.options)).toThrow('拟合恢复额度');
 }finally{f.close();}
 const g=fixture();try{
  // Without the policy, on an older contract, or for voxel jobs the tool and its contract flag are absent.
  for(const o of [{spaceFit:false},{contractVersion:'graybox-space-preview-v14'},{voxel:true}]){const t=createGrayboxSpacePreview({...g.options,...o,folder:join(g.folder,JSON.stringify(o).replace(/\W/g,''))});expect(t.kit.definitions.map((d:any)=>d.name)).not.toContain('fit_graybox_space');await expect(t.kit.call('fit_graybox_space',{basePatch:g.patch(),instanceIds:['front'],referenceIndices:[]})).rejects.toThrow('未知灰模工具');}
  await createGrayboxSpacePreview(g.options).kit.call('fit_graybox_space',{basePatch:g.patch(),instanceIds:['front'],referenceIndices:[]});expect(()=>createGrayboxSpacePreview({...g.options,spaceFit:false})).toThrow('契约');
 }finally{g.close();}
});
