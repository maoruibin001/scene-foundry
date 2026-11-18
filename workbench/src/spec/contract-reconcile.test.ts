import {test,expect} from 'bun:test';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {reconcileSpec,reconcileErrors,reconcileSummary,RECONCILE_VERSION} from './contract-reconcile';
import {prepareExportPlacements} from './export-pack';
import {specPrecheck} from './spec-precheck';
import {sceneSpecErrors} from './schema';
import {GENERATORS} from './generators/index';
import {resolveParams,runGenerator} from './generators/kit';

const WORKBENCH=resolve(import.meta.dir,'../..');
const SPECS_DIR=join(WORKBENCH,'data','specs');

function realSpecs():{file:string;spec:any}[]{
 if(!existsSync(SPECS_DIR))return [];
 return readdirSync(SPECS_DIR)
  .filter(f=>f.endsWith('.json')&&!f.endsWith('.style.json'))
  .flatMap(f=>{
   try{
    const spec=JSON.parse(readFileSync(join(SPECS_DIR,f),'utf8'));
    return spec?.families&&spec?.objects?[{file:f,spec}]:[];
   }catch{return [];}
  });
}

function miniSpec(familyParams:Record<string,unknown>,objectParams:Record<string,unknown>={}):any{
 return {
  id:'fixture',name:'fixture',provenance:{model:'test'},styleRefs:[],acceptance:[],
  families:[{id:'F',label:'F',description:'',priority:'P0',generator:{id:'GEN-FLOOR-01',params:familyParams},materialSlots:{},authority:'master',sources:[]}],
  objects:[{id:'O',label:'O',family:'F',parent:null,transform:{position:[0,0,0],rotationDeg:[0,0,0],scale:[1,1,1]},params:objectParams,authority:'master',sources:[],confidence:1,notes:''}],
  materials:[],lighting:{defaultState:'s',states:[{id:'s',post:{planarReflections:[]}}]},shots:[],decals:[],constraints:[],
 };
}

test('真实规格归一后关键参数无解与灰模代理同时归零，且不再有契约错误',()=>{
 const specs=realSpecs();
 expect(specs.length).toBeGreaterThan(0);
 for(const {file,spec} of specs){
  const before=prepareExportPlacements(spec).report;
  const {spec:fixed,report}=reconcileSpec(spec);
  const after=prepareExportPlacements(fixed).report;
  expect({file,unresolved:after.unresolved.length}).toEqual({file,unresolved:0});
  expect({file,proxies:after.proxies.length}).toEqual({file,proxies:0});
  expect({file,errors:after.errors.length}).toEqual({file,errors:0});
  expect({file,reconcileErrors:reconcileErrors(fixed).length}).toEqual({file,reconcileErrors:0});
  expect({file,schemaErrors:sceneSpecErrors(fixed).length}).toEqual({file,schemaErrors:0});
  expect(specPrecheck(fixed).unresolved.length).toBe(0);
  expect(report.version).toBe(RECONCILE_VERSION);
  // 只核验确实存在问题的规格，避免把本来合规的规格当成回归依据。
  if(before.unresolved.length)expect(after.proxies.length).toBeLessThan(before.proxies.length);
 }
});

test('归一是纯函数且幂等：入库归一一次、plan 再归一一次不会改变内容摘要',()=>{
 const specs=realSpecs();
 if(!specs.length)return;
 const original=JSON.stringify(specs[0]!.spec);
 const once=reconcileSpec(specs[0]!.spec);
 expect(JSON.stringify(specs[0]!.spec)).toBe(original);
 const twice=reconcileSpec(once.spec);
 expect(JSON.stringify(twice.spec)).toBe(JSON.stringify(once.spec));
});

test('布尔 false 表示禁用，不能回退成契约默认尺寸把水池洞打开',()=>{
 const s=miniSpec({poolCutout:false});
 const {spec}=reconcileSpec(s);
 expect(spec.families[0]!.generator.params.poolCutout).toEqual([0,0,0]);
 const {report}=prepareExportPlacements(spec);
 expect(report.unresolved.length).toBe(0);
 expect(report.proxies.length).toBe(0);
});

test('越界数值夹到契约范围，区间数组按族内序号确定性选值',()=>{
 const s=miniSpec({width:999,length:1,clutter:0.3});
 const {spec,report}=reconcileSpec(s);
 expect(spec.families[0]!.generator.params.width).toBe(120);
 expect(spec.families[0]!.generator.params.length).toBe(4);
 expect(spec.families[0]!.generator.params.clutter).toBe(0);
 expect(report.counts.clamp).toBeGreaterThan(0);
 // 区间：GEN-PIPE-01 的 diameter 是 number，给 [0.1,0.25,0.5] 必须选单值而不是留下数组。
 const pipe=miniSpec({},{});
 pipe.families[0]!.generator={id:'GEN-PIPE-01',params:{diameter:[0.1,0.25,0.5]}};
 const r=reconcileSpec(pipe);
 expect(typeof r.spec.families[0]!.generator.params.diameter).toBe('number');
 expect(r.report.counts.pick).toBeGreaterThan(0);
});

test('对象级覆盖门洞宽度后，跨参数约束修复让真实生成器可构建',()=>{
 const s=miniSpec({},{});
 s.families[0]!.generator={id:'GEN-ENTRY-01',params:{doorClearWidth:4,doorHeight:4.5,vestibuleDepth:3,vestibuleWidth:6,vestibuleHeight:4.5,frameDepth:0.5}};
 s.objects.push({...s.objects[0]!,id:'SAFE_BARRIER_001',params:{doorClearWidth:6}});
 const {spec,report}=reconcileSpec(s);
 const o=spec.objects.find((x:any)=>x.id==='SAFE_BARRIER_001')!;
 // 门斗宽度是对象级覆盖导致的，必须写在对象上；门斗高度由族级提供即可，检查合并后的生效参数。
 const merged={...spec.families[0]!.generator.params,...o.params};
 expect(o.params.vestibuleWidth).toBeGreaterThanOrEqual(7);
 expect(merged.vestibuleHeight).toBeGreaterThanOrEqual(4.8);
 expect(report.counts.constraint).toBeGreaterThan(0);
 const gen=GENERATORS['GEN-ENTRY-01']!;
 expect(()=>runGenerator(gen,resolveParams(gen,merged).params as any,'probe')).not.toThrow();
});

test('纯描述性文本显式登记并用契约默认值兜底，不伪造折线点或尺寸',()=>{
 const s=miniSpec({},{});
 s.families[0]!.generator={id:'GEN-PIPE-01',params:{path:'四节点至设备的供能样条路径'}};
 const {spec,report}=reconcileSpec(s);
 expect(spec.families[0]!.generator.params.path).toBeUndefined();
 const item=report.descriptive.find(d=>d.key==='path');
 expect(item?.text).toContain('供能样条');
 expect(item?.fallback).toContain('契约默认折线');
 expect(reconcileSummary(report)).toContain('未伪造几何');
});
