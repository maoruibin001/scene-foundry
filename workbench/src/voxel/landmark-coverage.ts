export const VOXEL_LANDMARK_COVERAGE='voxel-landmark-coverage-v1';
export const STRICT_VOXEL_CONSTRUCTION='voxel-lattice-v1';
export const GEOMETRY_SCOPES=['object','component','void','group'] as const;
export type GeometryScope=typeof GEOMETRY_SCOPES[number];

const fail=(ok:any,message:string)=>{if(!ok)throw Error('VOXEL_LANDMARK_COVERAGE: '+message);};
const key=(ids:string[])=>JSON.stringify([...ids].sort());
export function validGeometryScope(scope:unknown):scope is GeometryScope{return GEOMETRY_SCOPES.includes(scope as GeometryScope);}

export const VOXEL_OBSERVATION_COVERAGE_GUIDANCE=`严格体素观察需为每个地标声明geometryScope：object是可辨认的独立实物，component是依附于其他实物但有独立可见轮廓、体量或遮挡的组件，void是门窗洞口或通道的净空，group是多个已有实物/组件构成的集合关系。分类依据图片证据，不依据名称或题材猜测。重要的附着块簇等组件需按component记录，不能并入整墙来隐藏缺失；空间位置分离的关键组件区域分成独立地标，例如不同墙面的附着簇不能由一个平台小簇代表全部。同一组件的多个参考视角共用一个地标ID，同一连续区域内有证据的重复组件可按group记录，但须引用实际构成实例，不能把宿主墙体别名当作组件组。规划时每个关键object/component至少需一个由该地标独立拥有的真实实例，关键component的所有绑定实例均须独立属于该组件，有自己的模板bounds，不能混入整面墙、门框或其他主体别名；同类模板可复用。void可绑定承载洞口的墙体，group可引用其构成实例，但关键group的绑定集合不得与其他非void地标完全相同。整个建筑或组件集合请以group表达，不同时用object将各组件实例都吞进一个别名地标。未观察到的组件不能补造；已观察且关键的组件不能省略或靠宽泛绑定伪装已实现。此约束是目标分解与语义实例覆盖依据，不证明各区域已出现；真实几何、遮挡及相似度仍需独立实拍验收。`;

/** A fresh lattice space proves component identities, not geometry or visual quality. */
export function validateVoxelLandmarkCoverage(space:any,observation:any){
 if(space?.voxelLattice===undefined)return {version:VOXEL_LANDMARK_COVERAGE,applicable:false,quality:'not-assessed' as const};
 fail(space.voxelLattice&&space.voxelLattice.version===STRICT_VOXEL_CONSTRUCTION,'未知或无效的严格体素空间版本');
 const landmarks=observation?.landmarks,bindings=space.observedBindings,instances=space.program?.instances,templates=space.program?.templates;
 fail(Array.isArray(landmarks)&&landmarks.length&&landmarks.every(l=>typeof l.id==='string'&&l.id.trim())&&new Set(landmarks.map(l=>l.id)).size===landmarks.length,'缺少唯一原图地标');
 for(const landmark of landmarks){
  fail(validGeometryScope(landmark.geometryScope),'严格体素地标需声明有效geometryScope：'+landmark.id);
  fail(typeof landmark.critical==='boolean','地标关键性必须明确：'+landmark.id);
 }
 fail(Array.isArray(bindings)&&bindings.length===landmarks.length&&new Set(bindings.map(b=>b.landmarkId)).size===bindings.length,'每个原图地标须有唯一实例绑定');
 fail(Array.isArray(instances)&&instances.every(i=>typeof i.id==='string'&&i.id.trim())&&new Set(instances.map(i=>i.id)).size===instances.length&&Array.isArray(templates)&&templates.every(t=>typeof t.id==='string'&&t.id.trim())&&new Set(templates.map(t=>t.id)).size===templates.length,'空间实例或模板身份无效');
 const instanceMap=new Map<string,any>(instances.map(i=>[i.id,i])),templateMap=new Map<string,any>(templates.map(t=>[t.id,t]));
 const rows=landmarks.map(landmark=>{
  const binding=bindings.find(b=>b.landmarkId===landmark.id),ids=binding?.instanceIds;
  fail(Array.isArray(ids)&&ids.length&&new Set(ids).size===ids.length&&ids.every(id=>typeof id==='string'&&instanceMap.has(id)),'地标缺少唯一的真实实例绑定：'+landmark.id);
  return {landmarkId:landmark.id,geometryScope:landmark.geometryScope as GeometryScope,critical:landmark.critical,instanceIds:[...ids] as string[],exclusiveInstanceIds:[] as string[]};
 });
 const substantive=rows.filter(row=>row.geometryScope==='object'||row.geometryScope==='component');
 for(const row of substantive)row.exclusiveInstanceIds=row.instanceIds.filter(id=>!substantive.some(other=>other!==row&&other.instanceIds.includes(id)));
 // Diagnose borrowed component identities before asking the host to change its binding.
 for(const row of [...substantive].sort((a,b)=>Number(b.geometryScope==='component')-Number(a.geometryScope==='component'))){
  if(!row.critical)continue;
  fail(row.exclusiveInstanceIds.length,'关键'+row.geometryScope+'没有独立实例，不能用其他主体的别名代替组件：'+row.landmarkId);
  // One platform component must not legitimize aliases to every surrounding wall.
  if(row.geometryScope==='component')fail(row.exclusiveInstanceIds.length===row.instanceIds.length,'关键component不能混入其他主体实例的别名绑定：'+row.landmarkId);
  for(const id of row.exclusiveInstanceIds){
   const instance=instanceMap.get(id),brief=templateMap.get(instance.template),bounds=brief?.bounds;
   fail(brief&&Array.isArray(bounds?.min)&&Array.isArray(bounds?.max)&&bounds.min.length===3&&bounds.max.length===3&&bounds.min.every(Number.isFinite)&&bounds.max.every((n,k)=>Number.isFinite(n)&&n>bounds.min[k]),'独立实例须有自己的模板及有限正跨度bounds：'+row.landmarkId+'/'+id);
  }
 }
 for(const row of rows.filter(row=>row.critical&&row.geometryScope==='group'))
  fail(!rows.some(other=>other!==row&&other.geometryScope!=='void'&&key(other.instanceIds)===key(row.instanceIds)),'关键group不能复用其他非void地标的相同绑定集合：'+row.landmarkId);
 return {version:VOXEL_LANDMARK_COVERAGE,applicable:true,quality:'not-assessed' as const,rows};
}
