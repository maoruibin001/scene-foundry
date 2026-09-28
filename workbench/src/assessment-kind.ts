/** A copied generation directory does not make a re-assessment a new repair. */
export function assessmentOnly(job:any){return !!job.reuseAssessmentFrom||['scoring-migration','assessment-continuation'].includes(job.validationKind);}
