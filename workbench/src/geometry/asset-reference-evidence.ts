/** A box bound to several templates describes their shared context. Its area
 * cannot be attributed to each template. Multiple instances of one template
 * remain valid group evidence; neither case implies per-part segmentation. */
export function assetReferenceEvidence(layout:any,templateId:string,observation:any){
 const instances=layout.program.instances,own=new Set(instances.filter((i:any)=>i.template===templateId).map((i:any)=>i.id));
 const evidence:any[]=[],views:any[]=[],contextViews:any[]=[];
 for(const landmark of observation?.landmarks??[]){
  const bindings=(layout.observedBindings??[]).filter((b:any)=>b.landmarkId===landmark.id);
  const ids=[...new Set<string>(bindings.flatMap((b:any)=>b.instanceIds??[]))];
  if(!ids.some(id=>own.has(id)))continue;
  const matches=ids.map(id=>instances.filter((i:any)=>i.id===id));
  const known=bindings.length===1&&matches.every(xs=>xs.length===1);
  const templateIds=[...new Set<string>(matches.flatMap(xs=>xs.map((i:any)=>i.template)))].sort();
  const evidenceScope=!known?'unresolved-binding':templateIds.length===1&&templateIds[0]===templateId?'template-group':'shared-context';
  evidence.push({...landmark,evidenceScope,templateIds});
  for(const view of landmark.views??[]){
   const row={...view,landmarkId:landmark.id,label:landmark.label,evidenceScope,templateIds};
   (evidenceScope==='template-group'?views:contextViews).push(row);
  }
 }
 return {evidence,views,contextViews};
}

export const ASSET_REFERENCE_SCOPE_GUIDANCE='referenceEvidence 的 evidenceScope=template-group 表示该原图框只绑定当前模板的一个或多个实例，仍不是部件分割。shared-context / unresolved-binding 只说明资产与该场景区域有关，不能把整组范围、画幅面积或光照关系当作当前资产自身轮廓。局部裁图只取 template-group；其余上下文保留完整原图与文字依据，没有局部框时不编造。';
