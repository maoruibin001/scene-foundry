import type {ExportPlan} from './export-pack';
/** Offline inventory chooses optimization candidates; it is never an FPS result. */
export function performanceAudit(plan:ExportPlan){
 const instances=new Map<string,number>();for(const e of plan.entities)instances.set(e.mesh,(instances.get(e.mesh)??0)+1);
 const meshes=plan.meshes.map(m=>({key:m.key,generator:m.generator,sourcePreserved:m.generator==='GEN-SOURCE-MESH-01',triangles:m.triangles,instances:instances.get(m.key)??0,
  submittedTriangleUpperBound:m.triangles*(instances.get(m.key)??0),
  review:m.triangles>=100000?'review silhouette-preserving LOD and normal baking at player distance':'measure before changing'}));
 return {version:'scene-performance-audit-v1',kind:'offline-inventory',entities:plan.entities.length,uniqueMeshes:meshes.length,
  totalInstanceTriangles:plan.triangles,meshes:meshes.sort((a,b)=>b.submittedTriangleUpperBound-a.submittedTriangleUpperBound),
  optimizationApplied:false,normalBakeApplied:false,lodApplied:false,gpuFrameMs:null,fps:null,
  next:'Measure ordinary Engine runtime; optimize the measured owner. Preserve silhouette, lighting, materials, source IDs and a rollback revision.'};
}
