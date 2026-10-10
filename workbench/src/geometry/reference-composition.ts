import {digest} from '../store';
import {stable} from '../validated-cache';
import {sceneVisibility} from './visibility';
import {validRect,contentBox} from './reference-projection';

export const LEGACY_REFERENCE_COMPOSITION='reference-visible-composition-v1';
export const PREVIOUS_REFERENCE_COMPOSITION='reference-visible-composition-v2';
export const REFERENCE_COMPOSITION='reference-visible-composition-v3';
export const NEXT_REFERENCE_COMPOSITION='reference-visible-composition-v4';
export const PART_REFERENCE_COMPOSITION='reference-visible-composition-v5';
export const COMPOSITION_PROMPT='referenceComposition将原图地标框与同机位实际编译网格的可见范围对照；expected/visible/delta均在已记录内容区归一化。delta=[左,上,右,下]为候选减原图，正值表示该边偏右或偏下。outsideTargetFraction仅表示该实例可见像素落在目标框外，不能当作错误率或按面积自动增删；原图框不是分割、框内不应全部填满。partial/occluded比较的是可见范围，不是完整三维边界；透明、小面积及遮挡仍有不确定性。sourceDelta显示较来源的边界残差变化，负值表示该项几何定位更接近，不能当作质量提高。结合实际Engine画面检查通道和层次，避免通过遮住实例、放大冠体或换机位追逐数值；独立空间/70评审不变。';
const round=(n:number)=>+n.toFixed(5);
const rmse=(delta:number[])=>Math.sqrt(delta.reduce((n,v)=>n+v*v,0)/4);
const centre=(r:number[])=>[(r[0]+r[2])/2,(r[1]+r[3])/2];
const bindingKey=(ids:string[])=>stable([...new Set(ids)].sort());
const MEASURED_SCOPES=['bound-instance-union','exclusive-instance-subset','exclusive-part-subset'];
const SUBSET_VERSIONS=[NEXT_REFERENCE_COMPOSITION,PART_REFERENCE_COMPOSITION];
export const COMPOSITION_SUBSET_PROMPT='reference-visible-composition-v4：同机位其他地标共用实例时，只测本地标独有的实例子集；同地标在同机位有多个观察框时，按每个实例可见像素重心逐框分配实例。此时comparisonScope=exclusive-instance-subset，measuredInstanceIds是实际测量的子集，instanceIds仍是完整绑定；残差只描述该子集的可见范围，不是整个语义部件的完整范围。子集或逐框分配与来源不同则不作来源对照，并在jointFit中视为关键目标身份改变。独有子集为空或无可见实例可分配时仍为unverified-binding-scope。';
export const COMPOSITION_PART_PROMPT='reference-visible-composition-v5：共用实例且本地标没有独有实例时，按每个部件的可见像素重心，把该实例的部件分配给同机位共用此实例的观察框（重心所在框优先，多个框取中心最近，均不包含取最近）。此时comparisonScope=exclusive-part-subset，measuredParts列出实例/部件；残差只描述这些部件的可见范围。修复候选沿用来源的部件分配：部件移出原框表现为残差变大而不是改换身份，部件不可见视为可见性丢失。分配是几何启发，不是语义真值；未分配部件和仍为unverified的目标继续对照原图与实拍判断。';
export const COMPOSITION_SCOPE_PROMPT='comparisonScope=unverified-binding-scope 时，现有实例绑定不能区分原图局部部件或同机位多个观察框；visible/pixels及所有目标残差均为null，不是0或改善。boundInstanceEvidence仅是整组实例的实际可见范围，不是该地标的范围。不能按这些整物体范围移动、缩放或增删局部部件，须依据原图与实际Engine画面；未验证项继续留给独立评审，不能当作已满足。';

/** Instance bindings locate objects, not arbitrary semantic subparts within them. */
function unresolvedScope(scene:any,observation:any,landmark:any,binding:any,target:any){
 const shared=(observation.landmarks??[]).filter((other:any)=>other.id!==landmark.id&&other.views?.some((v:any)=>v.referenceIndex===target.referenceIndex)&&
  scene.observedBindings?.some((b:any)=>b.landmarkId===other.id&&b.instanceIds?.some((id:string)=>binding.instanceIds.includes(id)))).map((other:any)=>other.id);
 const repeated=landmark.views.filter((v:any)=>v.referenceIndex===target.referenceIndex).length>1;
 return [...(shared.length?['同机位其他地标共用实例 '+[...new Set(shared)].sort().join(',')+'；缺少区分各语义部件的绑定']:[]),
  ...(repeated?['同地标在同机位有多个观察框，当前实例绑定没有逐框对应关系']:[])];
}

