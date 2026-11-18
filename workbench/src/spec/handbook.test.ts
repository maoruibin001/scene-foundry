import {test,expect} from 'bun:test';
import {existsSync,readFileSync} from 'node:fs';
import {findTable,parseHtmlDocument} from './doc-source';
import {expandIds,handbookGenerators,handbookLeaves,handbookObjects,parseEnvelope,parseGeneratorParams,parseLeafName} from './handbook';
import {mergeFamilies,mergeObjects,mergeObjectShards,mergeStaging,reconcileStagingRefs,sanitizeDecals} from './normalize-doc';
import {reconcileSpec} from './reconcile';
import {validateSceneSpec} from './schema';
import {sampleSpec} from './fixtures';

const row=(...cells:string[])=>'<tr>'+cells.map(c=>`<td>${c}</td>`).join('')+'</tr>';
const FIXTURE=`<html><head><title>手册</title><style>.x{}</style></head><body>
<h2>B2. 稳定ID与初始摆位</h2><p>说明&amp;注意</p>
<table>${row('ID','数量/位置（米）','朝向/包络P值','交互与限制')}${row('CORE_001','(0,0,7)','球径8','核心')}${row('CORE_RING_01/02','同核心中心','倾角候选(25,10,0)、(-20,35,30)','环')}${row('NODE_01','(-15,-15,0)','2×2×3，弱点朝内部通道','')}${row('NODE_02','(15,-15,0)','同上','')}${row('PROP_BOX_01/02','(14,-6,0)/(18,1,0)','0.8×0.6×0.6','')}</table>
<h2>3. 程序化参数表</h2>
<table>${row('生成器ID','输入参数：默认值P','输出','边界与禁止')}${row('GEN-RING-01','outer_diameter11/13/15、radial_width0.35、segments8','环段','按弧长')}${row('GEN-PIPE-01','spline、diameter0.1/0.25/0.5、bend_radius≥1.5×diameter','管','曲率')}</table>
<h2>2. 建筑结构</h2>
<table>${row('ID','叶资产与建议实例数','细分/参数要求','优先级与验收重点')}${row('ENV-001','主承重柱，16','柱高','P1；尺度')}${row('ENV-004','墙面基础板，40–60','宽高','P0；无漏光')}${row('COR-005','倾斜环标准段，24起步','分段','P0；闭环')}</table>
<img alt="01 · 主视觉基准" src="data:image/jpeg;base64,/9j/AA=="> 主视觉说明
</body></html>`;

test('HTML 文档拆成章节、表格与内嵌图片',()=>{
 const doc=parseHtmlDocument(FIXTURE);
 expect(doc.title).toBe('手册');expect(doc.tables).toHaveLength(3);expect(doc.images).toHaveLength(1);
 expect(doc.images[0].alt).toBe('01 · 主视觉基准');expect(doc.images[0].caption).toBe('主视觉说明');
 expect(findTable(doc,['ID','数量/位置（米）','朝向/包络P值','交互与限制']).section).toBe('B2. 稳定ID与初始摆位');
 expect(doc.sections.some(s=>s.text.includes('说明&注意'))).toBe(true);
 expect(()=>findTable(doc,['不存在'])).toThrow('DOC_TABLE_MISSING');
});

test('对象表:多 ID 展开、同上、同核心中心、倾角候选',()=>{
 const objects=handbookObjects(parseHtmlDocument(FIXTURE)),by=(id:string)=>objects.find(o=>o.id===id)!;
 expect(objects.map(o=>o.id)).toEqual(['CORE_001','CORE_RING_01','CORE_RING_02','NODE_01','NODE_02','PROP_BOX_01','PROP_BOX_02']);
 expect(by('CORE_001').size).toEqual([8,8,8]);
 expect(by('CORE_RING_02')).toMatchObject({position:[0,0,7],rotationDeg:[-20,35,30],size:null});
 expect(by('NODE_02').size).toEqual([2,2,3]);
 expect(by('PROP_BOX_02').position).toEqual([18,1,0]);
 expect(expandIds('BRACE_01/02')).toEqual(['BRACE_01','BRACE_02']);
 expect(parseEnvelope('20×24，轴对齐')).toEqual([20,24,0]);
});

