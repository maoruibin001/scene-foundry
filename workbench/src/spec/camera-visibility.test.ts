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
test('反射探针原点被近距主体包围时寻找开放空间，保留强度和分辨率且保持主轴对齐',()=>{
 const s=sampleSpec();s.bounds.max[2]=24;s.lighting.states[0].post.reflectionProbe={intensity:.7,resolution:128};
 const r=resolveCameraVisibility(s,planSpecExport(s)),p=r.receipt.reflectionProbe!;
 expect(p.beforeClearanceMeters).toBeLessThan(1);expect(p.afterClearanceMeters).toBeGreaterThan(1);expect(p.effectivePosition).not.toEqual(p.sourcePosition);
 // 至少两个轴保持在房间中心轴上,避免盒投影虚拟墙面大角度偏斜
 const centeredAxes=p.effectivePosition.filter((v,k)=>Math.abs(v-p.sourcePosition[k]!)<1e-6).length;
 expect(centeredAxes).toBeGreaterThanOrEqual(2);
 expect(r.spec.lighting.states[0].post.reflectionProbe?.intensity).toBe(.7);expect(r.spec.lighting.states[0].post.reflectionProbe?.resolution).toBe(128);
});
test('同心环绕主体组件不误判为外部遮挡，而中景横梁遮挡与灰模代理均可正常避让',()=>{
 const s=sampleSpec(),src=s.families[0]!.sources;
 s.families.push(
  {id:'RING',label:'万向环',description:'同心环',priority:'P0',generator:{id:'GEN-RING-01',params:{outerDiameter:12}},materialSlots:{segment:'steel',outerArmor:'steel',joint:'steel',lightRail:'steel',indicator:'steel'},authority:'master',sources:src},
  {id:'BEAM',label:'横梁',description:'无生成器代理横梁',priority:'P1',generator:{id:'GEN-MISSING-99',params:{}},materialSlots:{frame:'steel'},authority:'design_fill',sources:src},
 );
 // 同心环与核心共球心 [0,0,7]:正对对称机位不应因同心环横跨球面而偏移相机
 s.objects.push({id:'CORE_RING_01',label:'环1',family:'RING',parent:null,transform:{position:[0,0,7],rotationDeg:[25,10,0],rotationOrder:'XYZ',scale:[1,1,1]},params:{},authority:'master',sources:src,confidence:1,notes:''});
 s.shots=[{id:'close_sym',label:'对称近景',position:[0,-14.5,3.2],target:[0,0,7],fovDeg:38}];
 const sym=resolveCameraVisibility(s,planSpecExport(s));
 expect(sym.receipt.decisions[0].subjectAssembly).toEqual(['CORE_001','CORE_RING_01']);
 expect(sym.receipt.decisions[0].shiftMeters).toBe(0);

 // 在 30% 视距处加入一条横贯全屏的中景窄横梁代理(灰模 proxy):密集圆盘与中景视锥应检出遮挡并前移或抬升避开,且保持中轴 X=0
 s.shots=[{id:'main_sym',label:'主视觉',position:[0,-22.5,2.4],target:[0,0,7],fovDeg:48}];
 s.objects.push({id:'MID_BEAM',label:'横梁',family:'BEAM',parent:null,transform:{position:[0,-16,4.0],rotationDeg:[0,0,0],rotationOrder:'XYZ',scale:[1,1,1]},params:{size:[32,0.5,0.6]},authority:'design_fill',sources:src,confidence:1,notes:''});
 const cleared=resolveCameraVisibility(s,planSpecExport(s));
 expect(cleared.receipt.decisions[0].before.visible).toBeLessThan(cleared.receipt.decisions[0].before.subjectRays);
 expect(cleared.receipt.decisions[0].after.visible).toBe(cleared.receipt.decisions[0].after.subjectRays);
 expect(Math.abs(cleared.spec.shots[0]!.position[0])).toBeLessThan(1e-6);
});
