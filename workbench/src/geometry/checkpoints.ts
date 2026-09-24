import {mkdirSync,existsSync,readFileSync,writeFileSync,readdirSync,renameSync,rmSync,lstatSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DATA,digest,read,save} from '../store';
import {settingsOf} from '../model-selection';
import {validateGroundedPlan} from '../grounding';
import {validateLayout,validateAsset,type SceneLayout,type AssetGeometry} from './layout';

const canonical=(v:any):any=>v===undefined?null:v===null||typeof v!=='object'?v:Array.isArray(v)?v.map(canonical):Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));
const hash=(v:any)=>digest(JSON.stringify(canonical(v)));
export function checkpointInput(job:any){return {prompt:job.prompt??'',complexity:job.complexity,images:(job.images??(job.image?[job.image]:[])).map((i:any)=>({id:i.id,mime:i.mime})),modelSettings:settingsOf(job)??null,provider:job.profile?.provider??null,engineSha:job.profile?.engineSha??null,generatorSha:job.profile?.generatorSha??null};}
export type Registration={job:any;planFile:string;generationDir:string;textureFile:string;provenance?:any;evidence?:Record<string,string>;skipInvalidAssets?:boolean};
/** Immutable generated payloads; restoring one never counts as a fresh generation. */
export class CheckpointStore{
 constructor(readonly root:string){mkdirSync(root,{recursive:true});}
 path(id:string){if(!/^[a-f0-9]{64}$/.test(id))throw Error('检查点 ID 无效');return join(this.root,id);}
 verify(id:string,job?:any){
  const root=this.path(id),m=read(join(root,'manifest.json')),{id:storedId,...body}=m;
  if(storedId!==id||hash(body)!==id||m.version!=='scene-checkpoint-v1')throw Error('检查点清单摘要不一致');
  if(job&&hash(m.input)!==hash(checkpointInput(job)))throw Error('检查点输入、模型或引擎版本不匹配');
  for(const [name,sha] of Object.entries(m.files)){
   if(!/^[a-zA-Z0-9_./-]+$/.test(name)||name.startsWith('/')||name.split('/').some(p=>p==='..'||p===''))throw Error('检查点文件路径无效');
   const file=join(root,'payload',name);if(!lstatSync(file).isFile()||digest(readFileSync(file))!==sha)throw Error('检查点文件已改变：'+name);
  }
  return m;
 }
 load(id:string,job:any){const manifest=this.verify(id,job),folder=join(this.path(id),'payload'),plan=validateGroundedPlan(read(join(folder,'plan.json')),job.prompt),layout=validateLayout(read(join(folder,'layout.json')),plan,manifest.input.images.length,job.complexity);return {manifest,folder,plan,layout,assets:manifest.assets.map((a:any)=>({id:a.id,value:read(join(folder,'assets',a.id,'geometry.json')) as AssetGeometry,source:a.source}))};}
 matching(job:any){return readdirSync(this.root).filter(id=>/^[a-f0-9]{64}$/.test(id)).flatMap(id=>{try{const m=read(join(this.path(id),'manifest.json'));if(hash(m.input)!==hash(checkpointInput(job)))return [];this.verify(id,job);return [{id,createdAt:m.createdAt,sourceJobId:m.sourceJobId,completed:m.assets.length,total:m.total,provenance:m.provenance}];}catch{return [];}}).sort((a,b)=>b.completed-a.completed||b.createdAt.localeCompare(a.createdAt));}
 inspect({job,planFile,generationDir,textureFile,provenance,evidence={},skipInvalidAssets=false}:Registration){
  const input=checkpointInput(job),plan=validateGroundedPlan(read(planFile),job.prompt),layout=validateLayout(read(join(generationDir,'layout.json')),plan,input.images.length,job.complexity),textures=read(textureFile),buffers:Record<string,Buffer>={},assets:any[]=[],issues:{id:string;reason:string}[]=[];
  const add=(name:string,file:string)=>{buffers[name]=readFileSync(file);};add('plan.json',planFile);add('layout.json',join(generationDir,'layout.json'));
  for(const name of ['space.json','surface.json'])if(existsSync(join(generationDir,name)))add(name,join(generationDir,name));
  const receipts=(dir:string,prefix:string)=>{for(const name of readdirSync(dir))if(/^(?:plan|scene-space|scene-surface|geometry-asset)-[a-zA-Z0-9_-]+\.(?:json|txt|log)$/.test(name)&&lstatSync(join(dir,name)).isFile())add(prefix+name,join(dir,name));};receipts(generationDir,'evidence/');
  for(const brief of layout.program.templates){
   const folder=join(generationDir,'assets',brief.id),file=join(folder,'geometry.json'),record=join(folder,'checkpoint.json');if(!existsSync(file)||!existsSync(record)){issues.push({id:brief.id,reason:'没有完整的已完成资产'});continue;}
   try{
   const source=read(record);if(source.status!=='passed'){issues.push({id:brief.id,reason:'资产尚未完成'});continue;}
   const value=read(file);if(source.geometrySha256!==digest(JSON.stringify(value))||source.layoutSha256!==digest(JSON.stringify(layout))||source.planSha256!==digest(JSON.stringify(plan))||hash(source.referenceSha256)!==hash(input.images.map((i:any)=>i.id))||hash(source.modelSettings)!==hash(input.modelSettings))throw Error('资产检查点来源与布局不一致：'+brief.id);
   validateAsset(value,brief,layout,textures);assets.push({id:brief.id,source:{pipelineVersion:source.pipelineVersion,geometrySha256:source.geometrySha256}});add('assets/'+brief.id+'/geometry.json',file);add('assets/'+brief.id+'/checkpoint.json',record);receipts(folder,'assets/'+brief.id+'/');
   }catch(error){if(!skipInvalidAssets)throw error;for(let i=assets.length-1;i>=0;i--)if(assets[i].id===brief.id)assets.splice(i,1);for(const name of Object.keys(buffers))if(name.startsWith('assets/'+brief.id+'/'))delete buffers[name];issues.push({id:brief.id,reason:String(error)});}
  }
  for(const [name,file] of Object.entries(evidence)){if(!/^[a-zA-Z0-9_-]+\.(json|txt)$/.test(name))throw Error('来源证据名称无效');add('evidence/'+name,file);}
  const content={version:'scene-checkpoint-v1',input,sourceJobId:job.id,total:layout.program.templates.length,assets,provenance:provenance??{kind:'job',pipelineVersion:job.pipelineVersion},files:Object.fromEntries(Object.entries(buffers).map(([p,b])=>[p,digest(b)]))};
  return {content,buffers,issues,plan,layout,textures};
 }
 register(input:Registration){
  const {content,buffers}=this.inspect(input),job=input.job;
  // Re-registering unchanged content reuses its immutable snapshot.
  const existing=this.matching(job).find(m=>{const {id,createdAt,...body}=this.verify(m.id);return hash(body)===hash(content);});if(existing)return this.verify(existing.id);
  const body={...content,createdAt:new Date().toISOString()},id=hash(body),temp=join(this.root,'.pending-'+randomUUID());mkdirSync(temp);
  try{for(const [name,bytes] of Object.entries(buffers)){const file=join(temp,'payload',name);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,bytes);}save(join(temp,'manifest.json'),{id,...body});renameSync(temp,this.path(id));}finally{rmSync(temp,{recursive:true,force:true});}
  return this.verify(id,job);
 }
 restore(id:string,job:any,generationDir:string){const value=this.load(id,job);mkdirSync(generationDir,{recursive:true});for(const name of ['layout.json','space.json','surface.json'])if(value.manifest.files[name])writeFileSync(join(generationDir,name),readFileSync(join(value.folder,name)));for(const a of value.assets){const folder=join(generationDir,'assets',a.id);mkdirSync(folder,{recursive:true});for(const [name] of Object.entries(value.manifest.files))if(name.startsWith('assets/'+a.id+'/'))writeFileSync(join(generationDir,name),readFileSync(join(value.folder,name)));}save(join(generationDir,'resumed-from.json'),value.manifest);return value;}
}
export const checkpoints=new CheckpointStore(join(DATA,'checkpoints'));
