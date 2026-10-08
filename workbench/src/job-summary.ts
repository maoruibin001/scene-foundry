/** Sidebar metadata comes from the already-loaded job, never an optional diagnostic scan. */
export function compactJob(j:any){
 return {id:j.id,createdAt:j.createdAt,updatedAt:j.updatedAt,endedAt:Number.isFinite(j.endedAt)?j.endedAt:null,status:j.status,prompt:j.prompt,image:j.image,mode:j.mode,complexity:j.complexity,pipelineVersion:j.pipelineVersion,profile:{id:j.profile.id,provider:j.profile.provider,model:j.profile.model,reasoningEffort:j.profile.reasoningEffort},plan:j.plan?{name:j.plan.name}:null,benchEligible:!['queued','running'].includes(j.status)&&Boolean(j.runtime&&j.review),assessmentProfileId:(j.assessmentProfile??j.profile).id,_summary:true};
}
