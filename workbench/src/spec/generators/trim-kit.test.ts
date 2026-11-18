import {describe,expect,test} from 'bun:test';
import {model} from '@forgeax/engine/modeling';
import {GEN_CORE,goldbergFaces} from './gen-core.ts';
import {GEN_RING} from './gen-ring.ts';
import {GEN_MECH_ACTUATOR,GEN_WORKSTATION} from './gen-scifi-kit.ts';
import {GENERATORS,GENERATOR_SOURCES} from './index.ts';
import {resolveParams,runGenerator,validateGeneratorAsset} from './kit.ts';
import {pipeRun} from './parts.ts';
import {SURFACE_PATTERNS,surfaceMaps} from './textures.ts';
import {
 appendClevisMount,
 appendHexBolts,
 appendHydraulicStrut,
 bakeScifiTrimMaps,
 clearScifiTrimCache,
 getScifiTrimSheet,
 truePipeRun,
} from './trim-kit.ts';

describe('Sci-Fi Trim Sheet & SurfaceMaps',()=>{
 test('getScifiTrimSheet 声明全部 7 类工业印章模块且布局利用率达标',()=>{
  const sheet=getScifiTrimSheet(512);
  expect(sheet.size).toBe(512);
  expect(Object.keys(sheet.regions)).toEqual(
   expect.arrayContaining([
    'panel-groove',
    'weld-seam',
    'tread-strip',
    'vent-perf',
    'hex-bolt',
    'dome-rivet',
    'serial-tag',
   ]),
  );
  expect(sheet.metrics.strips).toBe(4);
  expect(sheet.metrics.utilization).toBeGreaterThan(0.5);
 });

 test('bakeScifiTrimMaps 字节级确定性、RGBA8 通道语义与 0ms 内存缓存命中',()=>{
  clearScifiTrimCache();
  const first=bakeScifiTrimMaps(256);
  const expectedBytes=256*256*4;
  expect(first.size).toBe(256);
  expect(first.normal.byteLength).toBe(expectedBytes);
  expect(first.metallicRoughness.byteLength).toBe(expectedBytes);
  expect(first.baseColor.byteLength).toBe(expectedBytes);

  // 法线图包含真实印章起伏(不全是平坦 [128,128,255]),AO 与粗糙度有真实梯度,Alpha 恒为 255
  let nonFlatNormals=0,occludedPixels=0,minRough=255,maxRough=0;
  for(let o=0;o<expectedBytes;o+=4){
   if(Math.abs(first.normal[o]!-128)>3||Math.abs(first.normal[o+1]!-128)>3)nonFlatNormals++;
   if(first.metallicRoughness[o]!<250)occludedPixels++;
   const r=first.metallicRoughness[o+1]!;
   if(r<minRough)minRough=r;
   if(r>maxRough)maxRough=r;
   expect(first.normal[o+3]).toBe(255);
   expect(first.metallicRoughness[o+3]).toBe(255);
   expect(first.baseColor[o+3]).toBe(255);
  }
  expect(nonFlatNormals).toBeGreaterThan(1000);
  expect(occludedPixels).toBeGreaterThan(500);
  expect(maxRough-minRough).toBeGreaterThan(40);

  // 缓存命中应在极短时间内返回同一引用
  const t0=performance.now();
  const hit=bakeScifiTrimMaps(256);
  const elapsed=performance.now()-t0;
  expect(elapsed).toBeLessThan(2);
  expect(hit).toBe(first);

  // 清空缓存后重烘焙完全字节一致(确定性契约)
  const copyNormal=new Uint8Array(first.normal);
  const copyMr=new Uint8Array(first.metallicRoughness);
  const copyBc=new Uint8Array(first.baseColor);
  clearScifiTrimCache();
  const rebuilt=bakeScifiTrimMaps(256);
  expect(rebuilt.normal).toEqual(copyNormal);
  expect(rebuilt.metallicRoughness).toEqual(copyMr);
  expect(rebuilt.baseColor).toEqual(copyBc);
 });

 test('textures.ts 注册 trim 纹样并委托 bakeScifiTrimMaps',()=>{
  expect(SURFACE_PATTERNS).toContain('trim');
  const maps=surfaceMaps('trim',128);
  expect(maps.size).toBe(128);
  expect(maps.normal.byteLength).toBe(128*128*4);
  expect(maps).toBe(bakeScifiTrimMaps(128));
 });
});

describe('Mechanical CAD Recipes & PipeNetwork Helpers',()=>{
 test('pipeRun / truePipeRun 在合法三维折线上命中 m.pipeNetwork,在急折或超短段无损回退 polyRod',()=>{
  const m=model();
  const okUsed=truePipeRun(
   m,
   [
    [0,0,0],
    [0.45,0,0],
    [0.45,0.5,0],
    [0.45,0.5,0.4],
   ],
   0.025,
   'pipe',
   'flange',
   12,
  );
  expect(okUsed).toBe(true);
  expect(m.poisoned).toBeUndefined();

  // 冗余共线中点自动清理后仍能命中 pipeNetwork
  const collinearUsed=pipeRun(
   m,
   [
    [-0.5,0,0],
    [-0.25,0,0],
    [0,0,0],
    [0,0.45,0],
   ],
   0.02,
   'pipe',
   'flange',
   12,
  );
  expect(collinearUsed).toBe(true);

  // 超短折线或 <15° 发卡急折角无损回退到 polyRod,且绝不污染主会话 m.poisoned
  const fallbackShort=truePipeRun(
   m,
   [
    [1,0,0],
    [1.02,0,0],
    [1.005,0.002,0],
   ],
   0.04,
   'pipe',
   'flange',
   10,
  );
  expect(fallbackShort).toBe(false);
  expect(m.poisoned).toBeUndefined();

  const diag=validateGeneratorAsset('TEST-PIPE',m);
  expect(diag.pass).toBe(true);
  expect(diag.errors).toHaveLength(0);
 });

 test('appendHexBolts / appendClevisMount / appendHydraulicStrut 生成零拓扑错误的精密标准件',()=>{
  const m=model();
  appendHexBolts(
   m,
   [
    {position:[-0.2,0,0],normal:[0,1,0]},
    {position:[0.2,0,0],normal:[1,0,0]},
   ],
   {size:'M16',length:0.04,material:'bolt'},
  );
  appendClevisMount(m,{position:[0,0.2,0.3],jawDir:[0,1,0],pinDiameter:0.03,material:'housing',pinMaterial:'bolt'});
  appendHydraulicStrut(m,{
   from:[0,0.1,-0.2],
   to:[0.1,0.95,0.05],
   bore:0.08,
   extension:0.5,
   housingMaterial:'housing',
   pistonMaterial:'piston',
   mountMaterial:'bolt',
   withClevis:true,
  });
  const check=validateGeneratorAsset('TEST-RECIPES',m);
  expect(check.pass).toBe(true);
  expect(check.faces).toBeGreaterThan(200);
  expect(check.errors).toHaveLength(0);
 });
});

