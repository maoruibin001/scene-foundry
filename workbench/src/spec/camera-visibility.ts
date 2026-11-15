/** Camera clearance against actual opaque triangles, including instanced/rotated meshes.
 * Only the delivered camera is adjusted; objects, target, FOV and source input stay intact.
 */
import {getCachedMeshAsset,toEnginePosition,type ExportPlan} from './export-pack';
import type {SceneSpec,Vec3} from './schema';
type Triangle={p:number[];id:string};
type Node={lo:number[];hi:number[];items?:Triangle[];children?:Node[]};
const sub=(a:number[],b:number[])=>a.map((v,k)=>v-b[k]);
const dot=(a:number[],b:number[])=>a.reduce((s,v,k)=>s+v*b[k],0);
const cross=(a:number[],b:number[])=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=(v:number[])=>{const d=Math.hypot(...v)||1;return v.map(x=>x/d);};
function tree(items:Triangle[]):Node{
 const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
 for(const t of items)for(let i=0;i<9;i++){const k=i%3;lo[k]=Math.min(lo[k],t.p[i]);hi[k]=Math.max(hi[k],t.p[i]);}
 if(items.length<=16)return {lo,hi,items};
 const axis=hi.map((x,k)=>x-lo[k]).indexOf(Math.max(...hi.map((x,k)=>x-lo[k])));
 items.sort((a,b)=>(a.p[axis]+a.p[axis+3]+a.p[axis+6])-(b.p[axis]+b.p[axis+3]+b.p[axis+6]));
 const mid=items.length>>1;return {lo,hi,children:[tree(items.slice(0,mid)),tree(items.slice(mid))]};
}
function box(n:Node,o:number[],d:number[],limit:number){
 let a=0,b=limit;for(let k=0;k<3;k++){if(Math.abs(d[k])<1e-10){if(o[k]<n.lo[k]||o[k]>n.hi[k])return false;continue;}
  const x=(n.lo[k]-o[k])/d[k],y=(n.hi[k]-o[k])/d[k];a=Math.max(a,Math.min(x,y));b=Math.min(b,Math.max(x,y));if(a>b)return false;}return true;
}
function triangle(t:Triangle,o:number[],d:number[],limit:number){
 const a=t.p.slice(0,3),e1=sub(t.p.slice(3,6),a),e2=sub(t.p.slice(6,9),a),p=cross(d,e2),det=dot(e1,p);if(Math.abs(det)<1e-9)return null;
 const s=sub(o,a),u=dot(s,p)/det;if(u<0||u>1)return null;const q=cross(s,e1),v=dot(d,q)/det;if(v<0||u+v>1)return null;
 const distance=dot(e2,q)/det;return distance>.02&&distance<limit?distance:null;
}
export function firstOpaqueHit(root:Node,o:number[],target:number[],limitFraction=1):{id:string;distance:number}|null{
 const diff=sub(target,o),len=Math.hypot(...diff),d=unit(diff);let limit=len*limitFraction,result:null|{id:string;distance:number}=null;
 const visit=(n:Node)=>{if(!box(n,o,d,limit))return;for(const t of n.items??[]){const distance=triangle(t,o,d,limit);if(distance!==null){limit=distance;result={id:t.id,distance};}}for(const c of n.children??[])visit(c);};visit(root);return result;
}
/** Per-object crossing parity rejects origins inside closed opaque volumes. Shared
 * triangle edges are deduplicated by distance; a skew ray avoids axis seams. */
