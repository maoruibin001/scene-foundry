/**
 * 规格修订:把对画面的修正写回规格(而不是改导出结果),产出新规格 + 修订记录。修订是按 ID 定位的字段补丁,
 * 每条带原因;master 字段(手册冻结的位置/尺寸)不允许被修订改写。
 * 用法:bun src/spec/revise.ts <spec.json> <revision.json> <out.json>
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {validateSceneSpec,type SceneSpec} from './schema';

export type SpecPatch={target:'sourceLightingMode'|'replaceGeometry'|'material'|'addMaterial'|'family'|'familyParam'|'object'|'addObject'|'addFamily'|'removeObject'|'state'|'post'|'shot'|'light'|'addLight';id:string;state?:string;set:Record<string,unknown>;reason:string};
export type SpecRevision={id:string;summary:string;patches:SpecPatch[]};

export function reviseSpec(spec:SceneSpec,rev:SpecRevision):SceneSpec{
 const s:SceneSpec=structuredClone(spec);
 const find=<T extends {id:string}>(list:T[],id:string,what:string)=>{const x=list.find(v=>v.id===id);if(!x)throw Error(`修订 ${rev.id}:${what} ${id} 不存在`);return x;};
 const states=(p:SpecPatch)=>p.state?[find(s.lighting.states,p.state,'光照状态')]:s.lighting.states; // id '*' 或省略 state 即全部状态
 for(const p of rev.patches){
  if(!p.reason)throw Error(`修订 ${rev.id}:补丁 ${p.target}/${p.id} 缺原因`);
  switch(p.target){
   case 'sourceLightingMode':{if(!s.sourceEnvironment||Object.keys(p.set).some(k=>k!=='lightingMode')||!['preserve','spec'].includes(String(p.set.lightingMode)))throw Error('需要已导入场景和显式光照来源模式');s.sourceEnvironment.lightingMode=p.set.lightingMode as 'preserve'|'spec';break;}
   case 'replaceGeometry':{const o=find(s.objects,p.id,'对象');if(!p.set.geometryBinding)throw Error('替换几何需要显式 geometryBinding');if(Object.keys(p.set).some(k=>k!=='geometryBinding'))throw Error('替换几何不能改写其他对象字段');delete o.sourceMesh;o.geometryBinding=structuredClone(p.set.geometryBinding) as any;break;}
   case 'material':Object.assign(find(s.materials,p.id,'材质'),p.set);break;
   case 'addMaterial':{if(s.materials.some(x=>x.id===p.id))throw Error(`修订 ${rev.id}:材质 ${p.id} 已存在`);s.materials.push({id:p.id,label:p.id,baseColor:[1,1,1,1],metallic:0,roughness:0.5,emissive:null,emissiveIntensity:0,transmission:0,ior:1.5,thickness:0,clearcoat:0,clearcoatRoughness:0,...p.set,sources:[{kind:'inferred',ref:`修订 ${rev.id}`}]} as any);break;}
   case 'family':Object.assign(find(s.families,p.id,'资产族'),p.set);break;
   case 'familyParam':{const f=find(s.families,p.id,'资产族');if(!f.generator)throw Error(`修订 ${rev.id}:${p.id} 没有生成器`);Object.assign(f.generator.params,p.set);break;}
   case 'object':{const o=find(s.objects,p.id,'对象');if(o.authority==='master'&&('transform' in p.set))throw Error(`修订 ${rev.id}:不能改写 master 对象 ${p.id} 的变换`);Object.assign(o,p.set);break;}
   case 'addFamily':{if(s.families.some(x=>x.id===p.id))throw Error(`修订 ${rev.id}:资产族 ${p.id} 已存在`);s.families.push({id:p.id,label:p.id,description:p.reason,priority:'P1',generator:null,materialSlots:{},...p.set,authority:'design_fill',sources:[{kind:'inferred',ref:`修订 ${rev.id}`}]} as any);break;}
   case 'addObject':{if(s.objects.some(x=>x.id===p.id))throw Error(`修订 ${rev.id}:对象 ${p.id} 已存在`);
    const o:any={id:p.id,label:p.id,parent:null,params:{},confidence:0.6,notes:p.reason,...p.set,authority:'design_fill',sources:[{kind:'inferred',ref:`修订 ${rev.id}`}]};
    o.transform={rotationOrder:'XYZ',scale:[1,1,1],rotationDeg:[0,0,0],...(o.transform??{})};s.objects.push(o);break;}
   case 'removeObject':{const o=find(s.objects,p.id,'对象');if(o.authority==='master')throw Error(`修订 ${rev.id}:不能删除 master 对象 ${p.id}`);
    if(s.acceptance.some(a=>'object' in a&&a.object===p.id))throw Error(`修订 ${rev.id}:${p.id} 被验收条目引用,不能删除`);s.objects=s.objects.filter(x=>x.id!==p.id);break;}
   case 'post':for(const st of states(p))Object.assign(st.post,p.set);break;
   case 'state':for(const st of states(p))Object.assign(st,p.set);break;
   case 'light':for(const st of states(p)){const l=st.lights.find(x=>x.id===p.id);if(l)Object.assign(l,p.set);}break;
   case 'addLight':for(const st of states(p)){if(st.lights.some(x=>x.id===p.id))throw Error(`修订 ${rev.id}:灯 ${p.id} 已存在`);st.lights.push({id:p.id,kind:'point',position:null,direction:null,color:[1,1,1],intensity:1,range:null,innerConeDeg:null,outerConeDeg:null,width:null,height:null,castShadow:false,...p.set} as any);}break;
   case 'shot':Object.assign(find(s.shots,p.id,'机位'),p.set);break;
  }
 }
 // The immutable parent and full revision are retained in continuation receipts.
 // Do not grow a display string until otherwise valid continuations fail validation.
 const sha=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
 s.provenance={...s.provenance,method:`scene-spec-revision-v1; parent=${sha(spec)}; revision=${sha(rev)}`,createdAt:new Date().toISOString()};
 validateSceneSpec(s);return s;
}

if(import.meta.main){
 const [specPath,revPath,out]=process.argv.slice(2);
 if(!specPath||!revPath||!out)throw Error('用法: bun src/spec/revise.ts <spec.json> <revision.json> <out.json>');
 const spec=JSON.parse(readFileSync(specPath,'utf8')),rev=JSON.parse(readFileSync(revPath,'utf8'));
 writeFileSync(out,JSON.stringify(reviseSpec(spec,rev),null,1));console.log(`${rev.id}: ${rev.patches.length} 条补丁 → ${out}`);
}
