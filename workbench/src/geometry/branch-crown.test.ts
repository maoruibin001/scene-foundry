import {test,expect} from 'bun:test';
import {crownFaces,crownSkeleton,type BranchCrown} from './branch-crown';
import {compileGeometryProgram,shapeTriangles} from './program';
import {cross,sub} from './mesh';
import {assertProceduralHandoff} from './procedural-handoff';
import {expandBlockoutGeometry} from './blockout-contract';
import {applyGrayboxLocalParts} from './graybox-local-parts';
const shape=(changes:any={}):BranchCrown=>({type:'branchCrown',size:[1.6,1.2,2],habit:'spreading',stems:4,leafPairs:5,leafLength:.22,leafWidth:.55,curl:.18,seed:77,segments:2,layer:'whole',...changes});
const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};
const part=(s=shape()):any=>({...pose,id:'crown',material:'blockout',shape:s});
const program=(s=shape(),count=1):any=>({version:'geometry-v1',name:'连接式冠层',materials:[{id:'blockout',color:[.5,.5,.5,1],roughness:1,metallic:0,textureId:null}],templates:[{id:'tree',parts:[part(s)]}],instances:Array.from({length:count},(_,n)=>({...pose,id:'tree'+n,label:'冠层',template:'tree',requirementIds:[]}))});

test('三种生长方向均有闭合几何、有限UV/法线，估算与实际面数一致且尺寸不越界',()=>{
 for(const habit of ['upright','spreading','hanging'])for(const segments of [2,4,8]){
  const s=shape({habit,segments}),p=compileGeometryProgram(program(s)),faces=crownFaces(s);
  expect(p.triangles).toBe(faces.length);expect(p.estimatedTriangles).toBe(p.triangles);
  for(let k=0;k<3;k++){expect(p.bounds.min[k]).toBeGreaterThanOrEqual(-s.size[k]/2-1e-8);expect(p.bounds.max[k]).toBeLessThanOrEqual(s.size[k]/2+1e-8);}
  expect(p.meshes.every(m=>[...m.geometry.positions,...m.geometry.normals,...m.geometry.uvs].every(Number.isFinite))).toBe(true);
  const edges=new Map<string,number>();const key=(p:number[])=>p.map(n=>n.toFixed(7)).join(',');
  for(const f of faces){expect(Math.hypot(...cross(sub(f[1].p,f[0].p),sub(f[2].p,f[0].p)))).toBeGreaterThanOrEqual(1e-11);for(let i=0;i<3;i++){const a=key(f[i].p),b=key(f[(i+1)%3].p),e=a<b?a+'|'+b:b+'|'+a;edges.set(e,(edges.get(e)??0)+1);}}
  expect([...edges.values()].every(n=>n===2)).toBe(true);
 }
});
test('固定种子可重复；分辨率或分材质层不会改变枝叶锚点，分层几何并集等于whole',()=>{
 const s=shape();expect(crownSkeleton(s)).toEqual(crownSkeleton(s));expect(crownSkeleton({...s,segments:8,layer:'leaves'})).toEqual(crownSkeleton(s));expect(crownSkeleton({...s,seed:78})).not.toEqual(crownSkeleton(s));
 expect(crownFaces({...s,layer:'branches'}).length+crownFaces({...s,layer:'leaves'}).length).toBe(crownFaces(s).length);
 expect(crownFaces({...s,layer:'branches'})).toEqual(crownFaces({...s,segments:8,layer:'branches'}));
});
test('所有叶片出生点在其枝条曲线上且两个密度档都包含真实空隙',()=>{
 for(const leafPairs of [2,20]){const s=shape({leafPairs}),v=crownSkeleton(s);expect(v.leaves.length).toBe(s.stems*leafPairs*2);expect(v.axes.length).toBe(s.stems);
  for(let k=0;k<v.leaves.length;k++){const stem=Math.floor(k/(leafPairs*2)),j=Math.floor(k/2)%leafPairs,t=.24+.73*(j+.5)/leafPairs,p=v.axes[stem].points;for(let a=0;a<3;a++)expect(v.leaves[k].base[a]).toBeCloseTo((1-t)**3*p[0][a]+3*(1-t)**2*t*p[1][a]+3*(1-t)*t*t*p[2][a]+t**3*p[3][a],10);}
 }
});
test('非法尺寸/数量/分辨率/非有限参数提前拒绝，实例倍率仍受25万总预算约束',()=>{
 for(const bad of [{stems:0},{leafPairs:21},{size:[1,1,NaN]},{leafLength:.8},{curl:Infinity},{segments:3},{layer:'billboard'},{seed:-1}])expect(()=>shapeTriangles(shape(bad))).toThrow('枝冠');
 expect(()=>compileGeometryProgram(program(shape({stems:16,leafPairs:20,segments:8}),4))).toThrow('预算');
});
test('灰模仅允许低细分whole结构，细化保持形态种子，不能把有结构的对象换回孤立大块',()=>{
 expect(()=>expandBlockoutGeometry({templates:[{id:'tree',parts:[part()]}]})).not.toThrow();
 expect(()=>expandBlockoutGeometry({templates:[{id:'tree',parts:[part(shape({segments:8}))]}]})).toThrow('灰模枝冠');
 const scene={program:program()},value={template:{id:'tree',parts:[{...part(shape({segments:4})),material:'green'}]}};
 expect(()=>assertProceduralHandoff(value,scene)).not.toThrow();
 const split={template:{id:'tree',parts:['branches','leaves'].map(layer=>({...part(shape({segments:4,layer})),id:'crown_'+layer,material:layer}))}};
 expect(()=>assertProceduralHandoff(split,scene)).not.toThrow();
 for(const change of [{seed:78},{leafPairs:4},{size:[1,1,1]}])expect(()=>assertProceduralHandoff({template:{id:'tree',parts:[part(shape(change))]}},scene)).toThrow('STRUCTURE_CHANGED');
 expect(()=>assertProceduralHandoff({template:{id:'tree',parts:[]}},scene)).toThrow('STRUCTURE_CHANGED');
 expect(()=>assertProceduralHandoff({template:{id:'tree',parts:[split.template.parts[0]]}},scene)).toThrow('STRUCTURE_CHANGED');
});
test('整组重建保留实体/边界/材料和来源；结构/局部补丁冲突及越界都拒绝',()=>{
 const source={program:program()},space:any={program:{...program(),templates:[{id:'tree',label:'植物',materialIds:['blockout'],maxParts:8,bounds:{min:[-1,-1,-2],max:[1,1,2]}}]},spatialOpenings:[],spatialContacts:[]};
 const before=JSON.stringify(source),group={templateId:'tree',parts:[{...pose,id:'new_crown',shape:shape({habit:'hanging'})}]};
 const result=applyGrayboxLocalParts(source,space,[],[group]);expect(result.changed).toEqual(['tree/*']);expect(result.templates[0].parts[0].shape.type).toBe('branchCrown');expect(JSON.stringify(source)).toBe(before);
 expect(()=>applyGrayboxLocalParts(source,space,[{templateId:'tree',partId:'crown',...pose}],[group])).toThrow('重复修改');
 expect(()=>applyGrayboxLocalParts(source,space,[],[{...group,templateId:'new'}])).toThrow('已有模板');
 expect(()=>applyGrayboxLocalParts(source,space,[],[{...group,parts:[{...group.parts[0],shape:shape({size:[20,20,20]})}]}])).toThrow('边界');
});

