import {existsSync,mkdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {digest,read,save} from '../store';
import {stable} from '../validated-cache';
import {failureDisposition,preserveOutput,saveDelivery} from '../output-delivery';
import {externalProviderBlock} from '../provider-external-block';
import {assertStorageAvailable} from '../storage-preflight';
import {complexityPolicy} from '../complexity';
import {SPACE_CONSTRUCTION} from './space-construction';
import {completeObservedSpacePlan,bindObservedSpace} from './reference-observations';
import {validateSpace} from './layout-stages';
import {validateScene} from './scene-contract';
import {compileGeometryProgram} from './program';

export const SPACE_DRAFT='initial-space-draft-v1';
export const SPACE_DRAFT_LIMITATION='仅显示当前规划的物体范围线框与机位；真实轮廓、开口、连接、材质及原图还原未验收，不能作为完整或70分场景。';
const assert=(v:any,message:string)=>{if(!v)throw Error('布局草稿：'+message);};
export function spaceDraftAllowed(error:unknown,signal:AbortSignal){
 if(signal.aborted||externalProviderBlock(error)||/ENOSPC|STORAGE_|ENOMEM|EACCES|EPERM|RESOURCE_|THERMAL|过热|休眠/i.test(String(error)))return false;
 return ['transient','budget'].includes(failureDisposition(error).kind);
}
/** A failed stage stays failed even if a bounded local preview can preserve its saved layout. */
export async function withInitialSpaceDraft<T>(work:()=>Promise<T>,snapshot:()=>any,preserve:((state:any,error:unknown)=>Promise<any>)|undefined,signal:AbortSignal,warn:(error:unknown)=>void){
 try{return await work();}catch(error){
  if(preserve&&spaceDraftAllowed(error,signal))try{const state=snapshot();if(state?.core)await preserve(state,error);}catch(draftError){try{warn(draftError);}catch{/* Never mask the original stage error. */}}
  throw error;
 }
}
/** One mesh per template: twelve hollow range edges. No solid box or invented object shape. */
export function rangeCage(bounds:{min:number[];max:number[]}){
 const lo=bounds.min,hi=bounds.max,span=hi.map((x,i)=>x-lo[i]),width=Math.min(.04,...span.map(x=>x*.035));
 const rows:number[][][]=[];
 for(let axis=0;axis<3;axis++){
  const u=(axis+1)%3,v=(axis+2)%3;
  for(const a of [0,1])for(const b of [0,1]){
   const centers=[lo[axis],hi[axis]].map(x=>{const p=[0,0,0];p[axis]=x;p[u]=a?hi[u]-width/2:lo[u]+width/2;p[v]=b?hi[v]-width/2:lo[v]+width/2;return p;});
   const ring=(p:number[])=>[[-1,-1],[1,-1],[1,1],[-1,1],[-1,-1]].map(([x,y])=>{const q=[...p];q[u]+=x*width/2;q[v]+=y*width/2;return q;});
   // Repeated center rows close each edge; bridges between edges are degenerate and compile away.
   rows.push(Array.from({length:5},()=>[...centers[0]]),ring(centers[0]),ring(centers[1]),Array.from({length:5},()=>[...centers[1]]));
  }
 }
 return {type:'grid',points:rows.flat(),rows:rows.length,columns:5,doubleSided:true};
}
export function spaceDraftScene(snapshot:any,ctx:any){
 const {checksum,...body}=snapshot??{};
 assert(checksum===digest(stable(body))&&body.version===SPACE_CONSTRUCTION,'检查点内容或版本不符');
 assert(body.jobId===ctx.job.id&&body.rootJobId===(ctx.job.executionRecoveryRoot??ctx.job.id),'检查点不属于当前执行根');
 assert(body.core&&/^[a-f0-9]{64}$/.test(body.inputKey),'没有有效的当前核心规划');
 const partial={...body.core,version:'scene-space-plan-v2',spatialOpenings:body.spatialOpenings??[],spatialContacts:body.spatialContacts??[]};
 const space=bindObservedSpace(validateSpace(completeObservedSpacePlan(partial,ctx.observation),ctx.plan,ctx.images.length,ctx.job.complexity),ctx.observation);
 const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};
 const {voxelLattice:diagnosticLattice,...rangeSpace}=space;
 // Range cages are explicitly unscored diagnostic geometry, not voxel construction.
 const scene=validateScene({...rangeSpace,version:'scene-v1',spatialOpenings:body.spatialOpenings??undefined,spatialContacts:body.spatialContacts??undefined,
  textures:[],textureReuse:[],assumptions:[...space.assumptions,SPACE_DRAFT_LIMITATION],
  program:{...space.program,name:space.program.name+' · 布局范围草稿',materials:[{id:'blockout',color:[.6,.6,.6,1],roughness:1,metallic:0,textureId:null}],
   templates:space.program.templates.map((t:any)=>({id:t.id,parts:[{...pose,id:'range',material:'blockout',shape:rangeCage(t.bounds)}]}))},
  lighting:{direction:[.4,-.6,-.7],color:[1,1,1],intensity:1.8,ambientColor:[1,1,1],ambientIntensity:.65,points:[]}},ctx.plan,ctx.images.length);
 const compiled=compileGeometryProgram(scene.program,{});
 assert(compiled.meshes.length<=complexityPolicy(ctx.job.complexity,true).maxParts,'范围显示超过原部件预算');
 return scene;
}
/** At most one local render attempt per job. This never starts a model, accepts space or repairs geometry. */
export async function preserveInitialSpaceDraft(ctx:any,snapshot:any,error:unknown,render:(scene:any,folder:string,context:any,command:any)=>Promise<any>,command:any){
 if(!spaceDraftAllowed(error,ctx.signal))return {status:'skipped'};
 const folder=join(ctx.dir,'space-draft'),attemptFile=join(folder,'attempt.json'),source=join(ctx.dir,'space-construction/checkpoint.json');
 assert(existsSync(source)&&stable(read(source))===stable(snapshot),'检查点已改变或不属于当前目录');
 const scene=spaceDraftScene(snapshot,ctx);
 if(existsSync(attemptFile))return {...read(attemptFile),repeated:true};
 assertStorageAvailable(ctx.dir,2*1024**3);
 mkdirSync(folder,{recursive:true});
 const attempt={version:SPACE_DRAFT,jobId:ctx.job.id,checkpointSha256:snapshot.checksum,status:'rendering',startedAt:Date.now(),originalError:String(error),maximumRenderAttempts:1};
 save(attemptFile,attempt);save(join(folder,'checkpoint-source.json'),snapshot);save(join(folder,'scene.json'),scene);
 const deadline=Date.now()+180000,signal=AbortSignal.any([ctx.signal,AbortSignal.timeout(180000)]);
 const boundedCommand=(args:any,timeout=240000,cwd?:string)=>{signal.throwIfAborted();return command(args,Math.max(1,Math.min(timeout,deadline-Date.now())),cwd);};
 try{
  const runtime=await render(scene,folder,{...ctx,signal,outputPurpose:SPACE_DRAFT_LIMITATION},boundedCommand);signal.throwIfAborted();
  const proof={version:SPACE_DRAFT,jobId:ctx.job.id,rootJobId:ctx.job.executionRecoveryRoot??ctx.job.id,inputKey:snapshot.inputKey,checkpointSha256:snapshot.checksum,
   scope:'bounds-only',completeScene:false,quality:'not-assessed',spatialGatePassed:false,limitations:SPACE_DRAFT_LIMITATION,
   declared:{spatialOpenings:snapshot.spatialOpenings!==null,spatialContacts:snapshot.spatialContacts!==null},distManifestDigest:runtime.distManifestDigest,
   files:Object.fromEntries(['checkpoint-source.json','scene.json','render-scene.json'].map(f=>[f,digest(readFileSync(join(folder,f)))]))};
  save(join(folder,'layout-draft.json'),proof);
  const delivery=preserveOutput(ctx.job,join(ctx.dir,'..'),'generation/space-draft','graybox');
  assert(delivery?.layoutDraft?.scope==='bounds-only','真实运行证据不完整，不能发布草稿入口');
  saveDelivery(ctx.job,join(ctx.dir,'..'));
  const result={...attempt,status:'available',endedAt:Date.now(),folder:delivery.folder,distManifestDigest:runtime.distManifestDigest};save(attemptFile,result);return result;
 }catch(draftError){save(attemptFile,{...attempt,status:signal.aborted?'cancelled':'failed',endedAt:Date.now(),error:String(draftError)});throw draftError;}
}