/** Instances owned by this view alone: bound only by this landmark on the camera, then assigned to the box nearest their visible centroid. */
function exclusiveInstances(scene:any,observation:any,landmark:any,binding:any,target:any,centroid:(id:string)=>number[]|null){
 const others=new Set<string>();
 for(const other of observation.landmarks??[])if(other.id!==landmark.id&&other.views?.some((v:any)=>v.referenceIndex===target.referenceIndex))
  for(const b of scene.observedBindings??[])if(b.landmarkId===other.id)for(const id of b.instanceIds??[])others.add(id);
 const boxes=landmark.views.filter((v:any)=>v.referenceIndex===target.referenceIndex);
 const distance=(c:number[],box:number[])=>Math.hypot(c[0]-(box[0]+box[2])/2,c[1]-(box[1]+box[3])/2);
 const owner=(c:number[])=>{const inside=boxes.filter((v:any)=>c[0]>=v.box[0]&&c[0]<=v.box[2]&&c[1]>=v.box[1]&&c[1]<=v.box[3]);
  return (inside.length?inside:boxes).reduce((best:any,v:any)=>distance(c,v.box)<distance(c,best.box)?v:best);};
 return [...new Set<string>(binding.instanceIds)].filter(id=>!others.has(id)).filter(id=>{if(boxes.length<2)return true;const c=centroid(id);return !!c&&owner(c)===target;}).sort();
}

/** Parts of fully shared instances, assigned to the sharing box nearest their visible centroid; a frozen source assignment wins. */
function exclusiveParts(scene:any,observation:any,landmark:any,binding:any,target:any,centroid:(key:string)=>number[]|null,keys:string[],frozen:any){
 const targetId=(l:any,v:any)=>digest(stable({landmarkId:l.id,referenceIndex:v.referenceIndex,box:v.box,extent:v.extent??'unknown'}));
 const prior=frozen?.rows?.find((r:any)=>r.comparisonScope==='exclusive-part-subset'&&r.targetId===targetId(landmark,target)&&bindingKey(r.instanceIds)===bindingKey(binding.instanceIds));
 if(prior)return [...prior.measuredParts];
 const views:{view:any,instances:string[]}[]=[];
 for(const other of observation.landmarks??[]){const ids=scene.observedBindings?.find((b:any)=>b.landmarkId===other.id)?.instanceIds??[];
  if(ids.some((id:string)=>binding.instanceIds.includes(id)))for(const v of other.views??[])if(v.referenceIndex===target.referenceIndex)views.push({view:v,instances:ids});}
 const distance=(c:number[],box:number[])=>Math.hypot(c[0]-(box[0]+box[2])/2,c[1]-(box[1]+box[3])/2);
 // A single visible part is the whole object again: assigning it would hide the shared-instance ambiguity.
 const visibleParts=(id:string)=>keys.filter(k=>k.split('/')[0]===id&&centroid(k)).length;
 return keys.filter(key=>binding.instanceIds.includes(key.split('/')[0])&&visibleParts(key.split('/')[0])>1).filter(key=>{const c=centroid(key);if(!c)return false;
  const eligible=views.filter(v=>v.instances.includes(key.split('/')[0])),inside=eligible.filter(({view:v})=>c[0]>=v.box[0]&&c[0]<=v.box[2]&&c[1]>=v.box[1]&&c[1]<=v.box[3]);
  return (inside.length?inside:eligible).reduce((best,v)=>distance(c,v.view.box)<distance(c,best.view.box)?v:best).view===target;}).sort();
}

