import {generationInput} from './reference-input';
import {stable} from './validated-cache';

export function isRegeneration(options:any){
 return !!options.retryRoot&&(!options.validationKind||options.validationKind==='generation')&&!['recoverySourceJobId','automaticRecoveryFrom','reuseCheckpoint','reuseSceneFrom','reuseAssessmentFrom','reusePlanFrom','reuseRefinementOutput','reuseFrom','refineScene'].some(k=>options[k]);
}

/** A repeated normal retry joins the active execution; it never reserves another repair. */
export function activeRegeneration(source:any,jobs:any[],input:any=source){
 const root=source.retryRoot??source.id,identity=stable(generationInput(source));
 if(stable(generationInput(input))!==identity)return null;
 return jobs.filter(j=>['running','queued'].includes(j.status)&&
  ((j.retryRoot??j.id)===root||!!source.improvementId&&j.improvementId===source.improvementId)&&
  stable(generationInput(j))===identity).sort((a,b)=>a.createdAt.localeCompare(b.createdAt))[0]??null;
}
