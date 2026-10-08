import {test,expect} from 'bun:test';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {validateMaterialEmission,emissionSurface,materialEmissionSchema,MATERIAL_EMISSION_GUIDANCE} from './material-emission';
import {compileGeometryProgram,validateGeometryProgram,type GeometryProgram} from './program';
import {geometryProgramSchema,GEOMETRY_RULES} from './program-schema';
import {surfaceSchema,SURFACE_PROMPT} from './layout-stages';
import {refinementSchema} from './refinement';
import {prepareGeometryProject} from './prepare';
const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]} as any;
const fixture=():GeometryProgram=>({version:'geometry-v1',name:'自发光导出',materials:[{id:'shade',color:[.5,.4,.3,.92],roughness:.7,metallic:0,textureId:null}],templates:[{id:'lamp',parts:[{...pose,id:'shell',material:'shade',shape:{type:'box',size:[1,1,1],radius:0}}]}],instances:[{...pose,id:'one',label:'测试灯罩',template:'lamp',requirementIds:[]}]});
const emission={color:[1,.48,.16] as [number,number,number],intensity:.35};
const detail={seed:123,frequency:8,colorVariation:.1,roughnessVariation:.1,normalStrength:.01,wearCoverage:0,wearColor:[.09,.075,.06],wearRoughness:.6,wearMetallic:0} as any;
test('历史未声明与null保持完全相同的编译结果，零强度保留明确声明',()=>{
 const p=fixture(),old=compileGeometryProgram(p);p.materials[0].emission=null;expect(JSON.stringify(compileGeometryProgram(p))).toBe(JSON.stringify(old));
 expect(old.meshes[0].geometry.material.surface).toEqual({baseColor:[.5,.4,.3,.92],roughness:.7,metallic:0});
 expect(emissionSurface({color:[1,0,0],intensity:0})).toEqual({emissive:[1,0,0],emissiveIntensity:0});
});
test('拒绝非有限、越界、路径及未知字段，在任何几何展开前失败',()=>{
 for(const value of [{},[],1,'x',{...emission,color:[1,1]},{...emission,color:[2,0,0]},{...emission,color:[NaN,0,0]},{...emission,intensity:Infinity},{...emission,intensity:-1},{...emission,intensity:8.01},{...emission,intensity:'1'},{...emission,url:'file:///private'}]){
  expect(()=>validateMaterialEmission(value)).toThrow('emission');const p=fixture();p.materials[0].emission=value as any;expect(()=>validateGeometryProgram(p)).toThrow('emission');
 }
 expect(()=>validateMaterialEmission({color:[0,1,0],intensity:8})).not.toThrow();
});
test('纯色、照片、程序及照片叠加程序四条路径都保留自发光且不改原PBR通道',()=>{
 const tex:any={width:1,height:1,rgba8:Buffer.from([128,100,70,255]).toString('base64'),colorSpace:'srgb'};
 for(const useTexture of [false,true])for(const useDetail of [false,true]){
  const p=fixture();p.materials[0].textureId=useTexture?'photo':null;p.materials[0].surfaceDetail=useDetail?detail:null;
  const old=compileGeometryProgram(p,{photo:tex}),before=JSON.stringify(p);p.materials[0].emission=structuredClone(emission);
  const result=compileGeometryProgram(p,{photo:tex}),surface=result.meshes[0].geometry.material.surface;
  const {emissive,emissiveIntensity,...rest}=surface;expect(rest).toEqual(old.meshes[0].geometry.material.surface);expect(emissive).toEqual(emission.color);expect(emissiveIntensity).toBe(.35);
  expect(result.meshes[0].geometry.positions).toEqual(old.meshes[0].geometry.positions);expect(result.meshes[0].geometry.normals).toEqual(old.meshes[0].geometry.normals);expect(result.meshes[0].geometry.uvs).toEqual(old.meshes[0].geometry.uvs);
  delete p.materials[0].emission;expect(JSON.stringify(p)).toBe(before);emissive[0]=0;expect(emission.color[0]).toBe(1);
 }
});
test('实例外观覆盖使用目标材质自发光，不把发光泄漏到共享模板的其他实例',()=>{
 const p=fixture();p.materials.push({...p.materials[0],id:'lit',emission});p.instances.push({...p.instances[0],id:'two',surfaceOverrides:[{sourceMaterialId:'shade',targetMaterialId:'lit',uvScale:null}]});
 const result=compileGeometryProgram(p);expect(result.meshes[0].geometry.material.surface.emissive).toBeUndefined();expect(result.meshes[1].geometry.material.surface.emissiveIntensity).toBe(.35);
});
test('初始材质计划和修正同用数据契约，并清楚区分表面亮度与真实落光',()=>{
 expect(geometryProgramSchema().properties.materials.items.properties.emission).toEqual(materialEmissionSchema());
 expect(surfaceSchema().properties.materials.items.properties.emission).toEqual(materialEmissionSchema());
 expect(refinementSchema().properties.materials.items.properties.emission).toEqual(materialEmissionSchema());
 expect(GEOMETRY_RULES).toContain(MATERIAL_EMISSION_GUIDANCE);expect(SURFACE_PROMPT).toContain(MATERIAL_EMISSION_GUIDANCE);
 expect(MATERIAL_EMISSION_GUIDANCE).toContain('不会照亮桌面');
});
test('正常prepare保存真实编译字段和可移植依赖，输入材质不被写回',async()=>{
 const root=mkdtempSync(join(tmpdir(),'material-emission-')),p=fixture();p.materials[0].emission=emission;const before=JSON.stringify(p);
 try{
  prepareGeometryProject(root,p);expect(JSON.stringify(p)).toBe(before);
  const receipt=JSON.parse(readFileSync(join(root,'material-emission-export.json'),'utf8'));expect(receipt.materials[0]).toMatchObject({materialId:'shade',emission,compiled:[{emissive:emission.color,emissiveIntensity:.35}]});
  const portable=await import(join(root,'source/geometry/program.ts'));expect(portable.compileGeometryProgram(p)).toEqual(compileGeometryProgram(p));
  delete p.materials[0].emission;prepareGeometryProject(root,p);expect(JSON.parse(readFileSync(join(root,'material-emission-export.json'),'utf8')).materials).toEqual([]);
 }finally{rmSync(root,{recursive:true,force:true});}
});
