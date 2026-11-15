import {test,expect} from 'bun:test';
import {sampleSpec} from './fixtures';
import {planSpecExport} from './export-pack';
import {resolveCameraVisibility,opaqueSceneTree,firstOpaqueHit} from './camera-visibility';
test('真实三角形检测：空洞不被包围盒误挡，变换后的实体仍挡住射线',()=>{
 const s=sampleSpec();s.objects[0].transform.position=[0,0,0];s.families[0].generator={id:'GEN-RING-01',params:{outerDiameter:10}};s.objects[0].transform.rotationDeg=[90,0,0];
 const p=planSpecExport(s),root=opaqueSceneTree(p);
 expect(firstOpaqueHit(root,[0,0,12],[0,0,-12])).toBeNull();
 expect(firstOpaqueHit(root,[4.9,0,12],[4.9,0,-12])).not.toBeNull();
});
test('局部修正机位不移动/删掉物体，不改变目标或FOV，原规格不被修改',()=>{
 const s=sampleSpec();s.objects.push({...structuredClone(s.objects[0]),id:'foreground',transform:{position:[0,-12,5],scale:[.3,.3,.3],rotationDeg:[0,0,0],rotationOrder:'XYZ'}});
 s.shots[0].position=[0,-18,4];const before=JSON.stringify(s),p=planSpecExport(s),r=resolveCameraVisibility(s,p);
 expect(JSON.stringify(s)).toBe(before);expect(r.spec.objects).toEqual(s.objects);expect(r.spec.shots[0].target).toEqual(s.shots[0].target);expect(r.spec.shots[0].fovDeg).toBe(s.shots[0].fovDeg);
 expect(r.receipt.decisions[0].after.visible).toBeGreaterThanOrEqual(r.receipt.decisions[0].before.visible);expect(r.receipt.decisions[0].shiftMeters).toBeLessThanOrEqual(r.receipt.maxMove);
});
test('反射探针原点被近距主体包围时寻找开放空间，保留强度和分辨率',()=>{
 const s=sampleSpec();s.lighting.states[0].post.reflectionProbe={intensity:.7,resolution:128};
 const r=resolveCameraVisibility(s,planSpecExport(s)),p=r.receipt.reflectionProbe!;
 expect(p.beforeClearanceMeters).toBeLessThan(1);expect(p.afterClearanceMeters).toBeGreaterThan(1);expect(p.effectivePosition).not.toEqual(p.sourcePosition);
 expect(r.spec.lighting.states[0].post.reflectionProbe?.intensity).toBe(.7);expect(r.spec.lighting.states[0].post.reflectionProbe?.resolution).toBe(128);
});