/** Compare visible surfaces, not whole-object AABBs. This report never grants a quality pass. */
export function referenceComposition(scene:any,observation:any,visibility:any=undefined,options:{version?:string;assignment?:any}={}){
 const version=options.version??REFERENCE_COMPOSITION,legacy=version===LEGACY_REFERENCE_COMPOSITION;
 if(!legacy&&![PREVIOUS_REFERENCE_COMPOSITION,REFERENCE_COMPOSITION,...SUBSET_VERSIONS].includes(version))throw Error('未知构图测量版本');
 // Replaying historical evidence preserves its old measurement, never relabels it as an improvement.
 visibility??=sceneVisibility(scene,{}, {legacyPerspective:![REFERENCE_COMPOSITION,...SUBSET_VERSIONS].includes(version),partLabels:version===PART_REFERENCE_COMPOSITION});
 const partLevel=version===PART_REFERENCE_COMPOSITION,partOwners=new Map<number,any>((visibility.partPalette??[]).map((p:any)=>[p.number,p])),partKey=(p:any)=>p.instanceId+'/'+p.partId;
 const report:any={version,quality:'not-assessed',
  source:{programSha256:digest(stable(scene.program)),camerasSha256:digest(stable(scene.cameras)),bindingsSha256:digest(stable(scene.observedBindings??[])),observationSha256:digest(stable(observation??null)),visibilitySha256:digest(stable(visibility))},
  limitations:'原图框来自观察记录，不是像素分割或深度真值。可见范围来自冻结机位的低分辨率不透明编译网格；不包括透明表面、纹理颜色和光照。不推断框内目标填充密度，不作为评分或放行门槛。',rows:[],unverified:[]};
 if(!observation){report.unverified.push('缺少原图观察记录');return report;}
 const centroids=new Map<any,Map<string,number[]>>(),owners=new Map(visibility.palette.map((p:any)=>[p.number,p.instanceId]));
 // One pass per view; unknown labels are rejected by the measurement loop below.
 const centroidOf=(view:any,content:number[],bytes:Buffer)=>(id:string)=>{
  if(!centroids.has(view)){const sums=new Map<string,number[]>();
   for(let p=0;p<view.width*view.height;p++){const owner=owners.get(bytes.readUInt16LE(p*2));if(owner===undefined)continue;
    const cx=(p%view.width+.5)/view.width,cy=(Math.floor(p/view.width)+.5)/view.height;if(cx<content[0]||cx>content[2]||cy<content[1]||cy>content[3])continue;
    const sum=sums.get(owner as string)??[0,0,0];sum[0]+=cx;sum[1]+=cy;sum[2]++;sums.set(owner as string,sum);}
   centroids.set(view,new Map([...sums].map(([k,v])=>[k,[v[0]/v[2],v[1]/v[2]]])));}
  return centroids.get(view)!.get(id)??null;};
 const partCentroids=new Map<any,Map<string,number[]>>();
 const partCentroidOf=(view:any,content:number[],bytes:Buffer)=>(key:string)=>{
  if(!partCentroids.has(view)){const sums=new Map<string,number[]>();
   for(let p=0;p<view.width*view.height;p++){const owner=partOwners.get(bytes.readUInt16LE(p*2));if(owner===undefined)continue;
    const cx=(p%view.width+.5)/view.width,cy=(Math.floor(p/view.width)+.5)/view.height;if(cx<content[0]||cx>content[2]||cy<content[1]||cy>content[3])continue;
    const sum=sums.get(partKey(owner))??[0,0,0];sum[0]+=cx;sum[1]+=cy;sum[2]++;sums.set(partKey(owner),sum);}
   partCentroids.set(view,new Map([...sums].map(([k,v])=>[k,[v[0]/v[2],v[1]/v[2]]])));}
  return partCentroids.get(view)!.get(key)??null;};
 for(const landmark of observation.landmarks??[]){
  const binding=scene.observedBindings?.find((b:any)=>b.landmarkId===landmark.id);
  for(const target of landmark.views??[]){
   const key=landmark.id+'/'+target.referenceIndex;
   const cameras=scene.cameras.filter((c:any)=>c.referenceIndex===target.referenceIndex),views=visibility.views.filter((v:any)=>v.referenceIndex===target.referenceIndex);
   const content=observation.cameras?.find((c:any)=>c.referenceIndex===target.referenceIndex)?.contentRect;
   if(!binding?.instanceIds?.length||cameras.length!==1||views.length!==1||!validRect(content)){report.unverified.push(key+' 缺少唯一实例绑定、参考机位或内容区');continue;}
   if(binding.instanceIds.some((id:string)=>!scene.program.instances.some((i:any)=>i.id===id)))throw Error('构图实例绑定无效：'+key);
   const expected=contentBox(target.box,content),view=views[0],bytes=Buffer.from(view.labelsBase64,'base64');
   const targetId=digest(stable({landmarkId:landmark.id,referenceIndex:target.referenceIndex,box:target.box,extent:target.extent??'unknown'}));
   if(!Number.isInteger(view.width)||!Number.isInteger(view.height)||view.width<8||view.height<8||view.width>640||view.height>640||bytes.length!==view.width*view.height*2)throw Error('构图可见性采样无效：'+key);
   const scopeReasons=legacy?[]:unresolvedScope(scene,observation,landmark,binding,target);
   const subset=SUBSET_VERSIONS.includes(version)&&scopeReasons.length?exclusiveInstances(scene,observation,landmark,binding,target,centroidOf(view,content,bytes)):null;
   const partBytes=partLevel&&typeof view.partLabelsBase64==='string'?Buffer.from(view.partLabelsBase64,'base64'):null;
   if(partBytes&&partBytes.length!==bytes.length)throw Error('构图部件可见性采样无效：'+key);
   const parts=partBytes&&subset&&!subset.length?exclusiveParts(scene,observation,landmark,binding,target,partCentroidOf(view,content,partBytes),[...partOwners.values()].map(partKey),options.assignment):null;
   if(subset&&!subset.length&&!parts?.length)scopeReasons.push(partLevel?'没有本地标独有且可逐框分配的可见实例或部件'+(partBytes?'':'（可见性采样缺少部件身份）'):'没有本地标独有且可逐框分配的可见实例');
   const measuredIds:string[]=subset?.length?subset:binding.instanceIds;
   const numbers=new Set(visibility.palette.filter((p:any)=>measuredIds.includes(p.instanceId)).map((p:any)=>p.number));
   const partNumbers=parts?.length?new Set([...partOwners].filter(([,p])=>parts.includes(partKey(p))).map(([n])=>n)):null;
   const known=new Set(visibility.palette.map((p:any)=>p.number));known.add(0);
   let pixels=0,inside=0,excluded=0;const rect=[Infinity,Infinity,-Infinity,-Infinity];
   for(let p=0;p<view.width*view.height;p++){
    const number=bytes.readUInt16LE(p*2);if(!known.has(number))throw Error('构图可见性身份无效：'+key);
    const part=partBytes?partBytes.readUInt16LE(p*2):0;if(partBytes&&(part?partOwners.get(part)?.instanceId!==owners.get(number):number!==0))throw Error('构图部件可见性身份无效：'+key);
    if(partNumbers?!partNumbers.has(part):!numbers.has(number))continue;
    const x=p%view.width,y=Math.floor(p/view.width),cx=(x+.5)/view.width,cy=(y+.5)/view.height;
    if(cx<content[0]||cx>content[2]||cy<content[1]||cy>content[3]){excluded++;continue;}
    pixels++;if(cx>=target.box[0]&&cx<=target.box[2]&&cy>=target.box[1]&&cy<=target.box[3])inside++;
    rect[0]=Math.min(rect[0],Math.max(content[0],x/view.width));rect[1]=Math.min(rect[1],Math.max(content[1],y/view.height));
    rect[2]=Math.max(rect[2],Math.min(content[2],(x+1)/view.width));rect[3]=Math.max(rect[3],Math.min(content[3],(y+1)/view.height));
   }
   const visible=pixels?contentBox(rect,content):null,delta=visible?.map((n:number,k:number)=>n-expected[k])??null;
   if(scopeReasons.length&&!subset?.length&&!parts?.length){
    report.unverified.push(key+' '+scopeReasons.join('；'));
    report.rows.push({landmarkId:landmark.id,label:landmark.label,critical:landmark.critical,referenceIndex:target.referenceIndex,instanceIds:binding.instanceIds,
     targetId,comparisonScope:'unverified-binding-scope',extent:target.extent??'unknown',contentRect:content,expected:expected.map(round),
     visible:null,delta:null,edgeResidual:null,centreDelta:null,spanRatio:null,pixels:null,outsideTargetFraction:null,contentExcludedPixels:null,
     boundInstanceEvidence:{visible:visible?.map(round)??null,pixels,contentExcludedPixels:excluded},
     status:'unverified',warnings:scopeReasons,evidence:target.evidence});
    continue;
   }
   const warnings=[...(subset?.length?[...scopeReasons,'仅测量独有/逐框分配的实例子集 '+subset.join(',')+'，不是整个地标范围']:[]),...(parts?.length?[...scopeReasons,'仅测量按可见重心分配的部件 '+parts.join(',')+'，不是语义分割']:[]),...(target.extent==='complete'?[]:['partial/occluded：仅比较可见范围，完整物体大小未验证']),...(pixels>0&&pixels<8?['小面积采样不可靠']:[]),...(excluded?['部分几何在原图内容区外']:[]),...(!pixels?['不透明几何不可见，可能被遮挡或使用透明表面；不能用0冒充匹配']:[])];
   report.rows.push({landmarkId:landmark.id,label:landmark.label,critical:landmark.critical,referenceIndex:target.referenceIndex,instanceIds:binding.instanceIds,
    ...(subset?.length?{measuredInstanceIds:subset}:{}),...(parts?.length?{measuredParts:parts}:{}),...(!legacy?{targetId,comparisonScope:subset?.length?'exclusive-instance-subset':parts?.length?'exclusive-part-subset':'bound-instance-union'}:{}),
    extent:target.extent??'unknown',contentRect:content,expected:expected.map(round),visible:visible?.map(round)??null,delta:delta?.map(round)??null,
    edgeResidual:delta?round(rmse(delta)):null,centreDelta:visible?centre(visible).map((n,k)=>round(n-centre(expected)[k])):null,
    spanRatio:visible?[(visible[2]-visible[0])/(expected[2]-expected[0]),(visible[3]-visible[1])/(expected[3]-expected[1])].map(round):null,
    pixels,outsideTargetFraction:pixels?round(1-inside/pixels):null,contentExcludedPixels:excluded,
    status:pixels>=8?'measured-visible-extent':'unverified',warnings,evidence:target.evidence});
  }
 }
 if(!legacy)report.limitations+=' '+COMPOSITION_SCOPE_PROMPT+(SUBSET_VERSIONS.includes(version)?' '+COMPOSITION_SUBSET_PROMPT:'')+(partLevel?' '+COMPOSITION_PART_PROMPT:'');
 return report;
}

