import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {assetContextContract,assetContextScene,assetSpatialHandoff} from './asset-scene-context';
import {createAssetReview,verifyAssetReview} from './asset-review';
import {compileGeometryProgram} from './program';
import {save,digest} from '../store';
import {stable} from '../validated-cache';
import {assertRoleTools} from '../codex-tools';

const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};
const material=(id:string)=>({id,textureId:null,color:[.3,.5,.2,1],roughness:.7,metallic:0});
const brief={id:'leaf',label:'叶丛',materialIds:['green'],maxParts:4,bounds:{min:[-1,-1,-1],max:[1,1,1]}};
const asset=(size=1)=>({version:'asset-geometry-v1',template:{id:'leaf',parts:[{...pose,id:'body',material:'green',shape:{type:'box',size:[size,size,size],radius:0}}]}});
const layout:any={version:'scene-layout-v1',program:{version:'geometry-v1',name:'空间上下文',materials:[material('green'),material('variant')],templates:[brief,{...brief,id:'wall'}],instances:[
 {...pose,id:'near',label:'近景',template:'leaf',position:[2,0,0],scale:[1,2,1],requirementIds:['r'],surfaceOverrides:[{sourceMaterialId:'green',targetMaterialId:'variant',uvScale:null,uvTransform:null}]},
 {...pose,id:'back',label:'后景',template:'wall',position:[0,3,0],requirementIds:[]}]},
 cameras:[{name:'原图一',referenceIndex:1,position:[4,-8,3],target:[0,0,0],fov:.8},{name:'原图二',referenceIndex:2,position:[-3,-8,3],target:[0,0,0],fov:.7}],
 lighting:{direction:[.4,.6,-1],color:[1,1,1],intensity:2,ambientColor:[1,1,1],ambientIntensity:.3,points:[]},textures:[],textureReuse:[],entities:[],assumptions:[],spatialOpenings:[],
 observedBindings:[{landmarkId:'observed',instanceIds:['near']}],spatialRelations:[{id:'enclosure',critical:true,instanceIds:['near','back'],description:'近景和后景构成围合'}]};
const context:any={scene:{...layout,program:{...layout.program,templates:[asset().template,{...asset().template,id:'wall'}]}},review:{relations:[{id:'enclosure',score:3,verdict:'partial',reason:'局部空隙偏大'}]},observation:{landmarks:[{id:'observed',views:[{referenceIndex:1,box:[0,0,.1,.1]},{referenceIndex:2,box:[0,0,.7,.9]}]}]}};

