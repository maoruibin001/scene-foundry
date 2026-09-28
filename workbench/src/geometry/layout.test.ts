import {test,expect} from 'bun:test';
import {validateLayout,validateAsset,assembleScene,layoutSchema,assetSchema,LAYOUT_PROMPT,ASSET_PROMPT,type SceneLayout,type AssetGeometry} from './layout';
import {compileGeometryProgram} from './program';
import {validateSpace,applySurface,spaceSchema,surfaceSchema,type SpaceLayout,type SurfacePlan} from './layout-stages';
const pose={position:[0,0,0] as [number,number,number],rotation:[0,0,0] as [number,number,number],scale:[1,1,1] as [number,number,number]};
const plan={requirements:[{id:'required_shape',critical:true,count:2}]};
function layout():SceneLayout{return {version:'scene-layout-v1',program:{version:'geometry-v1',name:'双凹形构造',materials:[{id:'mat',color:[.5,.4,.3,1],roughness:.8,metallic:0,textureId:null}],templates:[{id:'novel',label:'凹形支架',origin:'底面左下角，Z向上',description:'两个正交臂与真实缺口',bounds:{min:[0,0,0],max:[3,3,.4]},materialIds:['mat'],maxParts:8}],instances:[{...pose,id:'one',label:'第一支架',template:'novel',requirementIds:['required_shape']},{...pose,id:'two',label:'第二支架',template:'novel',position:[5,0,0],requirementIds:['required_shape']}]},entities:[{instanceId:'one',role:'subject',category:'new_shape'},{instanceId:'two',role:'subject',category:'new_shape'}],cameras:[{name:'参考视角',referenceIndex:1,position:[8,-6,4],target:[4,1,0],fov:1},{name:'另一参考视角',referenceIndex:2,position:[-4,6,3],target:[4,1,0],fov:1}],textures:[],lighting:{direction:[0,.5,-1],color:[1,1,1],intensity:1,ambientColor:[1,1,1],ambientIntensity:.5,points:[]},assumptions:['背面形状为推断']};}
function asset():AssetGeometry{return {version:'asset-geometry-v1',template:{id:'novel',parts:[{...pose,id:'body',material:'mat',uvScale:[1,1],shape:{type:'extrusion',outline:[[0,0],[3,0],[3,1],[1,1],[1,3],[0,3]],depth:.4}}]}};}

test('布局无几何占位；未知类别复用同一资产，组装保留共享坐标与原始机位',()=>{
 const l=validateLayout(layout(),plan,2,'simple'),a=asset();expect(validateAsset(a,l.program.templates[0],l,{}).triangles).toBe(20);
 const s=assembleScene(l,[a],plan,2);expect(s.cameras).toEqual(l.cameras);expect(s.program.instances).toEqual(l.program.instances);
 expect(compileGeometryProgram(s.program).bounds).toEqual({min:[0,0,0],max:[8,3,.4]});
 expect(layoutSchema().properties.program.properties.templates.items.properties).not.toHaveProperty('parts');
 expect(assetSchema().properties).not.toHaveProperty('program');
});
test('布局不能超支、引用缺失资产或丢弃关键需求及参考视角',()=>{
 let l=layout();l.program.templates[0].maxParts=65;expect(()=>validateLayout(l,plan,2,'simple')).toThrow('预算');
 l=layout();l.program.instances[0].template='missing';expect(()=>validateLayout(l,plan,2,'simple')).toThrow('模板');
 l=layout();l.program.templates[0].materialIds=['missing'];expect(()=>validateLayout(l,plan,2,'simple')).toThrow('材质');
 l=layout();l.program.instances[0].requirementIds=[];expect(()=>validateLayout(l,plan,2,'simple')).toThrow('数量');
 l=layout();l.cameras[1].referenceIndex=null;expect(()=>validateLayout(l,plan,2,'simple')).toThrow('参考图');
 l=layout();l.program.templates[0].maxParts=64;l.program.instances.push({...l.program.instances[0],id:'third'},{...l.program.instances[0],id:'fourth'});expect(()=>validateLayout(l,plan,2,'simple')).toThrow('展开后的资产预算');
});
test('单资产不能改身份、材质和共享尺寸；未齐全场景拒绝组装',()=>{
 const l=layout(),brief=l.program.templates[0];let a=asset();a.template.id='other';expect(()=>validateAsset(a,brief,l,{})).toThrow('身份');
 a=asset();a.template.parts[0].material='invented';expect(()=>validateAsset(a,brief,l,{})).toThrow('材质');
 a=asset();a.template.parts[0].position=[10,0,0];expect(()=>validateAsset(a,brief,l,{})).toThrow('边界');
 a=asset();a.template.parts=Array.from({length:9},(_,i)=>({...a.template.parts[0],id:'part'+i}));expect(()=>validateAsset(a,brief,l,{})).toThrow('预算');
 expect(()=>assembleScene(l,[],plan,2)).toThrow('占位物');expect(()=>assembleScene(l,[asset(),asset()],plan,2)).toThrow('身份重复');
});
test('拆分提示词只有一种顶层输出；不含样例名称或坐标',()=>{
 expect(LAYOUT_PROMPT).toContain('只输出 scene-layout-v1');expect(LAYOUT_PROMPT).not.toContain('只返回 geometry-v1');
 expect(ASSET_PROMPT).toContain('只输出一个 asset-geometry-v1');expect(ASSET_PROMPT).not.toContain('只返回 geometry-v1');
 expect(ASSET_PROMPT).toContain('当前资产简报');expect(LAYOUT_PROMPT+ASSET_PROMPT).not.toMatch(/餐厅|街机|diner|8511f808/);
});
test('分开空间与表面规划，不注入虚构材质，不允许表面步骤覆盖几何或遗漏模板',()=>{
 const l=layout(),{materials,templates,...program}=l.program;
 const space:SpaceLayout={version:'scene-space-v1',program:{...program,templates:templates.map(({materialIds,...t})=>t)},entities:l.entities,cameras:l.cameras,assumptions:l.assumptions};
 const surface:SurfacePlan={version:'scene-surface-v1',materials,textures:l.textures,lighting:l.lighting,bindings:templates.map(t=>({templateId:t.id,materialIds:t.materialIds})),assumptions:['表面照明为推断']};
 expect(validateSpace(space,plan,2,'simple')).toEqual(space);expect(space.program).not.toHaveProperty('materials');
 const combined=applySurface(space,surface,plan,2,'simple');expect(combined.program.instances).toEqual(space.program.instances);expect(combined.cameras).toEqual(space.cameras);expect(combined.program.templates[0].bounds).toEqual(space.program.templates[0].bounds);
 expect(spaceSchema().properties).not.toHaveProperty('lighting');expect(surfaceSchema().properties).not.toHaveProperty('cameras');
 expect(()=>applySurface(space,{...surface,bindings:[]},plan,2,'simple')).toThrow('每个冻结模板');
 expect(()=>applySurface(space,{...surface,bindings:[{templateId:'another',materialIds:['mat']}]},plan,2,'simple')).toThrow('每个冻结模板');
 expect(()=>applySurface(space,{...surface,materials:[]},plan,2,'simple')).toThrow('材质');
 const missing=structuredClone(space);missing.cameras[0].referenceIndex=null;expect(()=>validateSpace(missing,plan,2,'simple')).toThrow('参考图');
});