/** Keep each landmark and missing visibility explicit; never collapse them into a quality score. */
export function compositionContext(report:any,source?:any){
 if(source&&source.source.observationSha256!==report.source.observationSha256)throw Error('构图对照的原图目标发生变化');
 const legacy=report.version===LEGACY_REFERENCE_COMPOSITION;
 if(source&&source.version!==report.version)throw Error('构图对照的测量版本发生变化');
 return {...report,rows:report.rows.map((row:any)=>{
  const matches=source?.rows.filter((r:any)=>legacy?r.landmarkId===row.landmarkId&&r.referenceIndex===row.referenceIndex:
   r.targetId===row.targetId&&bindingKey(r.instanceIds)===bindingKey(row.instanceIds))??[];
  const scoped=(r:any)=>MEASURED_SCOPES.includes(r.comparisonScope),measuredKey=(r:any)=>r.comparisonScope+bindingKey(r.measuredParts??r.measuredInstanceIds??r.instanceIds);
  const before=legacy?matches[0]:matches.length===1&&scoped(row)&&scoped(matches[0])&&measuredKey(row)===measuredKey(matches[0])?matches[0]:null;
  // v4 assignment follows candidate geometry; a measured source target whose measured subset changed must not escape comparison.
  if(!before&&SUBSET_VERSIONS.includes(report.version)&&matches.length===1&&scoped(matches[0]))
   return {...row,sourceDelta:{edgeResidual:null,wasVisible:matches[0].pixels>0,isVisible:row.pixels>0,visibilityLost:false,identityChanged:true}};
  return {...row,sourceDelta:before?{edgeResidual:row.edgeResidual!==null&&before.edgeResidual!==null?round(row.edgeResidual-before.edgeResidual):null,
   wasVisible:before.pixels>0,isVisible:row.pixels>0,visibilityLost:before.pixels>0&&row.pixels===0}:null};
 })};
}
