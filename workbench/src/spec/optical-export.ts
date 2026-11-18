import {triangleDistanceSquared} from '../geometry/contacts';
import type {SceneSpec,SpecLight,Vec3} from './schema';
export type OpticalMesh={id:string;positions:Float32Array;indices:Uint16Array|Uint32Array;min:Vec3;max:Vec3};
const dot=(a:number[],b:number[])=>a.reduce((s,v,k)=>s+v*b[k],0);
const sub=(a:number[],b:number[])=>a.map((v,k)=>v-b[k]);
export const boundsDistanceSquared=(p:number[],m:{min:number[];max:number[]})=>p.reduce((s,v,k)=>s+Math.max(m.min[k]-v,0,v-m.max[k])**2,0);
export function transformedOpticalMesh(entity:any,asset:any):OpticalMesh{
 const a=asset.attributes.position,q=entity.quat,[x,y,z,w]=q,s=entity.scale,p=entity.pos,positions=new Float32Array(a.length),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 for(let i=0;i<a.length;i+=3){const vx=a[i]*s[0],vy=a[i+1]*s[1],vz=a[i+2]*s[2],tx=2*(y*vz-z*vy),ty=2*(z*vx-x*vz),tz=2*(x*vy-y*vx),v=[p[0]+vx+w*tx+y*tz-z*ty,p[1]+vy+w*ty+z*tx-x*tz,p[2]+vz+w*tz+x*ty-y*tx];for(let k=0;k<3;k++){positions[i+k]=v[k];min[k]=Math.min(min[k],v[k]);max[k]=Math.max(max[k],v[k]);}}
 return {id:entity.id,positions,indices:asset.indices,min:min as Vec3,max:max as Vec3};
}
/** Triangle surfaces, not occupied AABBs: enclosing room shells contain empty space. */
export function surfaceClearance(point:Vec3,meshes:OpticalMesh[]){
 let best=Infinity,meshId:string|null=null;
 const ordered=[...meshes].sort((a,b)=>boundsDistanceSquared(point,a)-boundsDistanceSquared(point,b));
 for(const mesh of ordered){if(boundsDistanceSquared(point,mesh)>=best)continue;const p=mesh.positions,idx=mesh.indices;
  for(let i=0;i<idx.length;i+=3){const a=idx[i]*3,b=idx[i+1]*3,c=idx[i+2]*3;const minD=point.reduce((s,v,k)=>s+Math.max(Math.min(p[a+k],p[b+k],p[c+k])-v,0,v-Math.max(p[a+k],p[b+k],p[c+k]))**2,0);if(minD>=best)continue;
   const d=triangleDistanceSquared(point,[p[a],p[a+1],p[a+2]],[p[b],p[b+1],p[b+2]],[p[c],p[c+1],p[c+2]]);if(d<best){best=d;meshId=mesh.id;}
  }
 }
 return {clearanceMeters:Math.sqrt(best),nearestMesh:meshId};
}
/** Use authored inspection-camera positions, avoiding an unvalidated solid subject center. */
export function placeReflectionProbe(candidates:Vec3[],meshes:OpticalMesh[]){
 const checked=candidates.map(position=>({position,...surfaceClearance(position,meshes)}));
 const chosen=checked.filter(c=>Number.isFinite(c.clearanceMeters)&&c.clearanceMeters>=.25).sort((a,b)=>b.clearanceMeters-a.clearanceMeters)[0];
 if(!chosen)throw Error('REFLECTION_PROBE_CLEARANCE_UNVERIFIED：没有具备25厘米表面净空的检查机位');
 return {...chosen,method:'maximum-triangle-surface-clearance-at-authored-camera',minimumClearanceMeters:.25,candidates:checked};
}
/** Protect opaque receivers in the actual spot cone. Bounds contribute conservative
 * support points; mesh vertices also cover enclosing meshes whose AABB contains the light.
 * This sampled/conservative export bound is not a proof of every triangle or final exposure. */
export function boundSpotIlluminance(light:SpecLight,target:Vec3,meshes:OpticalMesh[],limitLux=220){
 if(light.kind!=='spot'||!light.position||!light.direction)return {light,audit:null};
 const pos=[light.position[0],light.position[2],-light.position[1]],direction=[light.direction[0],light.direction[2],-light.direction[1]],len=Math.hypot(...direction),unit=direction.map(v=>v/len),cos=Math.cos((light.outerConeDeg??30)*Math.PI/180);
 let distance=Infinity,receiver:string|null=null,point:number[]|null=null,source:string|null=null;
 const consider=(p:number[],id:string,kind:string)=>{const d=sub(p,pos),r=Math.hypot(...d);if(r<1||r>=distance||r>=(light.range??20)||dot(d,unit)/r<cos)return;distance=r;receiver=id;point=p;source=kind;};
 for(const mesh of meshes){consider(pos.map((v,k)=>Math.max(mesh.min[k],Math.min(mesh.max[k],v))),mesh.id,'conservative-receiver-bounds');const p=mesh.positions;for(let i=0;i<p.length;i+=3)consider([p[i],p[i+1],p[i+2]],mesh.id,'actual-receiver-vertex');}
 if(!receiver)return {light,audit:null};
 const candela=Math.min(light.intensity,limitLux*distance**2),audit={light:light.id,receiver,point,referenceTarget:target,method:'in-cone-surface-vertices-and-conservative-bounds',distanceEvidence:source,requestedCandela:light.intensity,resolvedCandela:candela,nearestReceiverDistance:distance,unoccludedLuxBefore:light.intensity/distance**2,unoccludedLuxAfter:candela/distance**2,limitLux,changed:candela<light.intensity,scope:'nominal bound at recorded sampled/conservative receiver; not proof of all surfaces, shadows, range fade or final visual exposure'};
 return {light:{...light,intensity:candela},audit};
}
