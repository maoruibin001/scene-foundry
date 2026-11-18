import type {SceneSpec,SpecObject} from './schema';
import {GENERATORS} from './generators';
import {bindDimensionalAliases} from './parameter-binding';
/** Generator points use local Engine +Y up. Scene positions use +Z up, fixed XYZ Euler degrees. */
export function bindingPointWorld(o:SpecObject,point:number[]){
 let [x,y,z]=[point[0]*o.transform.scale[0],-point[2]*o.transform.scale[1],point[1]*o.transform.scale[2]];
 const [rx,ry,rz]=o.transform.rotationDeg.map(d=>d*Math.PI/180);
 [y,z]=[y*Math.cos(rx)-z*Math.sin(rx),y*Math.sin(rx)+z*Math.cos(rx)];
 [x,z]=[x*Math.cos(ry)+z*Math.sin(ry),-x*Math.sin(ry)+z*Math.cos(ry)];
 [x,y]=[x*Math.cos(rz)-y*Math.sin(rz),x*Math.sin(rz)+y*Math.cos(rz)];
 return [x,y,z].map((n,k)=>n+o.transform.position[k]);
}
export function bindingGeometryIssues(spec:SceneSpec,only?:SpecObject){
 const issues:{object:string;key:string;kind:string;input:unknown;expected?:unknown;actual?:unknown}[]=[];
 for(const o of only?[only]:spec.objects){const b=o.geometryBinding;if(!b)continue;const gen=GENERATORS[b.id];if(!gen)continue;
  const adapted=bindDimensionalAliases(gen,b.params,{id:o.id,position:o.transform.position}).values;
  for(const key in b.params)if(key in gen.params&&JSON.stringify(adapted[key])!==JSON.stringify(b.params[key]))issues.push({object:o.id,key,kind:'adapter-would-change-explicit-binding',input:b.params[key],expected:adapted[key]});
  const path=b.params.path;
  if(Array.isArray(path)){for(let i=0;i<path.length;i+=3){const point=path.slice(i,i+3),world=bindingPointWorld(o,point);
   if(world.some((n,k)=>n<spec.bounds.min[k]-.02||n>spec.bounds.max[k]+.02))issues.push({object:o.id,key:'path',kind:'path-outside-source-world-bounds',input:point,actual:world,expected:spec.bounds});
   if(i>=3&&Math.hypot(...point.map((n,k)=>n-path[i-3+k]))<.001)issues.push({object:o.id,key:'path',kind:'zero-length-path-segment',input:point});
  }}
  const end=b.params.endPoint,placement=o.params.placement;
  if(Array.isArray(end)&&end.length===3&&typeof placement==='string'){
   const points=[...placement.matchAll(/\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/g)].map(m=>m.slice(1).map(Number));
   const near=(a:number[],b:number[])=>Math.hypot(...a.map((n,k)=>n-b[k]))<.02;
   if(points.length===2&&points.some(p=>near(p,o.transform.position))){const target=points.find(p=>!near(p,o.transform.position));if(target&&!near(bindingPointWorld(o,end),target))issues.push({object:o.id,key:'endPoint',kind:'endpoint-misses-explicit-placement-pair',input:end,actual:bindingPointWorld(o,end),expected:target});}
  }
 }
 return issues;
}
