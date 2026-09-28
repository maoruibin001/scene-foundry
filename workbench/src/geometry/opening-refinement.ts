import {stable} from '../validated-cache';

/** 修正推断的坐标与尺寸，不改变开口身份、参考依据、净空深度或后景义务。 */
export function correctedOpeningSource(source:any,patch:any){
 const updates=patch.openingUpdates??[];
 const require=(ok:any,message:string)=>{if(!ok)throw Error('开口估计修正：'+message)};
 require(Array.isArray(updates)&&updates.length<=32,'数量无效');
 require(new Set(updates.map((u:any)=>u.id)).size===updates.length,'ID重复');
 const next=structuredClone(source);
 for(const u of updates){
  require(u&&Object.keys(u).sort().join(',')==='center,evidence,height,id,width','仅允许id、center、width、height、evidence');
  const opening=next.spatialOpenings?.find((o:any)=>o.id===u.id);
  require(opening,'不能创建或删除参考开口');
  require(typeof u.evidence==='string'&&u.evidence.trim().length>=20,'须说明原图对应位置、现有误差和修正依据');
  const template=source.program.instances.find((i:any)=>i.id===opening.instanceId)?.template;
  require((patch.parts??[]).some((p:any)=>p.templateId===template&&stable(source.program.templates.find((t:any)=>t.id===template)?.parts.find((x:any)=>x.id===p.part.id))!==stable(p.part))||(patch.removeParts??[]).some((p:any)=>p.templateId===template),'必须同步修改宿主实际几何，不能只移动验收净区');
  for(const k of ['width','height'])require(Number.isFinite(u[k])&&u[k]>=opening[k]*.5&&u[k]<=opening[k]*2,'单轮尺寸修正须在原估计一半至两倍内');
  require(Array.isArray(u.center)&&u.center.length===3&&u.center.every(Number.isFinite)&&Math.hypot(...u.center.map((v:number,k:number)=>v-opening.center[k]))<=Math.max(opening.width,opening.height)*.5,'中心偏移超出局部关联范围');
  Object.assign(opening,{center:u.center,width:u.width,height:u.height,evidence:opening.evidence+'；本轮修正依据：'+u.evidence});
 }
 return next;
}

export const OPENING_REFINEMENT_PROMPT='本轮开口估计可纠正：可选openingUpdates数组，每项严格包含id、center、width、height、evidence。id必须是原有开口；center沿用模板局部坐标，width/height为通透矩形内区；evidence至少20字，明确原参考图对应位置、当前误差及修正依据。必须同步修改同一宿主parts或removeParts的真实几何，不能只移动检测区域躲避遮挡；不改变instanceId、referenceIndices、normal、up、clearDepth、expectedBeyond，不删除开口或降低后景义务。原尺寸是推断值，可以纠正；单轮每个尺寸在原估计的0.5至2倍内，中心位移不超过原宽高较大值的一半。全几何净空、多机位预览和最终图像评审仍会验证。没有此类改动时省略字段。';
