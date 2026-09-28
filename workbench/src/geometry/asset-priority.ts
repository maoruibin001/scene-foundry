/** 优先处理原图占画面大、绑定关键需求的模板；不依赖餐厅或巷子类别词。 */
export function prioritizeAssets(briefs:any[],layout:any,plan:any,observation:any){
 return briefs.map((brief,index)=>{
  const instances=layout.program.instances.filter((i:any)=>i.template===brief.id),ids=new Set(instances.map((i:any)=>i.id));
  const requirements=new Set(instances.flatMap((i:any)=>i.requirementIds)),critical=plan.requirements.filter((r:any)=>r.critical&&requirements.has(r.id)).length;
  const landmarks=(observation?.landmarks??[]).filter((l:any)=>layout.observedBindings?.some((b:any)=>b.landmarkId===l.id&&b.instanceIds.some((id:string)=>ids.has(id))));
  const salience=landmarks.reduce((n:number,l:any)=>Math.max(n,...l.views.map((v:any)=>(v.box[2]-v.box[0])*(v.box[3]-v.box[1]))),0);
  return {brief,index,critical,salience,priority:salience*100+critical*4};
 }).sort((a,b)=>b.priority-a.priority||a.index-b.index);
}