function containingOpaqueVolumes(root:Node,origin:number[],limit:number){
 const d=unit([.8123,.1732,.5568]),hits=new Map<string,number[]>();
 const visit=(n:Node)=>{if(!box(n,origin,d,limit))return;for(const t of n.items??[]){const v=triangle(t,origin,d,limit);if(v!==null){const h=hits.get(t.id)??[];h.push(v);hits.set(t.id,h);}}for(const c of n.children??[])visit(c);};visit(root);
 return [...hits].filter(([,h])=>h.sort((a,b)=>a-b).filter((v,i,a)=>i===0||v-a[i-1]>.001).length%2===1).map(([id])=>id);
}
export function opaqueSceneTree(plan:ExportPlan){
 const triangles:Triangle[]=[];
 for(const e of plan.entities){const mesh=plan.meshes.find(m=>m.key===e.mesh)!,asset=getCachedMeshAsset(mesh);if(!asset)throw Error('CAMERA_GEOMETRY_MISSING '+e.id);
  const positions=(asset.attributes as any)?.position;if(!positions)throw Error('CAMERA_POSITIONS_MISSING '+e.id);
  const [qx,qy,qz,qw]=e.quat,points=new Float32Array(positions.length);
  for(let i=0;i<positions.length;i+=3){const x=positions[i]*e.scale[0],y=positions[i+1]*e.scale[1],z=positions[i+2]*e.scale[2],tx=2*(qy*z-qz*y),ty=2*(qz*x-qx*z),tz=2*(qx*y-qy*x);
   points[i]=x+qw*tx+qy*tz-qz*ty+e.pos[0];points[i+1]=y+qw*ty+qz*tx-qx*tz+e.pos[1];points[i+2]=z+qw*tz+qx*ty-qy*tx+e.pos[2];}
  for(const s of asset.submeshes as any[]){const slot=asset.materialSlots?.[s.materialSlot]?.slotName,key=mesh.slots[slot],material=plan.materials.find(m=>m.key===key)?.options;
   if((material?.transmission as number)>0||(material?.baseColor as number[])?.[3]<.65||material?.renderState)continue;
   for(let k=s.indexOffset;k<s.indexOffset+s.indexCount;k+=3){const p=[];for(let j=0;j<3;j++){const idx=asset.indices[k+j]*3;p.push(points[idx],points[idx+1],points[idx+2]);}triangles.push({p,id:e.id});}}
 }
 return tree(triangles);
}
export function resolveCameraVisibility(spec:SceneSpec,plan:ExportPlan){
 const root=opaqueSceneTree(plan),result=structuredClone(spec),span=Math.max(...spec.bounds.max.map((v,k)=>v-spec.bounds.min[k])),maxMove=Math.min(6,Math.max(1,span*.1));
 const audit:any[]=[];
 for(const shot of result.shots){const start=toEnginePosition(shot.position),target=toEnginePosition(shot.target),forward=unit(sub(target,start)),right=unit(cross(forward,[0,1,0])),up=unit(cross(right,forward));
  // A target inside a subject must be visible up to that subject's surface, not merely
  // through an arbitrary first fraction of the ray. Large enclosing rooms lose to
  // the smallest containing mesh envelope; no case IDs or semantic name rules.
  const enclosing=plan.entities.flatMap(e=>{const m=plan.meshes.find(m=>m.key===e.mesh)!,a=m.aabb,[x,y,z,w]=e.quat,lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
   for(let mask=0;mask<8;mask++){const p=[0,1,2].map(k=>a[k+((mask>>k)&1)*3]*e.scale[k]),t=cross([x,y,z],p).map(v=>v*2),q=p.map((v,k)=>v+w*t[k]+cross([x,y,z],t)[k]+e.pos[k]);for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],q[k]);hi[k]=Math.max(hi[k],q[k]);}}
   return target.every((v,k)=>v>=lo[k]-.01&&v<=hi[k]+.01)?[{id:e.id,volume:hi.reduce((v,n,k)=>v*(n-lo[k]),1)}]:[];
  }).sort((a,b)=>a.volume-b.volume);const subject=enclosing[0]?.id;
  const distance=Math.hypot(...sub(target,start)),halfHeight=distance*Math.tan(shot.fovDeg*Math.PI/360),radius=Math.min(4,halfHeight*.32);
  const evaluate=(p:number[])=>{const hits=[];let visible=0;for(const u of [-1,-.5,0,.5,1])for(const v of [-1,-.5,0,.5,1]){
   const aim=target.map((x,k)=>x+right[k]*u*radius+up[k]*v*radius),hit=firstOpaqueHit(root,p,aim,subject?1:.9);if(hit&&hit.id!==subject)hits.push(hit);else visible++;}
   let foregroundClear=0;for(const u of [-.8,-.4,0,.4,.8])for(const v of [-.65,0,.65]){const aim=target.map((x,k)=>x+right[k]*u*halfHeight*16/9+up[k]*v*halfHeight);if(!firstOpaqueHit(root,p,aim,.18))foregroundClear++;}
   return {visible,foregroundClear,blocked:hits,score:visible*100+foregroundClear*10};};
  const before=evaluate(start);let position=start,best=before,shift=0;
  if(before.visible<23||before.foregroundClear<12)for(const z of [0,.25,.5,.75,1,-.25,-.5])for(const x of [0,-.25,.25,-.5,.5,-1,1])for(const f of [0,.25,.5]){
   const p=start.map((v,k)=>v+right[k]*x*maxMove+up[k]*z*maxMove+forward[k]*f*maxMove),m=Math.hypot(...sub(p,start));if(m>maxMove)continue;
   const source=[p[0],-p[2],p[1]];if(source.some((v,k)=>v<spec.bounds.min[k]+.3||v>spec.bounds.max[k]-.3))continue;
   const q=evaluate(p);if(q.score>best.score||(q.score===best.score&&m<shift)){position=p;best=q;shift=m;}}
  shot.position=[position[0],-position[2],position[1]] as Vec3;
  audit.push({id:shot.id,subject,sourcePosition:spec.shots.find(s=>s.id===shot.id)!.position,effectivePosition:shot.position,target:shot.target,fovDeg:shot.fovDeg,before,after:best,shiftMeters:shift,basis:shift?'design_fill':'source',passed:best.visible>=23&&best.foregroundClear>=12});
 }
 const probe=resolveReflectionPlacement(result,root);if(probe)for(const s of result.lighting.states)if(s.post.reflectionProbe)s.post.reflectionProbe.position=probe.effectivePosition;
 return {spec:result,receipt:{version:'mesh-camera-visibility-v2',method:'25 target-region first-hit subject rays +15 frame foreground rays(first18%); opaque triangles; bounded local camera search',maxMove,decisions:audit,reflectionProbe:probe}};
}
/** Probe origin needs open capture space, rather than the arbitrary center of a hero mesh. */
export function resolveReflectionPlacement(spec:SceneSpec,root:Node){
 if(!spec.lighting.states.some(s=>s.post.reflectionProbe))return null;
 const lo=spec.bounds.min,hi=spec.bounds.max,center=lo.map((v,k)=>(v+hi[k])/2) as Vec3,limit=Math.min(12,Math.max(...hi.map((v,k)=>v-lo[k]))*.4);
 const directions=[];for(const x of [-1,0,1])for(const y of [-1,0,1])for(const z of [-1,0,1])if(x||y||z)directions.push(unit([x,y,z]));
 const clearance=(position:number[])=>{const origin=toEnginePosition(position as Vec3);if(containingOpaqueVolumes(root,origin,Math.hypot(...hi.map((v,k)=>v-lo[k]))*2).length)return 0;return Math.min(...directions.map(d=>firstOpaqueHit(root,origin,origin.map((v,k)=>v+d[k]*limit))?.distance??limit));};
 const before=clearance(center);let position=center,best=before,score=before;
 if(before<1)for(const x of [.25,.5,.75])for(const y of [.25,.5,.75])for(const z of [.25,.5,.75]){
  const p=lo.map((v,k)=>v+(hi[k]-v)*[x,y,z][k]) as Vec3,q=clearance(p),s=q-Math.hypot(...sub(p,center))*.02;if(s>score){position=p;best=q;score=s;}}
 return {sourcePosition:center,effectivePosition:position,beforeClearanceMeters:before,afterClearanceMeters:best,samples:directions.length,basis:position===center?'source':'design_fill',passed:best>=1};
}
