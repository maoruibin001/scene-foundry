import {observationSchema} from './geometry/reference-observations';
import {blockoutSchema,spaceJudgeSchema} from './geometry/blockout';
import {repairBudget,LEGACY_REPAIR_BUDGET} from './geometry/repair-budget';
import type {Complexity} from './complexity';
import {openingObservationSchema} from './geometry/opening-observations';
import {repairGoalsSchema,type RepairGoalReferences} from './geometry/repair-goals';
import {refinementSchema} from './geometry/refinement';
import {alignmentSchema} from './geometry/camera-alignment';
import {spatialRefinementSchema} from './geometry/spatial-refinement';
import {KINDS} from './scene-ir';
import {RECONSTRUCTION_SCHEMA,OBSERVATION_SCHEMA} from './native/reconstruction-schema';
import {geometryProgramSchema} from './geometry/program-schema';
import {sceneSchema} from './geometry/scene-contract';
import {layoutSchema,assetSchema} from './geometry/layout';
import {spaceSchema,surfaceSchema} from './geometry/layout-stages';
const str={type:'string'},num={type:'number'},bool={type:'boolean'};
const arr=(items:any)=>({type:'array',items});
const obj=(properties:any)=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const choice=(...values:string[])=>({type:'string',enum:values});
const nullableNum={type:['number','null']};
export type ModelSchemaContext={requirementIds?:string[];repairReferences?:RepairGoalReferences;repairComplexity?:Complexity};
export function modelSchema(role:string,context?:ModelSchemaContext):any {
 if(role==='scene-repair-plan')return repairGoalsSchema(context?.repairReferences,context?.repairComplexity?repairBudget(context.repairComplexity):LEGACY_REPAIR_BUDGET);
 if(role==='scene-openings')return openingObservationSchema();
 if(role==='scene-spatial-refine')return spatialRefinementSchema();
 if(role==='scene-alignment')return alignmentSchema();
 if(role==='scene-refine')return refinementSchema(context?.repairComplexity);
 if(role==='scene-observation')return observationSchema();
 if(role==='scene-blockout')return blockoutSchema();
 if(role==='scene-space-judge')return spaceJudgeSchema();
 if(role==='scene-space')return spaceSchema(context?.requirementIds);
 if(role==='scene-surface')return surfaceSchema();
 if(role==='scene-layout')return layoutSchema(context?.requirementIds);
 if(role==='geometry-asset')return assetSchema();
 if(role==='scene-generation')return sceneSchema(context?.requirementIds);
 if(role==='geometry')return geometryProgramSchema(context?.requirementIds);
 if(role==='reference-layout')return RECONSTRUCTION_SCHEMA;
 if(role==='reference-observations')return OBSERVATION_SCHEMA;
 const frames=arr(str);
 if(role==='plan')return obj({name:str,summary:str,capabilities:arr(choice('mapping','consistency')),assumptions:arr(str),requirements:arr(obj({id:str,text:str,critical:bool,weight:num,source:choice('prompt','image','inferred'),evidence:arr(str),count:nullableNum}))});
 if(role==='generate')return obj({name:str,entities:arr(obj({id:str,label:str,kind:choice(...KINDS),role:choice('subject','context','ground'),position:arr(num),size:arr(num),color:str,accent:str,rotation:num,requirementIds:arr(context?.requirementIds?.length?choice(...context.requirementIds):str)})),relations:arr(obj({type:choice('around','on','leftOf','rightOf'),subjects:arr(str),target:str,radius:nullableNum,gap:nullableNum}))});
 if(role==='judge')return obj({confidence:num,summary:str,specRules:arr(obj({id:str,status:choice('passed','failed','needs_review'),reason:str,frames})),entityCounts:arr(obj({kind:str,visibleMin:num,visibleMax:num,reason:str})),requirements:arr(obj({id:str,verdict:choice('met','partial','missing'),reason:str,frames})),dimensions:arr(obj({id:choice('coverage','spatial','shape','material','readability'),score:num,reason:str,frames}))});
 if(role==='repair')return obj({reason:str,patches:arr(obj({id:str,field:choice('color','accent','size','position'),value:{anyOf:[str,arr(num)]}}))});
 throw Error('Unsupported model role: '+role);
}
// JSON Schema requires optional values to be represented by null; IR uses omitted values.
export function normalizeModelValue(role:string,value:any){if(role==='generate')for(const r of value.relations??[])for(const k of ['radius','gap'])if(r[k]===null)delete r[k];return value;}
