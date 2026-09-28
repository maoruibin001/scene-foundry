import {test,expect} from 'bun:test';
import {curvedTriangles,type CurvedShape} from './curved-surfaces';
import {compileGeometryProgram,validateGeometryProgram} from './program';
import {contentBox,referenceProjection} from './reference-projection';
import {surfaceAudit} from './surface-audit';
import {prioritizeAssets} from './asset-priority';
import {assetPreviewScene} from './asset-review';
const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};
function program(shape:any):any{return {version:'geometry-v1',name:'通用样本',materials:[{id:'m',textureId:null,color:[1,1,1,1],roughness:.8,metallic:0}],templates:[{id:'t',parts:[{id:'part',material:'m',...pose,shape}]}],instances:[{id:'i',label:'样本',template:'t',...pose,requirementIds:[]}]};}
const shapes:CurvedShape[]=[{type:'cushion',size:[2,1,.5],roundness:4,seamDepth:.03,segments:6},{type:'cloth',size:[2,1],rows:12,columns:12,foldAmplitude:.06,foldCount:3,edgeDrop:.2,thickness:.01,seed:42},{type:'shell',profile:[[.7,0],[1,.5],[.6,1]],segments:12,thickness:.03,arc:4,start:0,edgeRoughness:.1,seed:10}];
for(const shape of shapes)test(shape.type+' 编译为有厚度的闭合网格，法线一致且受原面数预算约束',()=>{
 const result=compileGeometryProgram(program(shape)),g=result.meshes[0].geometry;
 expect(result.triangles).toBe(curvedTriangles(shape));expect(g.positions.every(Number.isFinite)).toBe(true);expect(g.normals.every(Number.isFinite)).toBe(true);
 const edges=new Map<string,number>();let volume=0;
 const key=(i:number)=>g.positions.slice(i*3,i*3+3).map((n:number)=>Math.round(n*1e6)).join(',');
 for(let n=0;n<g.indices.length;n+=3){const ids=g.indices.slice(n,n+3),v=ids.map((i:number)=>g.positions.slice(i*3,i*3+3));volume+=(v[0][0]*(v[1][1]*v[2][2]-v[1][2]*v[2][1])+v[0][1]*(v[1][2]*v[2][0]-v[1][0]*v[2][2])+v[0][2]*(v[1][0]*v[2][1]-v[1][1]*v[2][0]))/6;
 for(let j=0;j<3;j++){const e=[key(ids[j]),key(ids[(j+1)%3])].sort().join('|');edges.set(e,(edges.get(e)??0)+1);}}
 expect([...edges.values()].every(n=>n===2)).toBe(true);expect(volume).toBeGreaterThan(0);
 const p=program(shape);p.instances=Array.from({length:256},(_,n)=>({...p.instances[0],id:'i'+n}));if(curvedTriangles(shape)*256>250000)expect(()=>validateGeometryProgram(p)).toThrow('预算');
});
test('禁止无厚度、壳体折返自交与非法无限分段',()=>{
 expect(()=>curvedTriangles({...shapes[1],thickness:0} as any)).toThrow();
 expect(()=>curvedTriangles({...shapes[2],profile:[[1,1],[1,0]]} as any)).toThrow();
 expect(()=>curvedTriangles({...shapes[0],segments:Infinity} as any)).toThrow();
});
test('原图黑边坐标转换明确，历史缺裁切不猜测，遮挡标注不冒充完整轮廓误差',()=>{
 expect(contentBox([.1,.2,.5,.6],[0,.1,1,.9])).toEqual([.1,.125,.5,.625]);
 const scene:any={program:program({type:'box',size:[1,1,1],radius:0}),cameras:[{referenceIndex:1,position:[0,-4,1],target:[0,0,0],fov:1}],observedBindings:[{landmarkId:'L',instanceIds:['i']}]};
 const o:any={cameras:[{referenceIndex:1}],landmarks:[{id:'L',views:[{referenceIndex:1,box:[.4,.4,.6,.6],extent:'occluded',evidence:'只见一部分'}]}]};
 expect(referenceProjection(scene,o).unverified).toHaveLength(1);o.cameras[0].contentRect=[0,0,1,1];expect(referenceProjection(scene,o).rows[0].edgeRmse).toBe(null);
 o.landmarks[0].views[0].extent='complete';expect(referenceProjection(scene,o).rows[0].edgeRmse).toBeNumber();
});
test('相同模板的实例可有独立纹理相位，几何共享且不造 PBR 通道',()=>{
 const p=program({type:'box',size:[1,1,1],radius:0});p.instances.push({...p.instances[0],id:'j',surfaceOverrides:[{sourceMaterialId:'m',targetMaterialId:'m',uvScale:null,uvTransform:{offset:[.25,.1],rotation:0,flipU:false,flipV:false}}]});
 const meshes=compileGeometryProgram(p).meshes;expect(meshes[0].geometry.positions).toEqual(meshes[1].geometry.positions);expect(meshes[1].geometry.uvs[0]-meshes[0].geometry.uvs[0]).toBe(.25);
 expect(surfaceAudit({program:p}).rows.every(r=>r.channels.length===0)).toBe(true);
});
test('资产优先级由图像占比和需求决定，孤立预览不添加场景物体',()=>{
 const p=program({type:'box',size:[1,1,1],radius:0}),brief={id:'t',label:'样本',bounds:{min:[-.5,-.5,-.5],max:[.5,.5,.5]}},layout:any={program:p,textures:[],cameras:[],observedBindings:[{landmarkId:'L',instanceIds:['i']}]};
 const ranked=prioritizeAssets([brief,{...brief,id:'other'}],layout,{requirements:[]},{landmarks:[{id:'L',views:[{box:[0,0,.6,.6]}]}]});expect(ranked[0].brief.id).toBe('t');
 const scene=assetPreviewScene({template:p.templates[0]},brief,layout);expect(scene.program.instances).toHaveLength(1);expect(scene.cameras.every(c=>c.referenceIndex===null)).toBe(true);expect(scene.assumptions[0]).toContain('不是参考图机位');
});
