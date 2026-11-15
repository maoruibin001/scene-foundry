import {test,expect} from 'bun:test';
import {sampleSpec} from './fixtures';
import {inspectSpecParameters,planSpecExport} from './export-pack';
import {applyParameterBindings} from './parameter-repair';
import {bindDimensionalAliases} from './parameter-binding';
import {GENERATORS} from './generators';
import {resolveParams,runGenerator} from './generators/kit';
const ctx={id:'object',position:[0,0,0] as [number,number,number]};
test('尺寸别名逐轴校验，不因适配过其他字段就丢弃结构尺寸',()=>{
 const hall=GENERATORS['GEN-HALL-01'];let r=bindDimensionalAliases(hall,{size:[48,55,20],width:48,length:55,height:20,envelope:'48×55×20'},ctx);
 expect(r.values.size).toBeUndefined();expect(r.values.envelope).toBeUndefined();expect(r.values.height).toBe(20);
 r=bindDimensionalAliases(hall,{size:[48,55,20],height:30},ctx);expect(r.values.size).toEqual([48,55,20]);
 expect(bindDimensionalAliases(hall,{envelope:'沿墙弯曲'},ctx).values.envelope).toBe('沿墙弯曲');
});
test('合法边界、开关厚度、密度、数量不应误变代理',()=>{
 for(const [id,raw,key,want] of [['GEN-CORE-01',{bandLatitude:0},'bandLatitude',0],['GEN-MECH-ACTUATOR-01',{conduits:6},'conduits',6],['GEN-WORKSTATION-01',{holoDiameter:1.2},'holoDiameter',1.2],['GEN-NODEBEAM-02',{filament:true},'filament',.016],['GEN-GLASS-01',{gasket:false},'gasket',0],['GEN-FLOOR-01',{clutter:.3},'clutter',.3],['GEN-EQUIPGROUP-01',{cabinets:6},'cabinets',6]] as const){const r=resolveParams(GENERATORS[id],raw as any);expect(r.errors).toEqual([]);expect(r.params[key]).toBe(want);}
 const g=GENERATORS['GEN-EQUIPGROUP-01'],mesh=runGenerator(g,{width:2,depth:1.5,cabinets:6},'six-cabinets');const smaller=runGenerator(g,{width:2,depth:1.5,cabinets:2},'two-cabinets');expect(mesh.indices.length).toBeGreaterThan(smaller.indices.length);
});
test('参数修复只能处理待决对象，保存原输入及设计补全，不能移动删除或漏掉参数',()=>{
 const s=sampleSpec();s.families[0].generator={id:'GEN-NODE-01',params:{height:-5}};s.objects[0].params={};
 const g=GENERATORS['GEN-NODE-01'];const params=Object.entries(g.params).map(([key,d])=>({key,number:typeof d.default==='number'?d.default:null,numbers:Array.isArray(d.default)?d.default:null,flag:typeof d.default==='boolean'?d.default:null}));
 const binding={objects:[s.objects[0].id],generator:g.id,params,basis:'design_fill',reason:'按来源尺寸与节点部件用途补全合法的生成器几何参数'};
 const before=JSON.stringify(s),r=applyParameterBindings(s,{bindings:[binding],unresolved:[]});expect(JSON.stringify(s)).toBe(before);expect(r.spec.objects.map(o=>[o.id,o.family,o.params,o.transform])).toEqual(s.objects.map(o=>[o.id,o.family,o.params,o.transform]));expect(r.receipt.decisions[0].basis).toBe('design_fill');expect(inspectSpecParameters(r.spec).proxies).toHaveLength(0);
 expect(()=>applyParameterBindings(s,{bindings:[{...binding,objects:['no-such-object']}]})).toThrow('非待决');
 expect(()=>applyParameterBindings(s,{bindings:[{...binding,params:params.slice(1)}]})).toThrow('给齐');
});