test('生成器参数与叶资产数量',()=>{
 expect(parseGeneratorParams('outer_diameter11/13/15、radial_width0.35、segments8').params).toEqual({outerDiameter:[11,13,15],radialWidth:0.35,segments:8});
 expect(parseGeneratorParams('rise5、step_height目标0.17').params).toEqual({rise:5,stepHeight:0.17});
 expect(parseGeneratorParams('size(0.8,0.6,0.6)、bevel0.015、variant_seed')).toEqual({params:{size:[0.8,0.6,0.6],bevel:0.015},inputs:['variantSeed']});
 expect(handbookGenerators(parseHtmlDocument(FIXTURE))[1]).toMatchObject({id:'GEN-PIPE-01',inputs:['spline'],params:{diameter:[0.1,0.25,0.5],bendRadius:'≥1.5×diameter'}});
 expect(parseLeafName('墙面基础板，40–60').count).toEqual([40,60]);
 expect(parseLeafName('倾斜环标准段，24起步').count).toEqual([24,null]);
 expect(handbookLeaves(parseHtmlDocument(FIXTURE)).map(l=>[l.id,l.priority])).toEqual([['ENV-001','P1'],['ENV-004','P0'],['COR-005','P0']]);
});

test('合并时 master 字段以表格为准,对账能检出偏差与去向不明',()=>{
 const doc=parseHtmlDocument(FIXTURE),facts={masters:handbookObjects(doc),generators:handbookGenerators(doc),leaves:handbookLeaves(doc)};
 const p=(name:string,number:number|null,numbers:number[]|null=null)=>({name,number,numbers,text:null,flag:null});
 const {families,materials}=mergeFamilies({materials:sampleSpec().materials,families:[{id:'RING',label:'环',description:'分段环',priority:'P0',covers:['COR-005'],generatorId:'GEN-RING-01',generatorParams:[p('outerDiameter',null,[1,2,3]),p('extra',1)],materialSlots:[{slot:'shell',material:'steel'}],authority:'design_fill',sources:[]}]},facts.generators);
 expect(families[0].generator!.params).toMatchObject({outerDiameter:[11,13,15],extra:1});   // 模型改的键被表格覆盖,新键保留
 expect(families[0].authority).toBe('master');
 const objects=mergeObjects({objects:[{id:'CORE_001',label:'核心',family:'RING',parent:null,position:[1,1,1],rotationDeg:[0,0,0],scale:[1,1,1],params:[],authority:'design_fill',sources:[],confidence:0.3,notes:''}]},facts.masters);
 expect(objects[0]).toMatchObject({transform:{position:[0,0,7]},authority:'master',confidence:1,params:{size:[8,8,8]}});
 const spec={...sampleSpec(),families,materials,objects};
 const report=reconcileSpec(spec,facts,{excludedLeaves:[{id:'ENV-001',reason:'P1 后续'}]});
 expect(report.masters.find(m=>m.id==='CORE_001')!.status).toBe('matched');
 expect(report.masters.find(m=>m.id==='NODE_01')!.status).toBe('missing');
 expect(report.leaves.map(l=>l.status)).toEqual(['excluded','unaccounted','covered']);
 expect(report.ok).toBe(false);
 spec.objects[0].transform.position=[0,0,7.5];
 expect(reconcileSpec(spec,facts).masters[0].status).toBe('mismatched');
});

