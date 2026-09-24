import {cpSync,existsSync,mkdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {digest,read,save} from './store';
import {verifiedRuntimeEvidence} from './runtime-evidence';
/** Copy a fixed, verified build into a new assessment record; never mutate the cancelled source. */
export function copyAssessmentEvidence(source:any,target:any,from:string,to:string){
 const report=read(join(from,'project/evidence/run-report.json'));
 verifiedRuntimeEvidence(report,source.runtime,target.profile,digest(readFileSync(join(from,'project/game/dist/forgeax-dist.json'))),target.policy?.minSubmittedFps??10);
 mkdirSync(to,{recursive:true});
 for(const name of ['project','runtime','materials','generation','plan.json','plan-response.txt','generation-brief.json','spec-snapshot.json','generated-scene.json','structure.json','complexity.json','scene-ir.json','recipe.json'])if(existsSync(join(from,name)))cpSync(join(from,name),join(to,name),{recursive:true,dereference:false});
 for(const key of ['plan','runtime','structure','sceneProgram','sceneIR','bounds','generationBrief','complexityReport','blockout','specSource','objectCount','entityCount'])if(source[key]!==undefined)target[key]=structuredClone(source[key]);
 target.generatedVersion=source.generatedVersion??source.pipelineVersion;
 target.evidenceSource={jobId:source.id,pipelineVersion:source.pipelineVersion,distManifestDigest:source.runtime.distManifestDigest};
 for(const key of ['plan','generate','export','build','verify','runtime'])if(source.stages?.[key]?.status==='passed')target.stages[key]={status:'passed',reused:true,sourceJobId:source.id,durationMs:0};
 save(join(to,'recovery-source.json'),target.evidenceSource);
}
