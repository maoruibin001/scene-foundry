import {test,expect} from 'bun:test';
import {object3dAdvisoryRule,object3dAdvisoryPolicyFor,object3dGrossPass,OBJECT3D_ADVISORY,OBJECT3D_GATE} from './object3d-gate';

test('advisory policy 仅在 object3d 门开 + env 置 1 时生效，默认关',()=>{
 expect(object3dAdvisoryPolicyFor(null,{})).toBeNull();                                  // 无 object3d 门
 expect(object3dAdvisoryPolicyFor({...OBJECT3D_GATE},{})).toBeNull();                     // env 未置
 expect(object3dAdvisoryPolicyFor({...OBJECT3D_GATE},{PIPELINE_OBJECT3D_ADVISORY:'1'})?.version).toBe(OBJECT3D_ADVISORY.version);
 expect(object3dAdvisoryRule({object3dAdvisoryPolicy:{...OBJECT3D_ADVISORY}})).toBe(true);
 expect(object3dAdvisoryRule({})).toBe(false);
});

test('object3dGrossPass：测量粗检全过=true；任一 KEPT 失败=false；object3d 失败不影响',()=>{
 const gate=(checks:any[])=>({objective:{checks}});
 // 只有 object3d 失败，KEPT 都过 -> gross 通过（advisory 会接受）
 expect(object3dGrossPass(gate([
  {id:'critical-visible',passed:true},{id:'not-mirrored',passed:true},{id:'camera-clear',passed:true},{id:'object3d',passed:false},
 ]))).toBe(true);
 // critical-visible 失败 -> gross 不通过（advisory 也拒，守还原度）
 expect(object3dGrossPass(gate([
  {id:'critical-visible',passed:false},{id:'not-mirrored',passed:true},{id:'camera-clear',passed:true},{id:'object3d',passed:false},
 ]))).toBe(false);
 // not-mirrored 失败（镜像）-> 不通过
 expect(object3dGrossPass(gate([
  {id:'critical-visible',passed:true},{id:'not-mirrored',passed:false},{id:'camera-clear',passed:true},
 ]))).toBe(false);
 // 缺某 KEPT 检查（不适用）不算失败
 expect(object3dGrossPass(gate([{id:'object3d',passed:false}]))).toBe(true);
 expect(object3dGrossPass(undefined)).toBe(true);
});
