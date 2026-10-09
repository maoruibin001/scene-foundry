export const RANGE={positiveMin:.001,max:100,segmentsMin:3,segmentsMax:64,uvMin:.01,profileMax:128,gridMax:1024,scatterMax:2048};
export const CAMERA_FOV={min:.3,max:2.2};
export const coordinateVectorSchema=()=>({type:'array',items:{type:'number',minimum:-RANGE.max,maximum:RANGE.max},minItems:3,maxItems:3});
/** Keep invalid coordinates visible to the caller; never clamp or relocate geometry. */
export function vectorErrors(value:any,path:string,min=-RANGE.max,max=RANGE.max):string[]{
 if(!Array.isArray(value)||value.length!==3)return [`${path}=${JSON.stringify(value)}：需要三维向量，每项为 ${min}..${max} 的有限数值`];
 return value.flatMap((v,axis)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max?[]:[`${path}[${axis}]=${String(v)}：须为 ${min}..${max} 的有限数值`]);
}
