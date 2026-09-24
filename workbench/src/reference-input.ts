/** 图片顺序是输入身份的一部分，重试、重建和评测必须完整保留。 */
export function referenceImageIds(input:any):string[]{
 const ids=input.imageIds??(input.images?input.images.map((i:any)=>i.id):input.image?.id?[input.image.id]:input.imageId?[input.imageId]:[]);
 if(!Array.isArray(ids)||ids.length>5||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id)))throw Error('参考图需要 0–5 张不同图片，且图片 ID 必须有效');
 return [...ids];
}
export function generationInput(record:any){return {prompt:record.prompt??'',imageIds:referenceImageIds(record),complexity:record.complexity,...(record.baselineId?{baselineId:record.baselineId}:{})};}
export function batchCase(id:string,parsed:any){return {id,...generationInput(parsed),mode:parsed.mode};}
