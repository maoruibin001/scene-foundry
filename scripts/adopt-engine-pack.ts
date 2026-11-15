/** Deterministic intake of an existing ForgeAX scene pack into Scene Foundry.
 * Reuses authored mesh bytes and material values. Does not model or move objects. */
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {validateSceneSpec,type SceneSpec} from '../workbench/src/spec/schema';
const [rootArg,packArg,sceneKey,outArg,optionsFile]=process.argv.slice(2);
if(!rootArg||!packArg||!sceneKey||!outArg)throw Error('Usage: bun scripts/adopt-engine-pack.ts SOURCE_ROOT RELATIVE_PACK SCENE_KEY OUTPUT_DIR');
const root=realpathSync(rootArg),packPath=realpathSync(resolve(root,packArg)),out=resolve(outArg);
if(isAbsolute(relative(root,packPath))||relative(root,packPath).startsWith('..'))throw Error('Pack outside source project');
process.chdir(root);
const recipe=(await import(pathToFileURL(packPath).href)).default;
const built=await recipe.build();if(!built.ok)throw built.error;
const products=built.value,scene=products[sceneKey];if(scene?.kind!=='scene')throw Error('Missing scene product');
const pkg=recipe.packageId;
// Use the source project's own Engine package to resolve its stable asset identities.
const engineDir=join(root,'node_modules/@forgeax/engine');
const publicExports=JSON.parse(readFileSync(join(engineDir,'package.json'),'utf8')).exports;
const facade=publicExports['./*']?.import;
if(typeof facade!=='string')throw Error('Unsupported Engine public facade contract');
const {AssetGuid}=await import(pathToFileURL(resolve(engineDir,facade.replace('*','pack/guid'))).href);
const byGuid=new Map(Object.entries(products).map(([k,v])=>[AssetGuid.format(AssetGuid.derive(pkg,k)),[k,v] as const]));
const src=[{kind:'doc' as const,ref:'Existing source project '+packArg+' / '+sceneKey}];
const plain=(value:any):any=>ArrayBuffer.isView(value)?Array.from(value as any):Array.isArray(value)?value.map(plain):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,plain(v)])):value;
const metadata:any={version:'existing-engine-pack-intake-v1',sourceProject:root,pack:packArg,sceneKey,packSha256:hash(readFileSync(packPath)),excluded:[],meshSources:[],transforms:[],materialLosses:[]};
const materials:any[]=[],matIds=new Map<string,string>();
function hash(b:Uint8Array){return createHash('sha256').update(b).digest('hex');}
function material(guid:string){
 if(matIds.has(guid))return matIds.get(guid)!;
 const found=byGuid.get(guid);if(!found)throw Error('Material reference not in pack '+guid);
 const [key,a]=found as [string,any],v=a.values??a;
 const id='mat'+materials.length;matIds.set(guid,id);
 materials.push({id,label:key,baseColor:Array.from(v.baseColor??[.5,.5,.5,1]),metallic:v.metallic??0,roughness:v.roughness??.5,emissive:v.emissive?Array.from(v.emissive):null,emissiveIntensity:v.emissiveIntensity??0,transmission:v.transmission??0,ior:v.ior??1.5,thickness:v.thickness??0,clearcoat:v.clearcoat??0,clearcoatRoughness:v.clearcoatRoughness??0,surface:null,sources:src});
 return id;
}
const objects:any[]=[],refs=new Map<string,any>();mkdirSync(join(out,'library'),{recursive:true});
for(const [key,entity] of Object.entries(scene.entities) as [string,any][]){
 const c=entity.components,meshGuid=c.MeshFilter?.assetHandle;
 if(!meshGuid){metadata.excluded.push({id:key,reason:'not a mesh; camera/lights imported through scene settings'});continue;}
 const pair=byGuid.get(meshGuid);if(!pair)throw Error('External mesh dependency requires intake adapter '+key);
 const [meshKey,asset]=pair as [string,any];
 let source=refs.get(meshGuid);
 if(!source){
  const layout:any={},segments:Buffer[]=[];let offset=0;
  function push(name:string,v:any){if(!ArrayBuffer.isView(v))return;const padding=(4-offset%4)%4;if(padding){segments.push(Buffer.alloc(padding));offset+=padding;}layout[name]={type:v.constructor.name,offset,length:v.length};const b=Buffer.from(v.buffer,v.byteOffset,v.byteLength);segments.push(b);offset+=b.length;}
  for(const n of ['vertices','indices','aabb'])push(n,asset[n]);for(const [n,v] of Object.entries(asset.attributes??{}))push('attributes.'+n,v);
  const binary=Buffer.concat(segments),rest={kind:'mesh',attributes:{},submeshes:asset.submeshes,materialSlots:asset.materialSlots.map((s:any)=>({slotName:s.slotName}))};
  const mb=Buffer.from(JSON.stringify({rest,layout})),name='mesh'+refs.size;
  writeFileSync(join(out,'library',name+'.json'),mb);writeFileSync(join(out,'library',name+'.bin'),binary);
  const slots=Object.fromEntries((asset.materialSlots??[]).map((s:any)=>[s.slotName,material(typeof (s.defaultMaterial??s.material)==='string'?(s.defaultMaterial??s.material):AssetGuid.format(s.defaultMaterial??s.material))]));
  source={metadata:name+'.json',binary:name+'.bin',metadataSha256:hash(mb),binarySha256:hash(binary),slots};refs.set(meshGuid,source);
  metadata.meshSources.push({source:meshKey,ref:source,triangles:asset.indices.length/3});
 }
 const t=c.Transform??{},p=t.pos??[0,0,0],q=t.quat??[0,0,0,1],s=t.scale??[1,1,1];
 // Inverse of Scene Foundry's +Z spec -> +Y Engine fixed-XYZ transform.
 const [x,y,z,w]=[q[0],-q[2],q[1],q[3]],deg=180/Math.PI;
 const rotation=[Math.atan2(2*(w*x+y*z),1-2*(x*x+y*y))*deg,Math.asin(Math.max(-1,Math.min(1,2*(w*y-z*x))))*deg,Math.atan2(2*(w*z+x*y),1-2*(y*y+z*z))*deg];
 const transform={position:[p[0],-p[2],p[1]],rotationDeg:rotation,rotationOrder:'XYZ',scale:[s[0],s[2],s[1]]};
 const id='obj'+objects.length;
 objects.push({id,label:key+' / '+(c.Name?.value??key),family:'existingAssets',parent:null,transform,params:{},sourceMesh:source,authority:'master',sources:src,confidence:1,notes:'Imported existing source; no geometry reconstruction. Source key '+key});
 metadata.transforms.push({id,sourceKey:key,engine:{pos:p,quat:q,scale:s},spec:transform});
}
const toSpec=(p:number[])=>[p[0],-p[2],p[1]];
const env:Record<string,any>={};let lens:any=null;const shots:any[]=[];
for(const [id,e] of Object.entries(scene.entities) as [string,any][]){
 const c=e.components;
 if(c.MeshFilter)continue;
 if(c.Camera){
  lens=plain(c.Camera);const p=c.Transform?.pos??[0,0,0],q=c.Transform?.quat??[0,0,0,1];
  const d=[-2*(q[0]*q[2]+q[3]*q[1]),-2*(q[1]*q[2]-q[3]*q[0]),-(1-2*(q[0]*q[0]+q[1]*q[1]))];
  shots.push({id:'camera'+shots.length,label:c.Name?.value??id,position:toSpec(p),target:toSpec(p.map((v:number,k:number)=>v+d[k]*10)),fovDeg:(c.Camera.fov??Math.PI/3)*180/Math.PI});
 }else env[id]=plain(e);
}
if(!shots.length)throw Error('Source scene has no adopted camera; supply shots before generation');
const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
// Conservative source scene bounds from the original local boxes and TRS.
for(const t of metadata.transforms){
 const pair=byGuid.get((scene.entities as any)[t.sourceKey].components.MeshFilter.assetHandle) as any;
 const box=pair[1].aabb,q=t.engine.quat,s=t.engine.scale,p=t.engine.pos;
 for(let mask=0;mask<8;mask++){
  const v=[0,1,2].map(k=>box[k+((mask>>k)&1)*3]*s[k]),u=[q[0],q[1],q[2]],uv=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],uuv=[u[1]*uv[2]-u[2]*uv[1],u[2]*uv[0]-u[0]*uv[2],u[0]*uv[1]-u[1]*uv[0]];
  const w=toSpec(v.map((n,k)=>n+2*(q[3]*uv[k]+uuv[k])+p[k]));for(let k=0;k<3;k++){min[k]=Math.min(min[k],w[k]-1);max[k]=Math.max(max[k],w[k]+1);}
 }
}
if(optionsFile){
 const options=JSON.parse(readFileSync(resolve(optionsFile),'utf8'));
 if(options.views){
  const path=realpathSync(resolve(root,options.views.module));if(relative(root,path).startsWith('..'))throw Error('Views outside source project');
  const registry=(await import(pathToFileURL(path).href))[options.views.export];if(!Array.isArray(registry))throw Error('Missing views export');
  shots.splice(0,shots.length,...options.views.ids.map((id:string)=>{const v=registry.find((v:any)=>v.id===id);if(!v)throw Error('Missing requested source view '+id);return {id:v.id,label:v.label,position:toSpec(v.position),target:toSpec(v.target),fovDeg:v.fovDeg};}));
  metadata.viewsSource={module:options.views.module,sha256:hash(readFileSync(path)),ids:options.views.ids};
 }
 metadata.request=options;
}
const sourceConfig=JSON.parse(readFileSync(join(root,'forge.json'),'utf8'));
metadata.environment={entities:env,camera:lens};
const spec:SceneSpec={version:'scene-spec-v1',id:'adopted-'+metadata.packSha256.slice(0,16),name:(sourceConfig.name??sourceConfig.id)+' · 管线接续',units:'m',up:'+Z',bounds:{min:min as any,max:max as any},sourceEnvironment:{entities:env,camera:lens},sources:[{id:'source-project',title:'Existing v4.2 Engine scene',kind:'doc',path:packPath}],
 families:[{id:'existingAssets',label:'既有可用资产',description:'保留同源网格与原变换，不从概念图重新猜几何',priority:'P0',generator:null,materialSlots:{source:materials[0].id},authority:'master',sources:src}],objects,materials,decals:[],
 lighting:{defaultState:'adopted',states:[{id:'adopted',label:'既有场景灯光原值接入',lights:[],ambient:{color:[.6,.7,.85],intensity:.3},background:[.06,.08,.10],post:{tonemap:'aces',exposure:1,bloom:{threshold:1,intensity:.18,radius:.4},gtao:false,ssr:null,fog:null,planarReflections:[]}}]},shots,constraints:[],acceptance:[],styleRefs:(metadata.request?.styleRefs??[]),provenance:{createdAt:new Date().toISOString(),method:'existing-engine-pack-intake-v1; source mesh bytes, transforms, native environment and camera preserved',model:null}};
validateSceneSpec(spec);mkdirSync(out,{recursive:true});writeFileSync(join(out,'scene-spec.json'),JSON.stringify(spec,null,2));writeFileSync(join(out,'source-intake.json'),JSON.stringify(metadata,null,2));
console.log(JSON.stringify({spec:join(out,'scene-spec.json'),objects:objects.length,meshes:refs.size,materials:materials.length,environmentEntities:Object.keys(env).length,cameras:shots.length,warning:'Adopted source must be visually compared before acceptance'}));
