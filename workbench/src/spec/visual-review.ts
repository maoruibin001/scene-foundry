/** Visual conclusions require actual per-image observations. Unavailable evidence has no score. */
export const VISUAL_REVIEW_VERSION='spec-style-judge-v2';
export const STYLE_DIMENSIONS=['lighting','material','atmosphere','composition','subject','density'];
/** Preserve supplied reference order; captions and case names do not select the target. */
export function visualReferences<T>(images:readonly T[]):T[]{
 if(!images.length)throw Error('VISUAL_REFERENCE_MISSING：没有风格参考图，不能判定还原分数');
 return [...images];
}
const dim={type:'object',additionalProperties:false,required:['id','score','reason'],properties:{id:{type:'string',enum:STYLE_DIMENSIONS},score:{type:'number',minimum:0,maximum:5},reason:{type:'string'}}};
export const VISUAL_SCHEMA={type:'object',additionalProperties:false,required:['evidence','overall','verdict','dimensions','strengths','issues','summary'],properties:{
 evidence:{type:'object',additionalProperties:false,required:['status','observations','reason'],properties:{status:{type:'string',enum:['visible','unavailable']},observations:{type:'array',items:{type:'object',additionalProperties:false,required:['imageIndex','description'],properties:{imageIndex:{type:'integer',minimum:0},description:{type:'string'}}}},reason:{type:'string'}}},
 overall:{anyOf:[{type:'number',minimum:0,maximum:100},{type:'null'}]},verdict:{type:'string',enum:['match','partial','mismatch','unavailable']},dimensions:{type:'array',maxItems:6,items:dim},strengths:{type:'array',items:{type:'string'},maxItems:8},issues:{type:'array',items:{type:'string'},maxItems:8},summary:{type:'string'}}};
export function verifiedVisualReview(value:any,imageCount:number){
 const indices=value?.evidence?.observations?.map((o:any)=>o.imageIndex)??[];
 const missing=/像素.{0,8}(不可见|未提供)|无法.{0,5}(查看|看到).{0,8}(图像|图片|画面)|(?:cannot|can't|unable to) (?:see|view|access) (?:the )?(?:images?|pixels?)/i;
 const denial=missing.test(JSON.stringify([value?.summary,value?.issues,value?.dimensions]));
 if(value?.evidence?.status!=='visible'||value?.verdict==='unavailable'||denial||imageCount<1||indices.length!==imageCount||new Set(indices).size!==imageCount||indices.some((i:number)=>!Number.isInteger(i)||i<0||i>=imageCount)||value.evidence.observations.some((o:any)=>typeof o.description!=='string'||o.description.trim().length<8))throw Error('VISUAL_EVIDENCE_UNAVAILABLE：评审未确认逐张实际画面，分数不予采纳');
 if(typeof value.overall!=='number'||!Number.isFinite(value.overall)||value.overall<0||value.overall>100||!['match','partial','mismatch'].includes(value.verdict)||value.dimensions?.length!==6||new Set(value.dimensions.map((d:any)=>d.id)).size!==6||value.dimensions.some((d:any)=>!STYLE_DIMENSIONS.includes(d.id)||!Number.isFinite(d.score)||d.score<0||d.score>5))throw Error('VISUAL_REVIEW_INVALID：六维评分不完整');
 return {...value,version:VISUAL_REVIEW_VERSION};
}
