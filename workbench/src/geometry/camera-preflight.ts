import {compileGeometryProgram} from './program';
import {cameraClearance,planCameraTour} from './camera-tour';
import {stable} from '../validated-cache';
import {digest} from '../store';

export function cameraPreflight(scene:any,compiled?:ReturnType<typeof compileGeometryProgram>){
 const geometry=compiled??compileGeometryProgram({...scene.program,materials:scene.program.materials.map((m:any)=>({...m,textureId:null,surfaceDetail:null}))});
 const clear=cameraClearance(geometry.meshes);
 return {version:'camera-preflight-v1',views:scene.cameras.map((c:any)=>({name:c.name,referenceIndex:c.referenceIndex,...planCameraTour(c,clear)}))};
}
export function assertCameraPreflight(scene:any,compiled?:ReturnType<typeof compileGeometryProgram>){
 const report=cameraPreflight(scene,compiled),blocked=report.views.filter((v:any)=>v.status!=='ready');
 if(blocked.length)throw Error('CAMERA_CLEARANCE_REQUIRED：修正后机位或巡航与真实几何冲突；恢复冲突部件或修正其几何，不能通过关闭巡航绕过：'+JSON.stringify(blocked));
 return report;
}
/** 只撤回新增冲突的既有部件修改。机位、实例变换或其他部件保持，不能凭空移除障碍。 */
export function rollbackCameraRegressions(source:any,candidate:any,maxParts=4){
 const original=cameraPreflight(source),before=cameraPreflight(candidate),next=structuredClone(candidate),reverted:any[]=[];
 let after=before;
 const regressions=(report:any)=>report.views.filter((v:any)=>v.status!=='ready'&&original.views.some((b:any)=>b.referenceIndex===v.referenceIndex&&b.name===v.name&&b.status==='ready'));
 for(let n=0;n<maxParts&&regressions(after).length;n++){
  const failure=regressions(after)[0],camera=next.cameras.find((c:any)=>c.name===failure.name&&c.referenceIndex===failure.referenceIndex),priorCamera=source.cameras.find((c:any)=>c.name===camera.name&&c.referenceIndex===camera.referenceIndex);
  if(stable(camera)!==stable(priorCamera)||!failure.blocker)break;
  const matches=next.program.instances.flatMap((i:any)=>{
   const prior=source.program.instances.find((x:any)=>x.id===i.id);if(!prior||stable({...i,surfaceOverrides:[]})!==stable({...prior,surfaceOverrides:[]}))return [];
   return next.program.templates.find((t:any)=>t.id===i.template).parts.filter((p:any)=>failure.blocker===i.id+'__'+p.id+'__'+p.material).map((part:any)=>({templateId:i.template,part}));
  });
  if(matches.length!==1)break;
  const {templateId,part}=matches[0],previous=source.program.templates.find((t:any)=>t.id===templateId)?.parts.find((p:any)=>p.id===part.id);
  if(!previous||stable(previous)===stable(part))break;
  const template=next.program.templates.find((t:any)=>t.id===templateId);template.parts[template.parts.findIndex((p:any)=>p.id===part.id)]=structuredClone(previous);
  reverted.push({templateId,partId:part.id,blocker:failure.blocker,reason:failure.reason,beforeSha256:digest(stable(part)),restoredSha256:digest(stable(previous))});
  after=cameraPreflight(next);
 }
 const accepted=reverted.length>0&&regressions(after).length===0&&after.views.every((v:any)=>v.status==='ready');
 return {scene:accepted?next:structuredClone(candidate),report:{version:'camera-regression-recovery-v1',accepted,reverted:accepted?reverted:[],attempted:reverted,before,after,quality:'not-assessed',requiresFreshRuntime:true}};
}