test('验收结构最低成本提前满足详细资产预算，旧非枝冠不变且不修改输入',async()=>{
 const {assertProceduralBudget}=await import('./procedural-handoff');
 const s=shape({stems:16,leafPairs:20}),scene={program:program(s)};
 const layout:any={program:{templates:[{id:'tree',maxParts:8},{id:'other',maxParts:64}],instances:[...scene.program.instances,...Array.from({length:3},(_,n)=>({id:'other'+n,template:'other'}))]}};
 const before=JSON.stringify([scene,layout]);expect(()=>assertProceduralBudget(scene,layout)).toThrow('PROCEDURAL_BUDGET_INFEASIBLE');
 const {validateBlockoutTemplate,blockoutGenerationInput}=await import('./blockout-assets');expect(()=>validateBlockoutTemplate({templates:scene.program.templates},layout,layout.program.templates[0])).toThrow('PROCEDURAL_BUDGET_INFEASIBLE');expect(blockoutGenerationInput(layout,layout.program.templates[0]).proceduralTriangleBudget.maximum).toBeGreaterThan(0);
 expect(JSON.stringify([scene,layout])).toBe(before);
 const small={program:program(shape({stems:2,leafPairs:2,segments:8}))};const rows=assertProceduralBudget(small,layout);expect(rows[0].minimumTriangles).toBe(shapeTriangles(shape({stems:2,leafPairs:2,segments:2})));
 expect(rows[0].instances).toBe(1);expect(rows[0].minimumTriangles).toBeLessThan(rows[0].maximumTriangles);
 expect(assertProceduralBudget({program:{templates:[{id:'tree',parts:[]}]}},layout)).toEqual([]);
 const tooMany={program:{...program(),templates:[{id:'tree',parts:[part(shape({stems:2,leafPairs:2})),{...part(shape({stems:2,leafPairs:2})),id:'second'}]}]}};
 layout.program.templates[0].maxParts=1;expect(()=>assertProceduralBudget(tooMany,layout)).toThrow('部件');
});
