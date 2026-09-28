import {test,expect} from 'bun:test';
import {reusedSpatialBaseline} from './reused-space';
import {assertSpatialAccepted} from './spatial-order';
const scene=()=>({program:{instances:[{id:'wall',position:[0,0,0]}]},cameras:[{name:'参考',position:[1,2,3]}],observedBindings:[{landmarkId:'wall-observation',instanceIds:['wall']}],spatialRelations:[{id:'wall-relation',description:'主体位于墙前',critical:true,instanceIds:['wall']}]});
test('完整保存场景提供复验基准，但不冒充灰模通过',()=>{
 const original:any={id:'source'},s=scene(),before=JSON.stringify({original,s}),r=reusedSpatialBaseline(original,s);
 expect(r.provenance.source).toBe('generated-scene.json');expect(r.provenance.requiresFreshGraybox).toBe(true);
 expect(r.space.spatialRelations).toEqual(s.spatialRelations);expect(()=>assertSpatialAccepted(original,s)).toThrow('SPATIAL_GATE_REQUIRED');
 r.space.cameras[0].position=[4,5,6];expect(JSON.stringify({original,s})).toBe(before);
});
test('已有空间记录优先保留其原始关系，仍需重新验收',()=>{
 const s=scene(),prior={...scene(),spatialRelations:[{...s.spatialRelations[0],description:'已保存的关系'}]},r=reusedSpatialBaseline({id:'source',blockout:{status:'passed',space:prior}},s);
 expect(r.provenance.source).toBe('job.blockout.space');expect(r.space.spatialRelations[0].description).toBe('已保存的关系');
 expect(()=>assertSpatialAccepted({blockout:{status:'passed',space:r.space}},s)).toThrow('SPATIAL_GATE_REQUIRED');
});
test('缺失观察或关系、悬空实例及损坏历史记录均在调用模型前拒绝',()=>{
 const s=scene();
 expect(()=>reusedSpatialBaseline({}, {...s,observedBindings:[]})).toThrow('REFERENCE_SPATIAL_REPLAN_REQUIRED');
 expect(()=>reusedSpatialBaseline({}, {...s,spatialRelations:[]})).toThrow('空间关系');
 expect(()=>reusedSpatialBaseline({}, {...s,program:{instances:[]}})).toThrow('实例绑定不完整');
 expect(()=>reusedSpatialBaseline({}, {...s,observedBindings:[{landmarkId:'wall-observation',instanceIds:['unknown']}]})).toThrow('实例绑定不完整');
 expect(()=>reusedSpatialBaseline({blockout:{space:{...s,spatialRelations:[]}}},s)).toThrow('空间关系');
});
