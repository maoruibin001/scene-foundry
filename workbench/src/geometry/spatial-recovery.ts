import {cpSync,existsSync,mkdirSync,readFileSync,constants} from 'node:fs';
import {join} from 'node:path';
import {digest,read,runDir,save,saveJob,event,ROOT} from '../store';
import {versions} from '../versions';
import {inspectOutput} from '../output-delivery';
import {assertSpatialAccepted,spatialInstances} from './spatial-order';
import {spatialGate} from './blockout';

const same=(a:any,b:any)=>JSON.stringify(a)===JSON.stringify(b);
export const SPATIAL_SOURCES=['program.ts','voxel-volume.ts','branch-crown.ts','prepare.ts','curved-surfaces.ts','surface-mapping.ts','mesh.ts','constraints.ts','distribution.ts','texture-bundle.ts','surface-detail.ts','material-emission.ts','camera-tour.ts','lighting.ts','blockout-presentation.ts','reference-framing.ts','reference-frame.mjs','spatial-order.ts'];
export function sameSpatialCompiler(recorded:Record<string,string>,current:Record<string,string>){return SPATIAL_SOURCES.every(file=>recorded[file]&&recorded[file]===current[file]);}
/** Reuse only a completed spatial check of this exact scene in this execution recovery chain. */
export function sameSpatialRecovery(target:any,source:any,scene:any,savedScene:any,plan:any,savedPlan:any,grayScene:any,gate:any){
 if(!target.recoverySourceJobId||target.refineScene||target.reuseRefinementOutput||target.executionRecoveryRoot!==(source.executionRecoveryRoot??source.id))return false;
 if(target.reuseSceneFrom!==source.id||!same(scene,savedScene)||!same(plan,savedPlan))return false;
 for(const key of ['prompt','baselineId','complexity','matchingLevel'])if(!same(target[key],source[key]))return false;
 if(!same((target.images??[]).map((i:any)=>i.id),(source.images??[]).map((i:any)=>i.id))||!same(target.policy,source.policy))return false;
 if(target.profile.engineSha!==source.profile.engineSha||target.profile.generatorSha!==source.profile.generatorSha||!same(target.optimizationPolicy?.spatialPreflight,source.optimizationPolicy?.spatialPreflight))return false;
 const last=source.blockout?.rounds?.at(-1);if(!last||!same(last,gate))return false;
 try{assertSpatialAccepted(source,scene);}catch{return false;}
 const templates=scene.program.templates.map((t:any)=>({...t,parts:t.parts.map((p:any)=>({...p,material:'blockout'}))}));
 if(!same(grayScene.program.templates,templates)||!same(grayScene.program.instances,spatialInstances(scene.program.instances))||!same(grayScene.cameras,scene.cameras))return false;
 return spatialGate(gate.review,source.blockout.space,gate.frames,target.optimizationPolicy).passed;
}
export function recoverSpatialAcceptance(job:any,scene:any,plan:any,generationDir:string){
 if(!job.reuseSceneFrom||!job.recoverySourceJobId)return false;
 const sourceDir=runDir(job.reuseSceneFrom),source=read(join(sourceDir,'job.json')),last=source.blockout?.rounds?.at(-1);
 if(!last||!/^generation\/blockout\/\d+$/.test(last.path))return false;
 const frozen=source.pipelineVersion?.sourceArchived?versions.get(source.pipelineVersion.id).files:null;
 if(!frozen||!sameSpatialCompiler(Object.fromEntries(SPATIAL_SOURCES.map(file=>[file,frozen['workbench/src/geometry/'+file]])),Object.fromEntries(SPATIAL_SOURCES.map(file=>[file,digest(readFileSync(join(ROOT,'src/geometry',file)))]))))return false;
 const folder=join(sourceDir,last.path),files=['scene.json','gate.json','runtime/runtime.json','project/evidence/run-report.json'];
 if(!files.every(f=>existsSync(join(folder,f))))return false;
 if(!sameSpatialRecovery(job,source,scene,read(join(sourceDir,'generated-scene.json')),plan,read(join(sourceDir,'plan.json')),read(join(folder,'scene.json')),read(join(folder,'gate.json'))))return false;
 const proof=inspectOutput(source,sourceDir,last.path,'graybox');
 if(!proof||proof.distManifestDigest!==last.runtimeDigest||!proof.hardChecks.multipleViews||last.frames.some((f:string)=>!proof.images.includes(last.path+'/runtime/'+f)))return false;
 const relative=last.path.slice('generation/'.length),destination=join(generationDir,relative);mkdirSync(generationDir,{recursive:true});
 cpSync(folder,destination,{recursive:true,verbatimSymlinks:true,mode:constants.COPYFILE_FICLONE});
 job.blockout=structuredClone(source.blockout);job.blockout.reusedFrom={jobId:source.id,path:last.path,runtimeDigest:last.runtimeDigest};
 save(join(generationDir,'space.json'),job.blockout.space);
 save(join(generationDir,'spatial-recovery.json'),{version:'verified-spatial-recovery-v1',sourceJobId:source.id,executionRecoveryRoot:job.executionRecoveryRoot,sourceSceneSha256:digest(readFileSync(join(sourceDir,'generated-scene.json'))),runtimeDigest:last.runtimeDigest,files:Object.fromEntries(files.map(f=>[f,digest(readFileSync(join(folder,f)))])),modelCalls:0,scope:'同一执行恢复根、相同场景和机位的已完成灰模证据；成品仍须重新运行与评分，不是新一轮空间评审'});
 saveJob(job);event(job,'spatial-proof-reused','相同场景与机位的灰模证据已核验复用；继续成品运行与独立评分');return true;
}
