import {test,expect} from 'bun:test';
import {cameraPreflight,assertCameraPreflight,rollbackCameraRegressions} from './camera-preflight';
const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};
const fixture=()=>({program:{version:'geometry-v1',name:'净空验证',materials:[{id:'wall',color:[.5,.5,.5,1],roughness:.8,metallic:0,textureId:null}],templates:[{id:'room',parts:[{...pose,id:'panel',material:'wall',position:[2,0,1.6],shape:{type:'box',size:[.1,4,3],radius:0}},{...pose,id:'other',material:'wall',position:[-2,0,1.6],shape:{type:'box',size:[.1,4,3],radius:0}}]}],instances:[{...pose,id:'room_instance',label:'房间',template:'room',requirementIds:[]}]},cameras:[{name:'参考',referenceIndex:1,position:[0,0,1.6],target:[0,5,1.6],fov:1.1}]});
test('导出前用真实三角形识别相机新增冲突，返回具体部件',()=>{
 const scene=fixture();expect(assertCameraPreflight(scene).views[0].status).toBe('ready');scene.program.templates[0].parts[0].position[0]=.08;
 const report=cameraPreflight(scene);expect(report.views[0].blocker).toBe('room_instance__panel__wall');expect(()=>assertCameraPreflight(scene)).toThrow('CAMERA_CLEARANCE_REQUIRED');
});
test('撤回单个新增冲突，保留其他修正和输入；仍需新运行验收',()=>{
 const source=fixture(),candidate=structuredClone(source);candidate.program.templates[0].parts[0].position[0]=.08;candidate.program.templates[0].parts[1].position[0]=-3;
 const before=JSON.stringify({source,candidate}),r=rollbackCameraRegressions(source,candidate);
 expect(r.report.accepted).toBe(true);expect(r.report.reverted.map(x=>x.partId)).toEqual(['panel']);expect(r.scene.program.templates[0].parts[0]).toEqual(source.program.templates[0].parts[0]);expect(r.scene.program.templates[0].parts[1].position[0]).toBe(-3);
 expect(r.report.requiresFreshRuntime).toBe(true);expect(r.report.quality).toBe('not-assessed');expect(JSON.stringify({source,candidate})).toBe(before);
});
test('不改动机位、已有障碍或实例来凑通过；无法完全恢复则原子拒绝',()=>{
 const source=fixture(),moved=structuredClone(source);moved.cameras[0].position[0]=2;
 expect(rollbackCameraRegressions(source,moved).report.accepted).toBe(false);
 const oldBlocked=structuredClone(source);oldBlocked.program.templates[0].parts[0].position[0]=.08;expect(rollbackCameraRegressions(oldBlocked,oldBlocked).report.accepted).toBe(false);
 const doubled=structuredClone(source);doubled.program.templates[0].parts[0].position[0]=.08;doubled.program.templates[0].parts[1].position[0]=-.08;
 const stopped=rollbackCameraRegressions(source,doubled,1);expect(stopped.report.accepted).toBe(false);expect(stopped.scene).toEqual(doubled);expect(stopped.report.reverted).toEqual([]);
});
