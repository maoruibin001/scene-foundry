import {digest} from '../store';
import {validateSpaceRelations} from './blockout';

/** 历史关系只作为复验输入，绝不继承或补造灰模通过记录。 */
export function reusedSpatialBaseline(original:any,scene:any){
 const recorded=original.blockout?.space;
 const space=structuredClone(recorded??scene);
 if(!recorded&&(!Array.isArray(scene.observedBindings)||!scene.observedBindings.length))throw Error('REFERENCE_SPATIAL_REPLAN_REQUIRED：历史场景缺少图像观察绑定，请从已确认图片重新规划');
 if(!recorded){
  const bindings=scene.observedBindings,ids=new Set(scene.program.instances.map((i:any)=>i.id));
  if(new Set(bindings.map((b:any)=>b.landmarkId)).size!==bindings.length||bindings.some((b:any)=>!b.landmarkId||!Array.isArray(b.instanceIds)||!b.instanceIds.length||b.instanceIds.some((id:string)=>!ids.has(id)))||[...ids].some(id=>!bindings.some((b:any)=>b.instanceIds.includes(id))))throw Error('REFERENCE_SPATIAL_REPLAN_REQUIRED：保存场景的图像观察与实例绑定不完整');
 }
 validateSpaceRelations(space);
 // 关系须能绑定当前保存场景；历史验收中的已删除实例不能静默丢弃。
 validateSpaceRelations({...space,program:scene.program});
 return {space,provenance:{version:'saved-spatial-baseline-v1',sourceJobId:original.id,source:recorded?'job.blockout.space':'generated-scene.json',sourceSceneSha256:digest(JSON.stringify(scene)),spatialRelationsSha256:digest(JSON.stringify(space.spatialRelations)),requiresFreshGraybox:true}};
}