test('上下文用已验收几何、真实实例覆盖和原机位；不会复制成品或修改源数据',()=>{
 const before=stable([layout,context]),result=assetContextScene(asset(),brief,layout,context),scene=result.scene;
 expect(scene.cameras).toEqual([layout.cameras[1]]);expect(scene.lighting).toEqual(layout.lighting);
 expect(scene.program.instances[0]).toEqual(layout.program.instances[0]);
 expect(scene.program.templates.find((t:any)=>t.id==='leaf')).toEqual(asset().template);
 expect(scene.program.templates.find((t:any)=>t.id==='wall').parts[0].shape).toEqual(context.scene.program.templates[1].parts[0].shape);
 expect(scene.program.templates.find((t:any)=>t.id==='wall').parts[0].material).not.toBe('green');
 const meshes=compileGeometryProgram(scene.program).meshes;
 expect(meshes.find(m=>m.entityId==='near')!.geometry.material.id).toBe('variant');
 expect(result.placeholderTemplateIds).toEqual(['wall']);expect(result.handoff.residuals[0].reason).toBe('局部空隙偏大');
 expect(scene.assumptions.join(' ')).toContain('不是最终成品');expect(stable([layout,context])).toBe(before);
});
test('上下文位置、相机或缺少模板拒绝；灯光和选图依据改变不能复用旧上下文',()=>{
 for(const mutate of [(x:any)=>x.scene.program.instances[0].position[0]++,(x:any)=>x.scene.cameras[0].fov=.9,(x:any)=>x.scene.program.templates.pop()]){
  const bad=structuredClone(context);mutate(bad);expect(()=>assetContextContract(layout,bad)).toThrow('ASSET_CONTEXT_');
 }
 const original=assetContextContract(layout,context),lit=structuredClone(layout);lit.lighting.intensity=3;
 expect(assetContextContract(lit,context)).not.toBe(original);
 const reviewOnly=structuredClone(context);reviewOnly.review.relations[0].reason='新的文字说明';
 expect(assetContextContract(layout,reviewOnly)).toBe(original);
});
test('两个候选额度不变；局部与上下文收据同时通过才可选择，篡改拒绝',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'asset-context-')),ref=join(folder,'ref.png');writeFileSync(ref,'fixture reference');
 const renders:any[]=[];let failContext=false;
 const render:any=async(scene:any,_images:any,_refs:any,dir:string)=>{
  renders.push(scene);if(failContext&&scene.cameras.length===1)throw Error('fixture context failed');
  mkdirSync(join(dir,'capture'),{recursive:true});
  const frames=scene.cameras.map((_c:any,n:number)=>{const file=n+'.png',bytes=dir+':'+n;writeFileSync(join(dir,'capture',file),bytes);return {file,sha256:digest(bytes)}});
  save(join(dir,'engine-preview-receipt.json'),{frames});return [];
 };
 const options={brief,layout,context,textures:{},images:[{path:ref,mime:'image/png'}],folder:join(folder,'review'),signal:new AbortController().signal,render};
 try{
  const tool=createAssetReview(options),hash=assetContextContract(layout,context);
  expect(tool.kit.version).toBe('asset-preview-context-v2');expect(()=>assertRoleTools('geometry-asset',tool.kit)).not.toThrow();
  const first=await tool.kit.call('preview_asset',{assetJson:JSON.stringify(asset())});expect(first.isError).not.toBe(true);expect(renders).toHaveLength(2);
  const record=tool.assertReviewed(asset());expect(verifyAssetReview(asset(),record,hash)).toBe(true);expect(verifyAssetReview(asset(),record,'changed')).toBe(false);
  const old={...record};delete old.context;expect(verifyAssetReview(asset(),old)).toBe(true);expect(verifyAssetReview(asset(),old,hash)).toBe(false);
  expect(tool.kit.continuation!().images).toHaveLength(3);
  await tool.kit.call('preview_asset',{assetJson:JSON.stringify(asset())});expect(renders).toHaveLength(2);
  failContext=true;const second=await tool.kit.call('preview_asset',{assetJson:JSON.stringify(asset(.8))});expect(second.isError).toBe(true);
  expect(()=>tool.assertReviewed(asset(.8))).toThrow('缺少');
  await expect(createAssetReview(options).kit.call('preview_asset',{assetJson:JSON.stringify(asset(.6))})).rejects.toThrow('上限');
  writeFileSync(join(options.folder,'1/context/capture/0.png'),'tampered');expect(verifyAssetReview(asset(),record,hash)).toBe(false);
  expect(()=>tool.assertReviewed(asset())).toThrow('改变');
 }finally{rmSync(folder,{recursive:true,force:true});}
});

test('已通过灰模的枝冠结构必须进入资产输入，改变密度在渲染和额度消耗前拒绝',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'crown-context-'));try{
  const ref=join(folder,'ref.png');writeFileSync(ref,'fixture');const c=structuredClone(context),s={type:'branchCrown',size:[1,1,1],habit:'upright',stems:3,leafPairs:4,leafLength:.2,leafWidth:.5,curl:.15,seed:8,segments:2,layer:'whole'};
  c.scene.program.templates[0].parts[0].shape=s;
  const handoff=assetSpatialHandoff(brief,layout,c);expect(handoff.proceduralStructure[0].shape).toEqual(s);
  let renders=0;const review=createAssetReview({brief,layout,textures:{},images:[{path:ref,mime:'image/png'}],context:c,folder:join(folder,'review'),signal:new AbortController().signal,render:async()=>{renders++;throw Error('must not render');}});
  const candidate=asset();candidate.template.parts[0].shape={...s,leafPairs:2} as any;
  await expect(review.kit.call('preview_asset',{assetJson:JSON.stringify(candidate)})).rejects.toThrow('PROCEDURAL_STRUCTURE_CHANGED');expect(renders).toBe(0);
  expect(()=>review.assertReviewed(candidate)).toThrow('PROCEDURAL_STRUCTURE_CHANGED');
  const withoutContext=createAssetReview({brief,layout,textures:{},images:[{path:ref,mime:'image/png'}],acceptedScene:c.scene,folder:join(folder,'no-context'),signal:new AbortController().signal,render:async()=>{renders++;throw Error('must not render');}});
  await expect(withoutContext.kit.call('preview_asset',{assetJson:JSON.stringify(candidate)})).rejects.toThrow('PROCEDURAL_STRUCTURE_CHANGED');expect(renders).toBe(0);
 }finally{rmSync(folder,{recursive:true,force:true});}
});
