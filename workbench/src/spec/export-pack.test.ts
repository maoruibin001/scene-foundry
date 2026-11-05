import {test,expect} from 'bun:test';
import {mkdtempSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {planSpecExport,toEnginePosition,toEngineQuat,writeSpecPack,type Quat} from './export-pack';
import {resolveParams} from './generators/kit';
import {GENERATORS} from './generators/index';
import {sampleSpec} from './fixtures';
import type {SceneSpec} from './schema';

const rotate=(q:Quat,v:number[])=>{const [x,y,z,w]=q,ix=w*v[0]+y*v[2]-z*v[1],iy=w*v[1]+z*v[0]-x*v[2],iz=w*v[2]+x*v[1]-y*v[0],iw=-x*v[0]-y*v[1]-z*v[2];return [ix*w+iw*-x+iy*-z-iz*-y,iy*w+iw*-y+iz*-x-ix*-z,iz*w+iw*-z+ix*-y-iy*-x];};
const close=(a:number[],b:number[])=>a.every((v,i)=>Math.abs(v-b[i])<1e-9);

test('坐标换轴:位置 (x,y,z)→(x,z,-y);绕规格 Z 转 90° 把规格 +X 转到规格 +Y',()=>{
 expect(toEnginePosition([1,2,3])).toEqual([1,3,-2]);
 const q=toEngineQuat([0,0,90]);
 // 规格 +X = 引擎 +X;规格 +Y = 引擎 -Z
 expect(close(rotate(q,[1,0,0]),[0,0,-1])).toBe(true);
 expect(close(rotate(toEngineQuat([90,0,0]),[0,1,0]),[0,0,1])).toBe(true); // 绕规格 X 转 90°:引擎 +Y(规格 +Z)→ 规格 -Y = 引擎 +Z
 expect(toEngineQuat([0,0,0])).toEqual([0,0,0,1]);
});

function hallSpec():SceneSpec{
 const s=sampleSpec(),src=[{kind:'doc' as const,ref:'t'}];
 s.materials.push({...s.materials[0],id:'glow',emissive:[0.5,0.8,1],emissiveIntensity:4});
 s.families=[
  {id:'RING',label:'环',description:'',priority:'P0',generator:{id:'GEN-RING-01',params:{outerDiameter:[11,13,15],path:'曲线'}},materialSlots:{segment:'steel',outerArmor:'steel',joint:'steel',lightRail:'glow',indicator:'glow'},authority:'master',sources:src},
  {id:'NODE',label:'节点',description:'',priority:'P0',generator:{id:'GEN-NODE-01',params:{}},materialSlots:{base:'steel'},authority:'master',sources:src},
  {id:'DOOR',label:'门',description:'',priority:'P1',generator:{id:'GEN-DOOR-01',params:{}},materialSlots:{frame:'steel'},authority:'design_fill',sources:src},
 ];
 const obj=(id:string,family:string,position:[number,number,number],params={})=>({id,label:id,family,parent:null,transform:{position,rotationDeg:[0,0,0] as [number,number,number],rotationOrder:'XYZ' as const,scale:[1,1,1] as [number,number,number]},params,authority:'master' as const,sources:src,confidence:1,notes:''});
 s.objects=[obj('RING_01','RING',[0,0,7]),obj('RING_02','RING',[0,0,7]),obj('RING_03','RING',[0,0,7]),obj('NODE_01','NODE',[-15,-15,0]),obj('DOOR_01','DOOR',[0,27,0],{size:[8,0.5,8]})];
 s.acceptance=[];s.shots[0].target=[0,0,7];
 return s;
}

test('导出计划:列表参数按族内对象分配、未知参数可见丢弃、缺槽报错、缺生成器回退代理',()=>{
 const plan=planSpecExport(hallSpec());
 expect(plan.report.derived.map(d=>[d.object,d.value])).toEqual([['RING_01',11],['RING_02',13],['RING_03',15]]);
 expect(plan.report.dropped).toEqual([{family:'RING',key:'path',reason:'生成器没有这个参数'}]);
 expect(plan.report.proxies).toEqual([{object:'DOOR_01',family:'DOOR',reason:'生成器 GEN-DOOR-01 尚未实现'}]);
 expect(plan.report.slotFallbacks.filter(f=>f.family==='NODE').map(f=>f.slot)).toContain('sideShell'); // NODE 族只给了 base 槽,其余槽补本族材质
 expect(plan.meshes.filter(m=>m.generator==='GEN-RING-01')).toHaveLength(3);
 expect(plan.entities.find(e=>e.id==='NODE_01')).toBeDefined();
 expect(plan.entities.find(e=>e.id==='RING_02')!.pos).toEqual([0,7,-0]);
});

test('写出 pack:数据、源码、生成器副本与收据',()=>{
 const spec=hallSpec();spec.families[1].materialSlots={base:'steel',sideShell:'steel',sleeve:'steel',core:'glow',weakpoint:'glow',fin:'steel',readout:'glow',topCap:'steel'};
 const plan=planSpecExport(spec);expect(plan.report.errors).toEqual([]);
 const dir=mkdtempSync(join(tmpdir(),'spec-pack-'));
 const receipt=writeSpecPack(spec,plan,dir,{packageId:'019fb7ce-6100-7000-8000-000000000000',sourceKey:'scene/sample',name:'样例'});
 expect(receipt.meshCount).toBe(5);expect(receipt.diagnostics).toEqual([]);expect(receipt.sceneGuid).toMatch(/^[0-9a-f-]{36}$/);
 for(const f of ['spec.pack.ts','spec-data.ts','spec-kit/kit.ts','spec-kit/gen-ring.ts','export-report.json'])expect(existsSync(join(dir,f))).toBe(true);
 expect(readFileSync(join(dir,'spec-data.ts'),'utf8')).toContain('"generator":"GEN-RING-01"');
});

test('全部库生成器:默认参数合法、边界合法、非法拒绝',()=>{
 for(const g of Object.values(GENERATORS)){
  expect(resolveParams(g,{}).errors).toEqual([]);
  const edge=Object.fromEntries(Object.entries(g.params).filter(([,d]:any)=>d.type==='number'||d.type==='int').map(([k,d]:any)=>[k,d.min]));
  expect(resolveParams(g,edge).errors).toEqual([]);
  const bad=Object.fromEntries(Object.entries(g.params).filter(([,d]:any)=>d.type==='number'||d.type==='int'||d.type==='vec3').slice(0,1).map(([k,d]:any)=>[k,d.type==='vec3'?[d.max*10+1,0,0]:d.max*10+1]));
  expect(resolveParams(g,{...bad,unknownKey:1}).errors.length).toBe(2);
 }
});

test('整组生成器:族内只出一个实例,其它对象记为组成部分;无主控对象时在族原点合成',()=>{
 const s=hallSpec();
 s.families.push({id:'HALLS',label:'骨架',description:'',priority:'P0',generator:{id:'GEN-HALL-01',params:{}},materialSlots:Object.fromEntries(['column','beam','roofTruss','roofDeck','wallPanel','inspectionPanel','panelBolt','skirting','skylight'].map(k=>[k,'steel'])),authority:'design_fill',sources:[{kind:'doc',ref:'t'}]});
 const part=(id:string,authority:'master'|'design_fill')=>({...s.objects[0],id,family:'HALLS',authority});
 s.objects.push(part('WALL_W','design_fill'),part('WALL_E','design_fill'));
 let plan=planSpecExport(s);
 expect(plan.entities.filter(e=>e.id.startsWith('HALLS')).map(e=>e.id)).toEqual(['HALLS-assembly']);
 expect(plan.report.covered.map(c=>c.object)).toEqual(['WALL_E','WALL_W']);
 s.objects.push(part('HALL_001','master'));plan=planSpecExport(s);
 expect(plan.entities.some(e=>e.id==='HALL_001')).toBe(true);
 expect(plan.report.covered.map(c=>c.by)).toEqual(['HALL_001','HALL_001']);
});

test('核心 Goldberg 分区:10f²+2 个面,恰好 12 个五边形,其余六边形',async()=>{
 const {goldbergFaces}=await import('./generators/gen-core');
 for(const f of [1,3,5]){const faces=goldbergFaces(f);expect(faces.length).toBe(10*f*f+2);expect(faces.filter(x=>x.length===5).length).toBe(12);expect(faces.every(x=>x.length===5||x.length===6)).toBe(true);}
});
