import {test,expect} from 'bun:test';
import {compileGeometryProgram,type GeometryProgram} from './program';
import {validateAsset} from './layout';
import {assetInput} from './asset-input';
import {assetEvidencePlan} from './asset-evidence';
import {assertSpatialAccepted} from './spatial-order';
import {readableBlockout} from './blockout-presentation';
import {applySurface,spaceSchema,surfaceSchema} from './layout-stages';
import {checkpointFixture} from './checkpoint-fixture';
import {read} from '../store';
import {join} from 'node:path';
import {rmSync} from 'node:fs';
const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};
function program():GeometryProgram{return {version:'geometry-v1',name:'共享板材不同表面',materials:[{id:'a',color:[1,0,0,1],roughness:.8,metallic:0,textureId:null},{id:'b',color:[0,1,0,1],roughness:.6,metallic:0,textureId:null}],templates:[{id:'shared',parts:[{...pose,id:'panel',material:'a',uvScale:[2,3],shape:{type:'box',size:[1,1,.1],radius:0}}]}],instances:[{...pose,id:'one',label:'原色板',template:'shared',requirementIds:[]},{...pose,id:'two',label:'异色板',template:'shared',requirementIds:[],position:[2,0,0],scale:[4,5,1],surfaceOverrides:[{sourceMaterialId:'a',targetMaterialId:'b',uvScale:[8,10]}]}]} as GeometryProgram;}
test('相同模板按实例改变材质和最终重复次数，原始几何与另一实例不受污染',()=>{
 const p=program(),before=JSON.stringify(p),r=compileGeometryProgram(p),[a,b]=r.meshes.map(m=>m.geometry);
 expect(a.material.surface.baseColor).toEqual([1,0,0,1]);expect(b.material.surface.baseColor).toEqual([0,1,0,1]);
 expect(Math.max(...a.uvs)).toBe(3);expect(Math.max(...b.uvs.filter((_,n)=>n%2===0))).toBe(8);expect(Math.max(...b.uvs.filter((_,n)=>n%2===1))).toBe(10);
 expect(JSON.stringify(p)).toBe(before);expect(r.triangles).toBe(24);
 p.instances[1].surfaceOverrides![0].uvScale=null;expect(compileGeometryProgram(p).meshes[1].geometry.uvs).toEqual(a.uvs);
});
test('失效覆盖不能静默放行；缺失源、目标、重复槽与非法尺度明确失败',()=>{
 for(const binding of [{sourceMaterialId:'missing',targetMaterialId:'b',uvScale:null},{sourceMaterialId:'a',targetMaterialId:'missing',uvScale:null},{sourceMaterialId:'a',targetMaterialId:'b',uvScale:[0,1]}]){const p=program();p.instances[1].surfaceOverrides=[binding as any];expect(()=>compileGeometryProgram(p)).toThrow('实例');}
 const p=program();p.instances[1].surfaceOverrides!.push(p.instances[1].surfaceOverrides![0]);expect(()=>compileGeometryProgram(p)).toThrow('重复');
});
test('表面覆盖不触发空间重验，中性灰模剥离覆盖；移动实例仍被拒绝',()=>{
 const p=program(),space:any={program:{...p,instances:p.instances.map(({surfaceOverrides,...i})=>i)},cameras:[]};
 const gate={blockout:{status:'passed',space,rounds:[{passed:true,runtimeDigest:'hash',frames:['actual.png']}]}};
 expect(()=>assertSpatialAccepted(gate,{...space,program:p})).not.toThrow();
 const gray=readableBlockout({...space,program:p});expect(()=>compileGeometryProgram(gray.program)).not.toThrow();
 const changed=structuredClone(p);changed.instances[1].position[0]++;expect(()=>assertSpatialAccepted(gate,{...space,program:changed})).toThrow('CHANGED');
});
test('表面规划保留空间并落到独立实例，检查缺失与重复实例声明',()=>{
 const f=checkpointFixture();try{
  const l=read(join(f.registration.generationDir,'layout.json')),plan=read(f.registration.planFile),{materials,templates,...program}=l.program;
  const space={...l,version:'scene-space-v1',program:{...program,templates:templates.map(({materialIds,...t})=>t)}};
  const surface={version:'scene-surface-v1',materials:[...materials,{...materials[0],id:'variant'}],textures:l.textures,lighting:l.lighting,bindings:templates.map(t=>({templateId:t.id,materialIds:t.materialIds})),instanceSurfaces:program.instances.map(i=>({instanceId:i.id,surfaceOverrides:[{sourceMaterialId:'mat',targetMaterialId:'variant',uvScale:[3,4]}]})),assumptions:[]};
  const next=applySurface(space as any,surface as any,plan,f.job.images.length,'simple');expect(next.program.instances[0].surfaceOverrides![0].targetMaterialId).toBe('variant');expect(next.cameras).toEqual(l.cameras);
  expect(()=>applySurface(space as any,{...surface,instanceSurfaces:[]} as any,plan,f.job.images.length,'simple')).toThrow('每个冻结实例');
  expect(spaceSchema().properties.program.properties.instances.items.properties).not.toHaveProperty('surfaceOverrides');expect(surfaceSchema().properties).toHaveProperty('instanceSurfaces');
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
test('资产输入保留用途与最终尺寸，缺失实际源槽在资产阶段失败',()=>{
 const f=checkpointFixture();try{
  const l=read(join(f.registration.generationDir,'layout.json')),plan=read(f.registration.planFile),brief=l.program.templates[0];l.program.instances[0].scale=[4,5,1];l.program.materials.push({...l.program.materials[0],id:'variant'});l.program.instances[0].surfaceOverrides=[{sourceMaterialId:'mat',targetMaterialId:'variant',uvScale:[3,4]}];
  const input=assetInput('保留图片差异',plan,l,brief,{});expect(input.input).toBe('保留图片差异');expect(input.usage[0].worldSize).toEqual(brief.bounds.max.map((n,k)=>(n-brief.bounds.min[k])*[4,5,1][k]));expect(input.materials.map(m=>m.id)).toContain('variant');
  expect(validateAsset(f.geometry,brief,l,{}).surfaceBindings[0].passed).toBe(true);
  brief.materialIds.push('variant');f.geometry.template.parts[0].material='variant';expect(()=>validateAsset(f.geometry,brief,l,{})).toThrow('未命中');
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
test('局部参考依据只来自当前模板绑定的地标，不混用邻接资产或生成图',()=>{
 const p=program(),layout={program:p,cameras:[{referenceIndex:1}],observedBindings:[{landmarkId:'visible',instanceIds:['two']},{landmarkId:'unrelated',instanceIds:['absent']}]};
 const result=assetEvidencePlan(layout,{id:'shared'},{landmarks:[{id:'visible',label:'异色面',views:[{referenceIndex:1,box:[.1,.2,.4,.7],evidence:'可见'}]},{id:'unrelated',label:'旁物',views:[{referenceIndex:1,box:[0,0,1,1]}]}]});
 expect(result.crops).toHaveLength(1);expect(result.crops[0].landmarkId).toBe('visible');expect(result.referenceCameras).toEqual(layout.cameras);
});
