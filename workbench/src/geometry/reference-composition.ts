import {digest} from '../store';
import {stable} from '../validated-cache';
import {sceneVisibility} from './visibility';
import {validRect,contentBox} from './reference-projection';

export const LEGACY_REFERENCE_COMPOSITION='reference-visible-composition-v1';
export const REFERENCE_COMPOSITION='reference-visible-composition-v2';
export const COMPOSITION_PROMPT='referenceComposition将原图地标框与同机位实际编译网格的可见范围对照；expected/visible/delta均在已记录内容区归一化。delta=[左,上,右,下]为候选减原图，正值表示该边偏右或偏下。outsideTargetFraction仅表示该实例可见像素落在目标框外，不能当作错误率或按面积自动增删；原图框不是分割、框内不应全部填满。partial/occluded比较的是可见范围，不是完整三维边界；透明、小面积及遮挡仍有不确定性。sourceDelta显示较来源的边界残差变化，负值表示该项几何定位更接近，不能当作质量提高。结合实际Engine画面检查通道和层次，避免通过遮住实例、放大冠体或换机位追逐数值；独立空间/70评审不变。';
const round=(n:number)=>+n.toFixed(5);
const rmse=(delta:number[])=>Math.sqrt(delta.reduce((n,v)=>n+v*v,0)/4);
const centre=(r:number[])=>[(r[0]+r[2])/2,(r[1]+r[3])/2];
const bindingKey=(ids:string[])=>stable([...new Set(ids)].sort());
export const COMPOSITION_SCOPE_PROMPT='comparisonScope=unverified-binding-scope 时，现有实例绑定不能区分原图局部部件或同机位多个观察框；visible/pixels及所有目标残差均为null，不是0或改善。boundInstanceEvidence仅是整组实例的实际可见范围，不是该地标的范围。不能按这些整物体范围移动、缩放或增删局部部件，须依据原图与实际Engine画面；未验证项继续留给独立评审，不能当作已满足。';

/** Instance bindings locate objects, not arbitrary semantic subparts within them. */
function unresolvedScope(scene:any,observation:any,landmark:any,binding:any,target:any){
 const shared=(observation.landmarks??[]).filter((other:any)=>other.id!==landmark.id&&other.views?.some((v:any)=>v.referenceIndex===target.referenceIndex)&&
  scene.observedBindings?.some((b:any)=>b.landmarkId===other.id&&b.instanceIds?.some((id:string)=>binding.instanceIds.includes(id)))).map((other:any)=>other.id);
 const repeated=landmark.views.filter((v:any)=>v.referenceIndex===target.referenceIndex).length>1;
 return [...(shared.length?['同机位其他地标共用实例 '+[...new Set(shared)].sort().join(',')+'；缺少区分各语义部件的绑定']:[]),
  ...(repeated?['同地标在同机位有多个观察框，当前实例绑定没有逐框对应关系']:[])];
}