test('Wave 2 并行分片合并:去重(master 优先)、越界钳制、贴花清洗、光学下限守卫与引用自愈',()=>{
 const doc=parseHtmlDocument(FIXTURE),facts={masters:handbookObjects(doc),generators:handbookGenerators(doc),leaves:handbookLeaves(doc)};
 const base=sampleSpec();
 const bounds={min:[-24,-27.5,-3] as [number,number,number],max:[24,27.5,20.5] as [number,number,number]};
 const families=[
  {...base.families[0]!,id:'FAM_CORE',generator:{id:'GEN-CORE-01',params:{}}},
  {...base.families[0]!,id:'FAM_POOL',generator:{id:'GEN-POOL-01',params:{}}},
  {...base.families[0]!,id:'FAM_NODE',generator:{id:'GEN-NODEBEAM-02',params:{}}},
 ];
 const shardCore={
  objects:[
   {id:'CORE_001',label:'分片核心(旧)',family:'FAM_CORE',parent:null,position:[9,9,9],rotationDeg:[0,0,0],scale:[1,1,1],params:[],authority:'design_fill',sources:[{kind:'inferred',ref:'core'}],confidence:0.5,notes:''},
   {id:'POOL_ACTUAL_01',label:'中央冷却池',family:'FAM_POOL',parent:null,position:[0,0,-0.4],rotationDeg:[0,0,0],scale:[1,1,1],params:[],authority:'design_fill',sources:[{kind:'doc',ref:'§2'}],confidence:0.9,notes:''},
  ],
  excludedMasters:[{id:'CORE_001',reason:'另一分片误排除'}],
 };
 const shardTech={
  objects:[
   {id:'CORE_001',label:'核心 master',family:'FAM_CORE',parent:null,position:[0,0,7],rotationDeg:[0,0,0],scale:[1,1,1],params:[],authority:'master',sources:[{kind:'doc',ref:'B2'}],confidence:1,notes:''},
   {id:'NODE_FILL_OUT',label:'轻微越界能量柱',family:'FAM_NODE',parent:'GHOST_PARENT',position:[29,-35,25],rotationDeg:[0,0,0],scale:[1,1,1],params:[],authority:'design_fill',sources:[{kind:'inferred',ref:'tech'}],confidence:0.8,notes:''},
   {id:'BAD_FAM_OBJ',label:'未知族对象',family:'NON_EXISTENT',parent:null,position:[0,0,0],rotationDeg:[0,0,0],scale:[1,1,1],params:[],authority:'design_fill',sources:[{kind:'inferred',ref:'tech'}],confidence:0.5,notes:''},
  ],
  excludedMasters:[{id:'PLAYER_SPAWN',reason:'纯玩法出生点'}],
 };
 const {objects,excludedMasters}=mergeObjectShards([shardCore,shardTech],facts.masters,families,bounds);
 expect(objects.map(o=>o.id)).toEqual(['CORE_001','POOL_ACTUAL_01','NODE_FILL_OUT']);
 // master 覆盖分片旧值且不被列入 excludedMasters
 expect(objects.find(o=>o.id==='CORE_001')!.authority).toBe('master');
 expect(objects.find(o=>o.id==='CORE_001')!.transform.position).toEqual([0,0,7]);
 expect(excludedMasters.some(e=>e.id==='CORE_001')).toBe(false);
 expect(excludedMasters.some(e=>e.id==='PLAYER_SPAWN')).toBe(true);
 // 悬空 parent 被置 null 且越界 design_fill 坐标被安全钳入 bounds
 const clampedObj=objects.find(o=>o.id==='NODE_FILL_OUT')!;
 expect(clampedObj.parent).toBeNull();
 expect(clampedObj.transform.position[0]).toBeLessThanOrEqual(bounds.max[0]);
 expect(clampedObj.transform.position[1]).toBeGreaterThanOrEqual(bounds.min[1]);
 expect(clampedObj.transform.position[2]).toBeLessThanOrEqual(bounds.max[2]);

 // 贴花清洗:去重、修正过薄盒与越界透明度
 const decals=sanitizeDecals([
  {id:'123-bad',label:'分区喷字',kind:'stencil',text:null,color:[0.9,0.95,1],position:[0,-12,0.02],rotationDeg:[0,0,0],size:[3,0.8,0.001],opacity:1.4,roughness:0.6},
  {id:'123-bad',label:'积水',kind:'puddle',text:null,color:null,position:[50,50,0.02],rotationDeg:[0,0,400],size:[2.5,2,0.2],opacity:0.8,roughness:-0.2},
 ],bounds);
 expect(decals).toHaveLength(2);
 expect(decals[0]!.id).not.toBe(decals[1]!.id);
 expect(decals[0]!.size[2]).toBeGreaterThanOrEqual(0.05);
 expect(decals[0]!.text).toBe('SECTOR 01');
 expect(decals[1]!.position[0]).toBeLessThanOrEqual(bounds.max[0]);

 // staging 光学下限守卫 + 并行引用自愈(未知 POOL_999 自动绑定到 POOL_ACTUAL_01,无效验收剔除)
 const staging=mergeStaging({
  defaultState:'L0',
  states:[{
   id:'L0',label:'稳定故障',
   lights:[{id:'sun',kind:'directional',position:null,direction:[0.2,0.3,-0.9],color:[1,1,1],intensity:6.5,range:null,innerConeDeg:null,outerConeDeg:null,width:null,height:null,castShadow:true}],
   ambient:{color:[0.62,0.76,0.95],groundColor:null,intensity:0.15}, // 过暗环境光将被守卫拉起至 >=0.42
   background:[0.06,0.09,0.14],
   post:{tonemap:'agx',exposure:0.5,bloom:{threshold:1,intensity:0.3,radius:0.5},gtao:true,ssr:null,
    fog:{color:[0.6,0.75,0.9],density:0.002,anisotropy:0.5,boundsMin:bounds.min,boundsMax:bounds.max,light:'MISSING_SUN'},
    planarReflections:[{object:'POOL_999_UNKNOWN',height:-0.4,distortion:0.02}],
    volumetric:null,cameraFx:null},
  }],
  shots:[{id:'S1',label:'主视觉基准',position:[0,-22,3],target:[0,0,7],fovDeg:58}],
  constraints:[],
  acceptance:[
   {id:'A_CORE',description:'核心位置',critical:true,kind:'position',object:'CORE_001',position:[0,0,7],tolerance:0.2,family:null,equals:null,size:null,from:null,to:null,width:null,height:null},
   {id:'A_GHOST',description:'不存在的对象',critical:false,kind:'position',object:'DOES_NOT_EXIST',position:[0,0,0],tolerance:0.5,family:null,equals:null,size:null,from:null,to:null,width:null,height:null},
  ],
 });
 expect(staging.lighting.states[0]!.ambient.intensity).toBeGreaterThanOrEqual(0.12);
 expect(staging.lighting.states[0]!.ambient.groundColor).toBeDefined();
 expect(staging.lighting.states[0]!.post.exposure).toBe(0.5);

 reconcileStagingRefs(staging as any,objects,families,bounds);
 expect(staging.lighting.states[0]!.post.planarReflections[0]).toMatchObject({object:'POOL_ACTUAL_01',height:-0.4});
 expect(staging.lighting.states[0]!.post.fog!.light).toBe('sun');
 expect(staging.acceptance.map((a:any)=>a.id)).toEqual(['A_CORE']);

 const fullSpec={...base,bounds,families,objects,decals,...staging};
 expect(()=>validateSceneSpec(fullSpec)).not.toThrow();
});

const HANDBOOK=process.env.SPEC_HANDBOOK_HTML;
test.skipIf(!HANDBOOK||!existsSync(HANDBOOK))('真实手册:冻结表格完整解析',()=>{
 const doc=parseHtmlDocument(readFileSync(HANDBOOK!,'utf8'));
 expect(handbookObjects(doc).filter(o=>o.position)).toHaveLength(23);
 expect(handbookGenerators(doc)).toHaveLength(11);
 expect(handbookLeaves(doc).length).toBeGreaterThan(100);
 expect(doc.images).toHaveLength(8);
});
