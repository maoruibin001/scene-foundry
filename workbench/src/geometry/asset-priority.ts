import {assetReferenceEvidence} from './asset-reference-evidence';
/** 优先处理原图占画面大、绑定关键需求的模板；不依赖餐厅或巷子类别词。 */
export function prioritizeAssets(briefs:any[],layout:any,plan:any,observation:any){
 return briefs.map((brief,index)=>{
  const instances=layout.program.instances.filter((i:any)=>i.template===brief.id);
  const requirements=new Set(instances.flatMap((i:any)=>i.requirementIds)),critical=plan.requirements.filter((r:any)=>r.critical&&requirements.has(r.id)).length;
  const evidence=assetReferenceEvidence(layout,brief.id,observation);
  const salience=evidence.views.reduce((n:number,v:any)=>Math.max(n,(v.box[2]-v.box[0])*(v.box[3]-v.box[1])),0);
  return {brief,index,critical,salience,salienceEvidence:{scope:evidence.views.length?'template-group':'unknown',landmarkIds:[...new Set(evidence.views.map(v=>v.landmarkId))],contextLandmarkIds:[...new Set(evidence.contextViews.map(v=>v.landmarkId))]},priority:salience*100+critical*4};
 }).sort((a,b)=>b.priority-a.priority||a.index-b.index);
}

/** 预览预算与制作排序分离：至少覆盖一个已声明主体，避免大面积地面包揽检查。 */
export function selectAssetPreviews(ranked:ReturnType<typeof prioritizeAssets>,layout:any,limit:number){
 const count=Math.max(0,Math.min(ranked.length,Math.floor(limit)||0));
 if(!count)return [];
 const subjects=new Set((layout.entities??[]).filter((e:any)=>e.role==='subject').map((e:any)=>e.instanceId));
 const subject=ranked.find(r=>layout.program.instances.some((i:any)=>i.template===r.brief.id&&subjects.has(i.id)));
 const selected=subject?[subject]:[];
 for(const row of ranked)if(selected.length<count&&!selected.includes(row))selected.push(row);
 return selected.map(row=>({templateId:row.brief.id,reason:row===subject?'覆盖图中主要主体；其余名额按可见面积和关键需求分配':'按可见面积和关键需求分配'}));
}