/** Compare visible surfaces, not whole-object AABBs. This report never grants a quality pass. */
export function referenceComposition(scene:any,observation:any,visibility=sceneVisibility(scene),options:{version?:string}={}){
 const version=options.version??REFERENCE_COMPOSITION,legacy=version===LEGACY_REFERENCE_COMPOSITION;
 if(!legacy&&version!==REFERENCE_COMPOSITION)throw Error('未知构图测量版本');
 const report:any={version,quality:'not-assessed',
  source:{programSha256:digest(stable(scene.program)),camerasSha256:digest(stable(scene.cameras)),bindingsSha256:digest(stable(scene.observedBindings??[])),observationSha256:digest(stable(observation??null)),visibilitySha256:digest(stable(visibility))},
  limitations:'原图框来自观察记录，不是像素分割或深度真值。可见范围来自冻结机位的低分辨率不透明编译网格；不包括透明表面、纹理颜色和光照。不推断框内目标填充密度，不作为评分或放行门槛。',rows:[],unverified:[]};
 if(!observation){report.unverified.push('缺少原图观察记录');return report;}
 for(const landmark of observation.landmarks??[]){
  const binding=scene.observedBindings?.find((b:any)=>b.landmarkId===landmark.id);
  for(const target of landmark.views??[]){
   const key=landmark.id+'/'+target.referenceIndex;
   const cameras=scene.cameras.filter((c:any)=>c.referenceIndex===target.referenceIndex),views=visibility.views.filter((v:any)=>v.referenceIndex===target.referenceIndex);
   const content=observation.cameras?.find((c:any)=>c.referenceIndex===target.referenceIndex)?.contentRect;
   if(!binding?.instanceIds?.length||cameras.length!==1||views.length!==1||!validRect(content)){report.unverified.push(key+' 缺少唯一实例绑定、参考机位或内容区');continue;}
   if(binding.instanceIds.some((id:string)=>!scene.program.instances.some((i:any)=>i.id===id)))throw Error('构图实例绑定无效：'+key);
   const expected=contentBox(target.box,content),view=views[0],bytes=Buffer.from(view.labelsBase64,'base64');
   const scopeReasons=legacy?[]:unresolvedScope(scene,observation,landmark,binding,target);
   const targetId=digest(stable({landmarkId:landmark.id,referenceIndex:target.referenceIndex,box:target.box,extent:target.extent??'unknown'}));
   if(!Number.isInteger(view.width)||!Number.isInteger(view.height)||view.width<8||view.height<8||view.width>640||view.height>640||bytes.length!==view.width*view.height*2)throw Error('构图可见性采样无效：'+key);
   const numbers=new Set(visibility.palette.filter((p:any)=>binding.instanceIds.includes(p.instanceId)).map((p:any)=>p.number));
   const known=new Set(visibility.palette.map((p:any)=>p.number));known.add(0);
   let pixels=0,inside=0,excluded=0;const rect=[Infinity,Infinity,-Infinity,-Infinity];
   for(let p=0;p<view.width*view.height;p++){
    const number=bytes.readUInt16LE(p*2);if(!known.has(number))throw Error('构图可见性身份无效：'+key);if(!numbers.has(number))continue;
    const x=p%view.width,y=Math.floor(p/view.width),cx=(x+.5)/view.width,cy=(y+.5)/view.height;
    if(cx<content[0]||cx>content[2]||cy<content[1]||cy>content[3]){excluded++;continue;}
    pixels++;if(cx>=target.box[0]&&cx<=target.box[2]&&cy>=target.box[1]&&cy<=target.box[3])inside++;
    rect[0]=Math.min(rect[0],Math.max(content[0],x/view.width));rect[1]=Math.min(rect[1],Math.max(content[1],y/view.height));
    rect[2]=Math.max(rect[2],Math.min(content[2],(x+1)/view.width));rect[3]=Math.max(rect[3],Math.min(content[3],(y+1)/view.height));
   }
   const visible=pixels?contentBox(rect,content):null,delta=visible?.map((n:number,k:number)=>n-expected[k])??null;
   if(scopeReasons.length){
    report.unverified.push(key+' '+scopeReasons.join('；'));
    report.rows.push({landmarkId:landmark.id,label:landmark.label,critical:landmark.critical,referenceIndex:target.referenceIndex,instanceIds:binding.instanceIds,
     targetId,comparisonScope:'unverified-binding-scope',extent:target.extent??'unknown',contentRect:content,expected:expected.map(round),
     visible:null,delta:null,edgeResidual:null,centreDelta:null,spanRatio:null,pixels:null,outsideTargetFraction:null,contentExcludedPixels:null,
     boundInstanceEvidence:{visible:visible?.map(round)??null,pixels,contentExcludedPixels:excluded},
     status:'unverified',warnings:scopeReasons,evidence:target.evidence});
    continue;
   }
   const warnings=[...(target.extent==='complete'?[]:['partial/occluded：仅比较可见范围，完整物体大小未验证']),...(pixels>0&&pixels<8?['小面积采样不可靠']:[]),...(excluded?['部分几何在原图内容区外']:[]),...(!pixels?['不透明几何不可见，可能被遮挡或使用透明表面；不能用0冒充匹配']:[])];
   report.rows.push({landmarkId:landmark.id,label:landmark.label,critical:landmark.critical,referenceIndex:target.referenceIndex,instanceIds:binding.instanceIds,
    ...(!legacy?{targetId,comparisonScope:'bound-instance-union'}:{}),
    extent:target.extent??'unknown',contentRect:content,expected:expected.map(round),visible:visible?.map(round)??null,delta:delta?.map(round)??null,
    edgeResidual:delta?round(rmse(delta)):null,centreDelta:visible?centre(visible).map((n,k)=>round(n-centre(expected)[k])):null,
    spanRatio:visible?[(visible[2]-visible[0])/(expected[2]-expected[0]),(visible[3]-visible[1])/(expected[3]-expected[1])].map(round):null,
    pixels,outsideTargetFraction:pixels?round(1-inside/pixels):null,contentExcludedPixels:excluded,
    status:pixels>=8?'measured-visible-extent':'unverified',warnings,evidence:target.evidence});
  }
 }
 if(!legacy)report.limitations+=' '+COMPOSITION_SCOPE_PROMPT;
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
  const before=legacy?matches[0]:matches.length===1&&row.comparisonScope==='bound-instance-union'&&matches[0].comparisonScope==='bound-instance-union'?matches[0]:null;
  return {...row,sourceDelta:before?{edgeResidual:row.edgeResidual!==null&&before.edgeResidual!==null?round(row.edgeResidual-before.edgeResidual):null,
   wasVisible:before.pixels>0,isVisible:row.pixels>0,visibilityLost:before.pixels>0&&row.pixels===0}:null};
 })};
}