describe('Showcase Generators & Upgraded Core / Ring',()=>{
 test('index.ts 注册新生成器与导出源码清单',()=>{
  expect(GENERATORS['GEN-WORKSTATION-01']).toBe(GEN_WORKSTATION);
  expect(GENERATORS['GEN-MECH-ACTUATOR-01']).toBe(GEN_MECH_ACTUATOR);
  expect(GENERATOR_SOURCES).toContain('trim-kit.ts');
  expect(GENERATOR_SOURCES).toContain('gen-scifi-kit.ts');
 });

 test('GEN-WORKSTATION-01 与 GEN-MECH-ACTUATOR-01 默认/边界构建合法、确定性重建且通过 validateGeneratorAsset',()=>{
  for(const g of [GEN_WORKSTATION,GEN_MECH_ACTUATOR]){
   expect(g.slots.every(s=>/^[a-z][A-Za-z0-9-]{0,40}$/.test(s))).toBe(true);

   const meshA=runGenerator(g,{},'a');
   const meshB=runGenerator(g,{},'a');
   expect(meshA.vertices).toEqual(meshB.vertices);
   expect(meshA.indices).toEqual(meshB.indices);
   expect((meshA.materialSlots??[]).length).toBe(g.slots.length);

   // 最小边界与最大边界均可无错构建出合法网格
   const minVals:Record<string,any>={},maxVals:Record<string,any>={};
   for(const [k,def] of Object.entries(g.params)){
    if(def.type==='bool'){minVals[k]=false;maxVals[k]=true;}
    else if(def.type==='vec3'){minVals[k]=[def.min,def.min,def.min];maxVals[k]=[def.max,def.max,def.max];}
    else if(def.type==='number'||def.type==='int'){minVals[k]=def.min;maxVals[k]=def.max;}
   }
   expect(runGenerator(g,minVals,'min').vertices.byteLength).toBeGreaterThan(0);
   expect(runGenerator(g,maxVals,'max').vertices.byteLength).toBeGreaterThan(0);
   expect(()=>runGenerator(g,{unknownKey:1} as any,'bad')).toThrow();

   const m=model();
   const {params}=resolveParams(g,{});
   g.build(m,params);
   const v=validateGeneratorAsset(g.id,m);
   expect(v.pass).toBe(true);
   expect(v.errors).toHaveLength(0);
  }
 });

 test('GEN-CORE-01 保持 Goldberg 10f^2+2 兼容并在缩进内核时生成内部反应堆肋环',()=>{
  expect(goldbergFaces(1)).toHaveLength(12);
  expect(goldbergFaces(3)).toHaveLength(92);

  // 默认 coreScale=0.995 时开关 innerLattice 输出完全一致(100% 向后兼容)
  const defOn=runGenerator(GEN_CORE,{panelFrequency:2,innerLattice:true},'c1');
  const defOff=runGenerator(GEN_CORE,{panelFrequency:2,innerLattice:false},'c1');
  expect(defOn.vertices).toEqual(defOff.vertices);

  // coreScale<0.96 时 innerLattice=true 增加多层内部测地肋环与极孔反应堆结构
  const deepOff=runGenerator(GEN_CORE,{panelFrequency:2,coreScale:0.82,innerLattice:false},'c2');
  const deepOn=runGenerator(GEN_CORE,{panelFrequency:2,coreScale:0.82,innerLattice:true},'c2');
  expect(deepOn.vertices.byteLength).toBeGreaterThan(deepOff.vertices.byteLength+4000);

  const m=model();
  GEN_CORE.build(m,resolveParams(GEN_CORE,{panelFrequency:2,coreScale:0.82,innerLattice:true}).params);
  expect(validateGeneratorAsset(GEN_CORE.id,m).pass).toBe(true);
 });

 test('GEN-RING-01 装配真实六角螺栓与内缘能量导管肋并通过网格内核校验',()=>{
  const meshBase=runGenerator(GEN_RING,{segments:6,rivetSpacing:0},'r0');
  const meshRiveted=runGenerator(GEN_RING,{segments:6,rivetSpacing:0.5},'r1');
  expect(meshRiveted.vertices.byteLength).toBeGreaterThan(meshBase.vertices.byteLength);

  const m=model();
  GEN_RING.build(m,resolveParams(GEN_RING,{segments:6,rivetSpacing:0.6}).params);
  const check=validateGeneratorAsset(GEN_RING.id,m);
  expect(check.pass).toBe(true);
  expect(check.errors).toHaveLength(0);
 });
});
