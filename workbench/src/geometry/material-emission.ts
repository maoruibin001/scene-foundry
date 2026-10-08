/** Linear surface emission is separate from lights illuminating neighbouring geometry. */
export type MaterialEmission={color:[number,number,number];intensity:number};
export const EMISSION_MAX_INTENSITY=8;
const finite=(n:unknown,min:number,max:number)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
export function validateMaterialEmission(value:unknown):asserts value is MaterialEmission|null|undefined{
 if(value==null)return;
 const v=value as MaterialEmission;
 if(typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!['color','intensity'].includes(k))||!Array.isArray(v.color)||v.color.length!==3||!v.color.every(n=>finite(n,0,1))||!finite(v.intensity,0,EMISSION_MAX_INTENSITY))throw Error('材质 emission 必须为 null，或线性 RGB color 0..1 与 intensity 0..'+EMISSION_MAX_INTENSITY+'；不接受路径或未知字段');
}
export function materialEmissionSchema(){return {anyOf:[{type:'null'},{type:'object',properties:{color:{type:'array',items:{type:'number',minimum:0,maximum:1},minItems:3,maxItems:3},intensity:{type:'number',minimum:0,maximum:EMISSION_MAX_INTENSITY}},required:['color','intensity'],additionalProperties:false}]};}
export function emissionSurface(value?:MaterialEmission|null){
 validateMaterialEmission(value);
 return value==null?{}:{emissive:[...value.color],emissiveIntensity:value.intensity};
}
export const MATERIAL_EMISSION_GUIDANCE=`材质 emission 为 null 表示普通受光表面；有原图依据的发光表面可声明 {color:[线性R,G,B],intensity:0..${EMISSION_MAX_INTENSITY}}。该值独立于 color、roughness、metallic 与程序/照片通道，使用 Engine 的 emissive/emissiveIntensity 表达表面自身可见亮度，不会照亮桌面、墙或其他物体，不产生全局间接光、泛光或真实灯罩散射。需照亮邻近表面时仍须配置有实际位置的 points/spots，并在真实预览中同时核对发光表面和落光区域；两者分别控制，不能以把灯罩照得溢白代替桌面受光。只用于有证据的灯芯、灯罩或指示面，保留结构与明暗；普通石木不可用自发光掩盖材质或照明缺陷，无依据填 null。`;
