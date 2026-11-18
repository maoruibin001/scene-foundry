import {test,expect} from 'bun:test';
import {planSpecExport} from './export-pack';
import {sampleSpec} from './fixtures';
import {specPrecheck,specPrecheckMessage} from './spec-precheck';
import type {SceneSpec} from './schema';

test('前置检查与真实导出计划对同一规格给出一致结论',()=>{
 const spec=sampleSpec(),plan=planSpecExport(spec),pre=specPrecheck(spec);
 expect(pre.unresolved).toEqual(plan.report.unresolved);
 expect(pre.errors).toEqual(plan.report.errors);
 expect(pre.proxies).toBe(plan.report.proxies.length);
 expect(pre.dropped).toBe(plan.report.dropped.length);
});

test('不合契约的生成器参数在入库前就能列出对象与原因，且不修改规格',()=>{
 const spec=sampleSpec(),src=[{kind:'doc' as const,ref:'contract'}];
 spec.families=[{id:'HALL',label:'大厅',description:'',priority:'P0',generator:{id:'GEN-HALL-01',params:{}},materialSlots:{column:'steel'},authority:'master',sources:src}];
 spec.objects=[{id:'HALL_001',label:'大厅',family:'HALL',parent:null,
  transform:{position:[0,0,0],rotationDeg:[0,0,0],rotationOrder:'XYZ',scale:[1,1,1]},
  params:{wallDetail:2},authority:'master',sources:src,confidence:1,notes:''}];
 const snapshot=JSON.stringify(spec);
 const pre=specPrecheck(spec);
 expect(pre.unresolved.length).toBeGreaterThan(0);
 expect(pre.unresolved[0]!.object).toBe('HALL_001');
 expect(specPrecheckMessage(pre)).toContain('wallDetail');
 expect(JSON.stringify(spec)).toBe(snapshot);
});

test('合法规格的前置检查不产生错误且提示为空',()=>{
 const pre=specPrecheck(sampleSpec() as SceneSpec);
 expect(pre.errors).toEqual([]);
 expect(specPrecheckMessage(pre)).toBe('');
});
