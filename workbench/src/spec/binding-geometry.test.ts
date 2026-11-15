import {test,expect} from 'bun:test';
import {bindingPointWorld,bindingGeometryIssues} from './binding-geometry';
import {sampleSpec} from './fixtures';
test('引擎局部点转换保留规格 Z向上、缩放和固定XYZ旋转',()=>{
 const o=sampleSpec().objects[0];o.transform.position=[14,0,3.2];o.transform.rotationDeg=[0,0,0];o.transform.scale=[1,1,1];expect(bindingPointWorld(o,[0,0,-16])).toEqual([14,16,3.2]);o.transform.rotationDeg=[0,0,90];const v=bindingPointWorld(o,[0,0,-16]);expect(v[0]).toBeCloseTo(-2);expect(v[1]).toBeCloseTo(0);expect(v[2]).toBeCloseTo(3.2);
});
test('类型合法但竖直穿出边界的桥架与暗改门斗尺寸仍必须待决',()=>{
 const s=sampleSpec(),o=s.objects[0];s.bounds={min:[-24,-27.5,-3],max:[24,27.5,20]};o.transform.position=[14,0,3.2];o.transform.rotationDeg=[0,0,0];o.geometryBinding={id:'GEN-CABLETRAY-01',params:{path:[0,-16,0,0,16,0],trayWidth:.4,trayDepth:.12,supportSpacing:2},basis:'design_fill',reason:'沿墙与步道布置桥架'};
 expect(bindingGeometryIssues(s).some(x=>x.kind==='path-outside-source-world-bounds')).toBe(true);o.geometryBinding.params.path=[0,0,-16,0,0,16];expect(bindingGeometryIssues(s)).toEqual([]);
 o.geometryBinding={id:'GEN-ENTRY-01',params:{doorHeight:4.5,vestibuleHeight:4.5},basis:'design_fill',reason:'按输入尺寸补全部件'};expect(bindingGeometryIssues(s).some(x=>x.key==='vestibuleHeight')).toBe(true);
});
test('两个显式世界放置点的连接不可因换轴错误变成竖柱',()=>{
 const s=sampleSpec(),o=s.objects[0];o.transform.position=[7.5,-1.5,2];o.transform.rotationDeg=[0,0,0];o.transform.scale=[1,1,1];o.params={placement:'(7.5,-1.5,2)/(7.5,1.5,2)'};o.geometryBinding={id:'GEN-BRACE-01',params:{endPoint:[0,3,0]},basis:'design_fill',reason:'连接明确的两个位置'};expect(bindingGeometryIssues(s).some(x=>x.kind==='endpoint-misses-explicit-placement-pair')).toBe(true);o.geometryBinding.params.endPoint=[0,0,-3];expect(bindingGeometryIssues(s)).toEqual([]);
});
test('定向修正只允许诊断字段，不能换生成器或缩短路径碰通过',async()=>{
 const {validateGeometryCorrection}=await import('./parameter-repair');const s=sampleSpec(),o=s.objects[0];s.bounds={min:[-24,-27.5,-3],max:[24,27.5,20]};o.transform.position=[14,0,3.2];o.transform.rotationDeg=[0,0,0];o.geometryBinding={id:'GEN-CABLETRAY-01',params:{path:[0,-16,0,0,16,0],trayWidth:.4,trayDepth:.12,supportSpacing:2},basis:'design_fill',reason:'按来源沿墙布置桥架'};
 const params=(path:number[])=>Object.entries({...o.geometryBinding!.params,path}).map(([key,v])=>({key,number:typeof v==='number'?v:null,numbers:Array.isArray(v)?v:null,flag:null}));
 const b={objects:[o.id],generator:'GEN-CABLETRAY-01',params:params([0,0,-16,0,0,16])},issues=bindingGeometryIssues(s);expect(()=>validateGeometryCorrection(s,issues,{bindings:[b]})).not.toThrow();expect(()=>validateGeometryCorrection(s,issues,{bindings:[{...b,generator:'GEN-PROP-01'}]})).toThrow('替换');expect(()=>validateGeometryCorrection(s,issues,{bindings:[{...b,params:params([0,0,-1,0,0,1])}]})).toThrow('缩短');
});
