import {createHash} from 'node:crypto';
const hash=(value:any)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Input summaries never replace the stored geometry. Exact parts remain available through inspect_scene_parts. */
export function repairPartContext(part:any,geometryEditable=true){
 if(!part?.shape)return part;
 const out={...part};
 // Normalized parts may retain legacy parser aliases of the same shape.
 for(const key of ['geometry','extrusion','op','type','kind'])delete out[key];
 const shape=part.shape,large=JSON.stringify(shape).length>12000;
 if(geometryEditable&&!large)return out;
 const summary:any={};let omitted=false;
 for(const [key,value] of Object.entries(shape)){
  if(Array.isArray(value)&&(key==='points'||JSON.stringify(value).length>1024)){
   omitted=true;summary[key==='points'?'pointCount':key+'Count']=value.length;summary[key+'Omitted']=true;
   if(key==='points'&&value.length&&value.every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite)))summary.pointBounds={min:[0,1,2].map(k=>value.reduce((n,p)=>Math.min(n,p[k]),Infinity)),max:[0,1,2].map(k=>value.reduce((n,p)=>Math.max(n,p[k]),-Infinity))};
  }else summary[key]=value;
 }
 if(omitted){out.shape=summary;out.sourcePartSha256=hash(part);out.geometryReadRequired=geometryEditable;}
 return out;
}
