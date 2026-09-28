import {shapeTriangles} from './program';

/** Clay only: untangle proper edge crossings without inventing or moving vertices.
 * Each 2-opt reversal shortens the perimeter. Touching/degenerate edges are not
 * guessed at; the ordinary geometry validator must still accept every result.
 */
export function repairBlockoutContours(input:any){
 const value=structuredClone(input),repairs:any[]=[];
 const cross=(a:number[],b:number[],c:number[])=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
 for(const template of value?.templates??[])for(const part of template.parts??[]){
  const shape=part.shape;
  if(shape?.type!=='extrusion'||!Array.isArray(shape.outline))continue;
  let problem:string;
  try{shapeTriangles(shape);continue;}catch(error){problem=String(error);}
  if(!problem.includes('轮廓自交'))continue;
  const original=structuredClone(shape.outline),points=shape.outline,n=points.length;
  let reversals=0,done=false;
  for(let step=0;step<n*n;step++){
   let crossing:number[]|null=null;
   for(let i=0;i<n&&!crossing;i++)for(let j=i+2;j<n;j++){
    if(i===0&&j===n-1)continue;
    const a=points[i],b=points[(i+1)%n],c=points[j],d=points[(j+1)%n];
    if(cross(a,b,c)*cross(a,b,d)<-1e-18&&cross(c,d,a)*cross(c,d,b)<-1e-18){crossing=[i,j];break;}
   }
   if(!crossing){done=true;break;}
   const [i,j]=crossing;points.splice(i+1,j-i,...points.slice(i+1,j+1).reverse());reversals++;
  }
  if(!done||!reversals){shape.outline=original;continue;}
  try{shapeTriangles(shape);}catch{shape.outline=original;continue;}
  repairs.push({templateId:template.id,partId:part.id,operation:'uncross-graybox-edges-v1',reversals,original,repaired:structuredClone(points),verticesUnchanged:true});
 }
 return {value,repairs};
}
