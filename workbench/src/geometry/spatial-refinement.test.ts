import {test,expect} from 'bun:test';
import {NoActionableChange} from '../contracts';
import {applySpatialRefinement,spatialContext,preferSpatialRefinement,spatialRefinementSchema,SPATIAL_METHOD} from './spatial-refinement';
const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},plan={requirements:[{id:'R1',critical:true,count:null}]};
const scene=():any=>({version:'scene-v1',program:{version:'geometry-v1',name:'任意结构',materials:[{id:'base',color:[1,1,1,1],roughness:.7,metallic:0,textureId:null}],templates:[{id:'subject',parts:[{...pose,id:'body',position:[0,0,1],material:'base',shape:{type:'box',size:[2,2,2],radius:0}}]}],instances:[{...pose,id:'one',label:'主体',template:'subject',position:[5,0,0],requirementIds:['R1']}]},entities:[{instanceId:'one',category:'任意类别',role:'subject'}],cameras:[{name:'参考',referenceIndex:1,position:[8,-4,2],target:[5,0,1],fov:1},{name:'检查',referenceIndex:null,position:[2,4,2],target:[5,0,1],fov:1}],textures:[],textureReuse:[],lighting:{direction:[.5,.5,-.7],color:[1,1,1],intensity:1,ambientColor:[1,1,1],ambientIntensity:.2,points:[]},assumptions:[]});
const patch=():any=>({version:SPATIAL_METHOD,reason:'调整可见物体比例',instances:[],parts:[{templateId:'subject',partId:'body',position:[0,0,1],rotation:[0,0,0],scale:[.75,1,1]}],shapes:[],cameras:[],observations:[{issue:'主体过宽',evidenceFrames:['reference-1.png'],expectedChange:'宽度减少四分之一，保持底面与高度'}]});
test('只有位姿补丁时，原形状、资源、语义和历史不变',()=>{const s=scene(),before=JSON.stringify(s),n=applySpatialRefinement(s,patch(),plan,1,['reference-1.png']);expect(JSON.stringify(s)).toBe(before);expect(n.program.templates[0].parts[0].scale).toEqual([.75,1,1]);expect(n.program.templates[0].parts[0].shape).toEqual(s.program.templates[0].parts[0].shape);for(const k of ['entities','textures','textureReuse','lighting','assumptions'])expect(n[k]).toEqual(s[k]);expect(n.program.materials).toEqual(s.program.materials);expect(n.program.instances).toEqual(s.program.instances);});
test('空间输入使用真实编译范围，区分部件局部与实例世界变换',()=>{const s=scene(),c=spatialContext(s);expect(c.templates[0].parts[0].localBounds).toEqual({min:[-1,-1,0],max:[1,1,2]});expect(c.instances[0].worldBounds).toEqual({min:[4,-1,0],max:[6,1,2]});expect(c.instances[0].projectedBounds).toHaveLength(1);expect(c.templates[0].parts[0].shape).toEqual(s.program.templates[0].parts[0].shape);expect(c.templates[0].parts[0].uvScale).toEqual([1,1]);c.templates[0].parts[0].shape.size[0]=999;expect(s.program.templates[0].parts[0].shape.size[0]).toBe(2);});
test('缺证据、重复或未知对象、缩小隐藏和无变化修正被拒绝',()=>{
 expect(()=>applySpatialRefinement(scene(),{...patch(),parts:[],observations:[]},plan,1,['reference-1.png'])).toThrow(NoActionableChange);
 let p=patch();p.observations[0].evidenceFrames=['invented.png'];expect(()=>applySpatialRefinement(scene(),p,plan,1,['reference-1.png'])).toThrow('帧依据');
 p=patch();p.parts.push(p.parts[0]);expect(()=>applySpatialRefinement(scene(),p,plan,1,['reference-1.png'])).toThrow('重复');
 p=patch();p.parts[0].partId='missing';expect(()=>applySpatialRefinement(scene(),p,plan,1,['reference-1.png'])).toThrow('未知');
 p=patch();p.parts[0].scale=[.01,1,1];expect(()=>applySpatialRefinement(scene(),p,plan,1,['reference-1.png'])).toThrow('0.5–2');
 p=patch();p.parts[0].scale=[1,1,1];expect(()=>applySpatialRefinement(scene(),p,plan,1,['reference-1.png'])).toThrow('没有任何');
 p=patch();p.cameras=[{...scene().cameras[0],referenceIndex:2}];expect(()=>applySpatialRefinement(scene(),p,plan,1,['reference-1.png'])).toThrow('机位');
});
test('空间只优先用于首轮已证明不足的场景，已做过或第二轮不重复盲修',()=>{const r={dimensions:[{id:'spatial',score:3}]};expect(preferSpatialRefinement(r,{score:80},0)).toBe(true);expect(preferSpatialRefinement(r,{score:80},1)).toBe(false);expect(preferSpatialRefinement(r,{score:80},0,SPATIAL_METHOD)).toBe(false);expect(preferSpatialRefinement(r,{score:80},0,'spatial-refinement-v1')).toBe(true);expect(preferSpatialRefinement({dimensions:[{id:'spatial',score:4}]},{score:80},0)).toBe(false);expect(preferSpatialRefinement({}, {score:80},0)).toBe(false);});
test('结构修正复用统一几何契约且不允许外部资产输出',()=>{const walk=(s:any)=>{if(s.type==='object'){expect(s.additionalProperties).toBe(false);expect(s.required).toEqual(Object.keys(s.properties));Object.values(s.properties).forEach(walk);}if(s.items)walk(s.items);if(s.anyOf)s.anyOf.forEach(walk);};walk(spatialRefinementSchema());expect(spatialRefinementSchema().properties).not.toHaveProperty('materials');expect(spatialRefinementSchema().properties).not.toHaveProperty('textures');});

