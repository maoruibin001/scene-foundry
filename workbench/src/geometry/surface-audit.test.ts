import {test,expect} from 'bun:test';
import {surfaceAudit} from './surface-audit';
import {compactSurfaceAudit} from './repair-diagnostics';
const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};
const detail={seed:1,frequency:8,colorVariation:.1,roughnessVariation:.1,normalStrength:.1,wearCoverage:.05,wearColor:[.2,.2,.2],wearRoughness:.5,wearMetallic:.5};
function scene(width=1,height=1):any{return {program:{version:'geometry-v1',name:'纹理尺度测试',materials:[{id:'mat',color:[1,1,1,1],roughness:.5,metallic:0,textureId:'tex'}],templates:[{id:'unit',parts:[{...pose,id:'surface',material:'mat',shape:{type:'grid',rows:2,columns:2,points:[[0,0,0],[width,0,0],[0,height,0],[width,height,0]],doubleSided:false}}]}],instances:[{...pose,id:'one',label:'墙面',template:'unit',requirementIds:[]}]}};}
test('长方形照片与等比例墙面无拉伸，密度使用真实像素而非单位UV',()=>{
 const s=scene(8,1),before=JSON.stringify(s),row=surfaceAudit(s,{tex:{width:2048,height:256}}).rows[0];
 expect(row.p95Stretch).toBeCloseTo(1);expect(row.medianDensity).toBeCloseTo(256);expect(row.issues).toEqual([]);expect(JSON.stringify(s)).toBe(before);
});
test('窄长贴图在方形墙面上真实拉伸被发现，UV旋转不掩盖拉伸',()=>{
 const s=scene();s.program.templates[0].parts[0].uvTransform={offset:[.3,.7],rotation:Math.PI/4,flipU:true,flipV:false};
 const row=surfaceAudit(s,{tex:{width:4096,height:256}}).rows[0];expect(row.p95Stretch).toBeCloseTo(16);expect(row.issues.some((x:string)=>x.includes('8倍'))).toBe(true);
});
test('程序化材质按实际256像素贴图检查，不再漏掉拉伸',()=>{
 const s=scene(20,1);s.program.materials[0].textureId=null;s.program.materials[0].surfaceDetail=detail;
 const row=surfaceAudit(s).rows[0];expect(row.textureSize).toEqual([256,256]);expect(row.densityUnit).toBe('pixels-per-meter');expect(row.p95Stretch).toBeCloseTo(20);expect(row.issues.some((x:string)=>x.includes('8倍'))).toBe(true);expect(row.channels).toEqual([]);
 const compact=compactSurfaceAudit(s,{});expect(compact.materials[0].textureSize).toEqual([256,256]);expect(compact.issueMeshes).toHaveLength(1);
});
test('实例尺寸和表面覆盖均参与诊断，目标材质才是实际材质',()=>{
 const s=scene();s.program.materials.push({...s.program.materials[0],id:'other',textureId:null,surfaceDetail:detail});
 s.program.instances[0].scale=[10,1,1];s.program.instances[0].surfaceOverrides=[{sourceMaterialId:'mat',targetMaterialId:'other',uvScale:[10,1]}];
 const row=surfaceAudit(s,{tex:{width:4096,height:256}}).rows[0];expect(row.materialId).toBe('other');expect(row.textureSize).toEqual([256,256]);expect(row.p95Stretch).toBeCloseTo(1);expect(row.medianDensity).toBeCloseTo(256);
});
test('面积加权避免细小三角面或细分数量扭曲整体诊断',()=>{
 const s=scene();s.program.templates[0].parts[0].shape={type:'grid',rows:2,columns:3,points:[[0,0,0],[.001,0,0],[1,0,0],[0,1,0],[.001,1,0],[1,1,0]],doubleSided:false};
 const row=surfaceAudit(s,{tex:{width:256,height:256}}).rows[0];expect(row.p95Stretch).toBeCloseTo(1.998,3);expect(row.issues).toEqual([]);
});
test('无贴图纯色不会被误报为贴图失败，低密度表面仍显式记录',()=>{
 const s=scene();s.program.materials[0].textureId=null;expect(surfaceAudit(s).rows[0].issues).toEqual([]);
 s.program.materials[0].surfaceDetail=detail;s.program.instances[0].scale=[100,100,1];s.program.templates[0].parts[0].uvScale=[.01,.01];
 const row=surfaceAudit(s).rows[0];expect(row.medianDensity).toBeCloseTo(.0256);expect(row.issues.some((x:string)=>x.includes('不足 1 像素'))).toBe(true);
});
