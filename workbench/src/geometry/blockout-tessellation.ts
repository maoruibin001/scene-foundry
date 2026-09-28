import {shapeTriangles} from './program';

/** A clay space check needs silhouette, not final surface tessellation. Keep
 * instances, parts, poses, profiles, sizes and openings; only cap subdivisions.
 * Detailed production assets never enter this function.
 */
export function limitBlockoutTessellation(input:any){
 const value=structuredClone(input),adjustments:any[]=[];
 for(const t of value?.templates??[])for(const p of t.parts??[]){
  const s=p.shape;shapeTriangles(s); // Invalid data still fails instead of being clamped into validity.
  const cap=s.type==='cushion'?8:['lathe','shell'].includes(s.type)?16:s.type==='tube'?12:null;
  if(cap&&s.segments>cap){adjustments.push({templateId:t.id,partId:p.id,field:'segments',before:s.segments,after:cap});s.segments=cap;}
  if(s.type==='cloth')for(const field of ['rows','columns'])if(s[field]>12){adjustments.push({templateId:t.id,partId:p.id,field,before:s[field],after:12});s[field]=12;}
 }
 return {value,adjustments};
}