const structuralPatch=()=>({...patch(),parts:[],shapes:[{templateId:'subject',partId:'body',shape:{type:'extrusion',outline:[[-1,-1],[1,-1],[1,1],[.5,1],[.5,-.5],[-.5,-.5],[-.5,1],[-1,1]],depth:1},uvScale:[1.5,1]}]});
test('允许用真实凹轮廓打开复合结构，保留实体语义、材质和原始场景',()=>{
 const s=scene(),before=JSON.stringify(s),p=structuralPatch();p.parts=patch().parts;
 const n=applySpatialRefinement(s,p,plan,1,['reference-1.png']);expect(JSON.stringify(s)).toBe(before);
 expect(n.program.templates[0].parts[0].shape.type).toBe('extrusion');expect(n.program.templates[0].parts[0].uvScale).toEqual([1.5,1]);expect(n.program.templates[0].parts[0].scale).toEqual([.75,1,1]);
 expect(n.program.instances).toEqual(s.program.instances);expect(n.program.materials).toEqual(s.program.materials);expect(n.entities).toEqual(s.entities);expect(n.lighting).toEqual(s.lighting);
});
test('结构编辑拒绝不存在部件、自交轮廓、无效UV、过量编辑及超出渲染预算',()=>{
 let p=structuralPatch();p.shapes[0].partId='invented';expect(()=>applySpatialRefinement(scene(),p,plan,1,['reference-1.png'])).toThrow('未知部件');
 p=structuralPatch();p.shapes.push(p.shapes[0]);expect(()=>applySpatialRefinement(scene(),p,plan,1,['reference-1.png'])).toThrow('重复');
 p=structuralPatch();p.shapes[0].shape.outline=[[-1,-1],[1,1],[-1,1],[1,-1]];expect(()=>applySpatialRefinement(scene(),p,plan,1,['reference-1.png'])).toThrow('自交');
 p=structuralPatch();p.shapes[0].uvScale=[0,1];expect(()=>applySpatialRefinement(scene(),p,plan,1,['reference-1.png'])).toThrow('贴图比例');
 p=structuralPatch();p.shapes=Array(25).fill(p.shapes[0]);expect(()=>applySpatialRefinement(scene(),p,plan,1,['reference-1.png'])).toThrow('数量超限');
 const s=scene();s.program.instances=Array.from({length:25},(_,i)=>({...s.program.instances[0],id:'instance'+i}));s.entities=s.program.instances.map(i=>({instanceId:i.id,category:'任意类别',role:'subject'}));
 p=structuralPatch();p.shapes[0].shape={type:'lathe',profile:Array.from({length:128},(_,i)=>[1,i*.01]),segments:64,arc:null,start:null};expect(()=>applySpatialRefinement(s,p,plan,1,['reference-1.png'])).toThrow('三角形预算');
});
