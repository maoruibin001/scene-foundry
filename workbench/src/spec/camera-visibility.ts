/** Camera clearance against actual opaque and translucent triangles, including instanced/rotated meshes.
 * Only the delivered camera and open-space reflection probe origin are adjusted; objects, target, FOV and source input stay intact.
 */
import {getCachedMeshAsset,toEnginePosition,type ExportPlan} from './export-pack';
import type {SceneSpec,Vec3} from './schema';

type Triangle={p:Float64Array;id:string};
type Node={lo:[number,number,number];hi:[number,number,number];items?:Triangle[];children?:[Node,Node]};

const sub=(a:readonly number[],b:readonly number[])=>[a[0]!-b[0]!,a[1]!-b[1]!,a[2]!-b[2]!];
const cross=(a:readonly number[],b:readonly number[])=>[a[1]!*b[2]!-a[2]!*b[1]!,a[2]!*b[0]!-a[0]!*b[2]!,a[0]!*b[1]!-a[1]!*b[0]!];
const unit=(v:readonly number[])=>{const d=Math.hypot(v[0]!,v[1]!,v[2]!)||1;return [v[0]!/d,v[1]!/d,v[2]!/d];};

function tree(items:Triangle[]):Node{
 let lx=Infinity,ly=Infinity,lz=Infinity,hx=-Infinity,hy=-Infinity,hz=-Infinity;
 for(let m=0;m<items.length;m++){
  const p=items[m]!.p;
  for(let i=0;i<9;i+=3){
   const x=p[i]!,y=p[i+1]!,z=p[i+2]!;
   if(x<lx)lx=x;if(x>hx)hx=x;
   if(y<ly)ly=y;if(y>hy)hy=y;
   if(z<lz)lz=z;if(z>hz)hz=z;
  }
 }
 if(!items.length)return {lo:[0,0,0],hi:[0,0,0],items};
 const lo:[number,number,number]=[lx,ly,lz],hi:[number,number,number]=[hx,hy,hz];
 if(items.length<=12)return {lo,hi,items};
 const sx=hx-lx,sy=hy-ly,sz=hz-lz,axis=sx>=sy&&sx>=sz?0:sy>=sz?1:2;
 items.sort((a,b)=>(a.p[axis]!+a.p[axis+3]!+a.p[axis+6]!)-(b.p[axis]!+b.p[axis+3]!+b.p[axis+6]!));
 const mid=items.length>>1;
 return {lo,hi,children:[tree(items.slice(0,mid)),tree(items.slice(mid))]};
}

function hitBox(n:Node,ox:number,oy:number,oz:number,dx:number,dy:number,dz:number,limit:number):boolean{
 let a=0,b=limit;
 const {lo,hi}=n;
 if(Math.abs(dx)<1e-10){if(ox<lo[0]||ox>hi[0])return false;}
 else{const x=(lo[0]-ox)/dx,y=(hi[0]-ox)/dx,mn=x<y?x:y,mx=x>y?x:y;if(mn>a)a=mn;if(mx<b)b=mx;if(a>b)return false;}
 if(Math.abs(dy)<1e-10){if(oy<lo[1]||oy>hi[1])return false;}
 else{const x=(lo[1]-oy)/dy,y=(hi[1]-oy)/dy,mn=x<y?x:y,mx=x>y?x:y;if(mn>a)a=mn;if(mx<b)b=mx;if(a>b)return false;}
 if(Math.abs(dz)<1e-10){if(oz<lo[2]||oz>hi[2])return false;}
 else{const x=(lo[2]-oz)/dz,y=(hi[2]-oz)/dz,mn=x<y?x:y,mx=x>y?x:y;if(mn>a)a=mn;if(mx<b)b=mx;if(a>b)return false;}
 return true;
}

function hitTriangle(p:Float64Array,ox:number,oy:number,oz:number,dx:number,dy:number,dz:number,limit:number):number{
 const ax=p[0]!,ay=p[1]!,az=p[2]!;
 const e1x=p[3]!-ax,e1y=p[4]!-ay,e1z=p[5]!-az;
 const e2x=p[6]!-ax,e2y=p[7]!-ay,e2z=p[8]!-az;
 const px=dy*e2z-dz*e2y,py=dz*e2x-dx*e2z,pz=dx*e2y-dy*e2x;
 const det=e1x*px+e1y*py+e1z*pz;
 if(det>-1e-9&&det<1e-9)return -1;
 const inv=1/det,sx=ox-ax,sy=oy-ay,sz=oz-az;
 const u=(sx*px+sy*py+sz*pz)*inv;
 if(u<0||u>1)return -1;
 const qx=sy*e1z-sz*e1y,qy=sz*e1x-sx*e1z,qz=sx*e1y-sy*e1x;
 const v=(dx*qx+dy*qy+dz*qz)*inv;
 if(v<0||u+v>1)return -1;
 const dist=(e2x*qx+e2y*qy+e2z*qz)*inv;
 return dist>.02&&dist<limit?dist:-1;
}

export function firstOpaqueHit(root:Node,o:number[],target:number[],limitFraction=1):{id:string;distance:number}|null{
 const rx=target[0]!-o[0]!,ry=target[1]!-o[1]!,rz=target[2]!-o[2]!,len=Math.hypot(rx,ry,rz);
 if(len<1e-6)return null;
 const dx=rx/len,dy=ry/len,dz=rz/len,ox=o[0]!,oy=o[1]!,oz=o[2]!;
 let limit=len*limitFraction,bestId='',found=false;
 const visit=(n:Node)=>{
  if(!hitBox(n,ox,oy,oz,dx,dy,dz,limit))return;
  const items=n.items;
  if(items){
   for(let i=0;i<items.length;i++){
    const t=items[i]!,dist=hitTriangle(t.p,ox,oy,oz,dx,dy,dz,limit);
    if(dist>0){limit=dist;bestId=t.id;found=true;}
   }
   return;
  }
  const ch=n.children;
  if(ch){visit(ch[0]);visit(ch[1]);}
 };
 visit(root);
 return found?{id:bestId,distance:limit}:null;
}

/** Per-object crossing parity rejects origins inside closed opaque volumes. Shared
 * triangle edges are deduplicated by distance; a skew ray avoids axis seams. */
function containingOpaqueVolumes(root:Node,origin:number[],limit:number){
 const [dx,dy,dz]=unit([.8123,.1732,.5568]),ox=origin[0]!,oy=origin[1]!,oz=origin[2]!;
 const hits=new Map<string,number[]>();
 const visit=(n:Node)=>{
  if(!hitBox(n,ox,oy,oz,dx!,dy!,dz!,limit))return;
  for(const t of n.items??[]){
   const v=hitTriangle(t.p,ox,oy,oz,dx!,dy!,dz!,limit);
   if(v>0){const h=hits.get(t.id)??[];h.push(v);hits.set(t.id,h);}
  }
  if(n.children){visit(n.children[0]);visit(n.children[1]);}
 };
 visit(root);
 return [...hits].filter(([,h])=>h.sort((a,b)=>a-b).filter((v,i,a)=>i===0||v-a[i-1]!>.001).length%2===1).map(([id])=>id);
}

const BOX_FACES:readonly [number,number,number][]= [
 [0,1,2],[0,2,3],[4,6,5],[4,7,6],
 [0,4,5],[0,5,1],[3,2,6],[3,6,7],
 [0,3,7],[0,7,4],[1,5,6],[1,6,2],
];

function appendProxyAabbTriangles(out:Triangle[],aabb:readonly number[],pos:readonly number[],quat:readonly number[],scale:readonly number[],id:string){
 const [x0,y0,z0,x1,y1,z1]=aabb,[qx,qy,qz,qw]=quat;
 const corners=[
  [x0!,y0!,z0!],[x1!,y0!,z0!],[x1!,y1!,z0!],[x0!,y1!,z0!],
  [x0!,y0!,z1!],[x1!,y0!,z1!],[x1!,y1!,z1!],[x0!,y1!,z1!],
 ].map(c=>{
  const x=c[0]!*scale[0]!,y=c[1]!*scale[1]!,z=c[2]!*scale[2]!;
  const tx=2*(qy!*z-qz!*y),ty=2*(qz!*x-qx!*z),tz=2*(qx!*y-qy!*x);
  return [x+qw!*tx+qy!*tz-qz!*ty+pos[0]!,y+qw!*ty+qz!*tx-qx!*tz+pos[1]!,z+qw!*tz+qx!*ty-qy!*tx+pos[2]!];
 });
 for(const [i0,i1,i2] of BOX_FACES){
  const a=corners[i0]!,b=corners[i1]!,c=corners[i2]!;
  out.push({p:new Float64Array([a[0]!,a[1]!,a[2]!,b[0]!,b[1]!,b[2]!,c[0]!,c[1]!,c[2]!]),id});
 }
}

function buildSceneTrees(plan:ExportPlan):{opaque:Node;translucent:Node}{
 const opaque:Triangle[]=[],translucent:Triangle[]=[];
 const matMap=new Map(plan.materials.map(m=>[m.key,m.options]));
 const meshMap=new Map(plan.meshes.map(m=>[m.key,m]));
 for(const e of plan.entities){
  const mesh=meshMap.get(e.mesh)!;
  if(mesh.generator==='proxy'){
   appendProxyAabbTriangles(opaque,mesh.aabb,e.pos,e.quat,e.scale,e.id);
   continue;
  }
  const asset=getCachedMeshAsset(mesh);
  if(!asset)throw Error('CAMERA_GEOMETRY_MISSING '+e.id);
  const positions=(asset.attributes as any)?.position as ArrayLike<number>|undefined;
  if(!positions)throw Error('CAMERA_POSITIONS_MISSING '+e.id);
  const [qx,qy,qz,qw]=e.quat,points=new Float32Array(positions.length);
  for(let i=0;i<positions.length;i+=3){
   const x=positions[i]!*e.scale[0]!,y=positions[i+1]!*e.scale[1]!,z=positions[i+2]!*e.scale[2]!;
   const tx=2*(qy*z-qz*y),ty=2*(qz*x-qx*z),tz=2*(qx*y-qy*x);
   points[i]=x+qw*tx+qy*tz-qz*ty+e.pos[0];
   points[i+1]=y+qw*ty+qz*tx-qx*tz+e.pos[1];
   points[i+2]=z+qw*tz+qx*ty-qy*tx+e.pos[2];
  }
  for(const s of asset.submeshes as any[]){
   const slot=asset.materialSlots?.[s.materialSlot]?.slotName,key=mesh.slots[slot],material=matMap.get(key);
   const isTrans=(material?.transmission as number)>0||((material?.baseColor as number[])?.[3]??1)<.65||Boolean(material?.renderState);
   const bucket=isTrans?translucent:opaque;
   for(let k=s.indexOffset;k<s.indexOffset+s.indexCount;k+=3){
    const i0=asset.indices[k]*3,i1=asset.indices[k+1]*3,i2=asset.indices[k+2]*3;
    bucket.push({p:new Float64Array([points[i0]!,points[i0+1]!,points[i0+2]!,points[i1]!,points[i1+1]!,points[i1+2]!,points[i2]!,points[i2+1]!,points[i2+2]!]),id:e.id});
   }
  }
 }
 return {opaque:tree(opaque),translucent:tree(translucent)};
}

export function opaqueSceneTree(plan:ExportPlan){
 return buildSceneTrees(plan).opaque;
}

const DISC_STEPS=[-0.9,-0.6,-0.3,0,0.3,0.6,0.9] as const;
const DISC_UV:readonly [number,number][]=DISC_STEPS.flatMap(u=>DISC_STEPS.filter(v=>u*u+v*v<=1.05).map(v=>[u,v] as [number,number]));

export function resolveCameraVisibility(spec:SceneSpec,plan:ExportPlan){
 const {opaque:root,translucent}=buildSceneTrees(plan),result=structuredClone(spec);
 const span=Math.max(...spec.bounds.max.map((v,k)=>v-spec.bounds.min[k])),maxMove=Math.min(7.5,Math.max(1.5,span*.14));
 const roomVol=[0,1,2].reduce((v,k)=>v*(spec.bounds.max[k]!-spec.bounds.min[k]!),1);
 const roomFootprint=(spec.bounds.max[0]!-spec.bounds.min[0]!)*(spec.bounds.max[1]!-spec.bounds.min[1]!);
 const meshMap=new Map(plan.meshes.map(m=>[m.key,m]));
 const entityBoxes=plan.entities.map(e=>{
  const a=meshMap.get(e.mesh)!.aabb,[x,y,z,w]=e.quat,lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
  for(let mask=0;mask<8;mask++){
   const p=[0,1,2].map(k=>a[k+((mask>>k)&1)*3]!*e.scale[k]!),t=cross([x,y,z],p).map(v=>v*2),q=p.map((v,k)=>v+w*t[k]!+cross([x,y,z],t)[k]!+e.pos[k]!);
   for(let k=0;k<3;k++){lo[k]=Math.min(lo[k]!,q[k]!);hi[k]=Math.max(hi[k]!,q[k]!);}
  }
  const center=lo.map((v,k)=>(v+hi[k]!)/2),maxRadius=Math.max(...hi.map((v,k)=>(v-lo[k]!)/2)),volume=hi.reduce((v,n,k)=>v*(n-lo[k]!),1);
  const footprint=(hi[0]!-lo[0]!)*(hi[2]!-lo[2]!);
  return {id:e.id,lo,hi,center,maxRadius,volume,footprint};
 });
 const roomShells=new Set(entityBoxes.filter(b=>b.footprint>roomFootprint*0.35).map(b=>b.id));

 const audit:any[]=[];
 for(const shot of result.shots){
  const start=toEnginePosition(shot.position),target=toEnginePosition(shot.target);
  const startFwd=unit(sub(target,start)),startRight=unit(cross(startFwd,[0,1,0])),startUp=unit(cross(startRight,startFwd));
  // Smallest containing non-room envelope owns the focal target; co-centered nested/ring parts
  // belong to the same hero assembly rather than being treated as external blockers.
  const enclosing=entityBoxes.filter(b=>target.every((v,k)=>v>=b.lo[k]!-.01&&v<=b.hi[k]!+.01)).sort((a,b)=>a.volume-b.volume);
  const subjBox=enclosing[0]&&enclosing[0].volume<roomVol*0.2?enclosing[0]:undefined;
  const subject=subjBox?.id;
  const subjectGroup=new Set<string>();
  if(subjBox){
   subjectGroup.add(subjBox.id);
   for(const b of entityBoxes){
    if(b.volume<roomVol*0.15&&Math.hypot(...sub(b.center,subjBox.center))<=Math.max(0.5,subjBox.maxRadius*0.35))subjectGroup.add(b.id);
   }
  }
  const subjRadius=subjBox?subjBox.maxRadius:Math.min(4,Math.hypot(...sub(target,start))*Math.tan(shot.fovDeg*Math.PI/360)*.32);
  const tanHalfY=Math.tan(shot.fovDeg*Math.PI/360),startHalfH=Math.hypot(...sub(target,start))*tanHalfY;
  const minEyeY=start[1]>=1.2?Math.max(1.2,Math.min(1.65,start[1]*0.68)):-Infinity;

  const evaluate=(p:number[],latMeters=0,shiftMeters=0)=>{
   const dist=Math.hypot(...sub(target,p)),halfHeight=dist*tanHalfY;
   const fwd=unit(sub(target,p)),right=unit(cross(fwd,[0,1,0])),up=unit(cross(right,fwd));
   const radius=Math.min(subjRadius*0.92,halfHeight*0.42);
   const hits:{id:string;distance:number}[]=[];
   let visible=0;
   for(const [u,v] of DISC_UV){
    const aim=[target[0]!+right[0]!*u*radius+up[0]!*v*radius,target[1]!+right[1]!*u*radius+up[1]!*v*radius,target[2]!+right[2]!*u*radius+up[2]!*v*radius];
    const hit=firstOpaqueHit(root,p,aim,subject?1:.9);
    if(hit&&!subjectGroup.has(hit.id))hits.push(hit);else visible++;
   }
   let foregroundClear=0,midgroundClear=0,glassClear=0;
   for(const u of [-.8,-.4,0,.4,.8])for(const v of [-.65,0,.65]){
    const aim=[target[0]!+right[0]!*u*halfHeight*(16/9)+up[0]!*v*halfHeight,target[1]!+right[1]!*u*halfHeight*(16/9)+up[1]!*v*halfHeight,target[2]!+right[2]!*u*halfHeight*(16/9)+up[2]!*v*halfHeight];
    if(!firstOpaqueHit(root,p,aim,.22))foregroundClear++;
    if(!firstOpaqueHit(translucent,p,aim,.42))glassClear++;
   }
   for(const u of [-.8,-.6,-.4,-.2,0,.2,.4,.6,.8])for(const v of [-.68,-.34,0,.34,.68]){
    const aim=[target[0]!+right[0]!*u*halfHeight*(16/9)+up[0]!*v*halfHeight,target[1]!+right[1]!*u*halfHeight*(16/9)+up[1]!*v*halfHeight,target[2]!+right[2]!*u*halfHeight*(16/9)+up[2]!*v*halfHeight];
    const hit=firstOpaqueHit(root,p,aim,.72);
    if(!hit||subjectGroup.has(hit.id)||roomShells.has(hit.id))midgroundClear++;
   }
   const score=visible*(1000/DISC_UV.length)+foregroundClear*(180/15)+midgroundClear*(160/45)+glassClear*(45/15)-Math.abs(latMeters)*4.2-shiftMeters*1.4;
   return {visible,subjectRays:DISC_UV.length,foregroundClear,midgroundClear,glassClear,blocked:hits,score:Number(score.toFixed(3))};
  };

  const before=evaluate(start,0,0);
  let position=start,best=before,shift=0;
  if(before.visible<DISC_UV.length||before.foregroundClear<14||before.midgroundClear<36||before.glassClear<13){
   for(const z of [0,.2,.4,.6,.8,1,-.2,-.35])for(const f of [0,.25,.5,.75,.95,-.2])for(const x of [0,-.2,.2,-.4,.4,-.7,.7,-1,1]){
    const latM=x*maxMove,upM=z*maxMove,fwdM=f*maxMove,m=Math.hypot(latM,upM,fwdM);
    if(m>maxMove||m===0)continue;
    const p=[start[0]!+startRight[0]!*latM+startUp[0]!*upM+startFwd[0]!*fwdM,start[1]!+startRight[1]!*latM+startUp[1]!*upM+startFwd[1]!*fwdM,start[2]!+startRight[2]!*latM+startUp[2]!*upM+startFwd[2]!*fwdM];
    if(p[1]!<minEyeY)continue;
    const dist=Math.hypot(...sub(target,p)),halfH=dist*tanHalfY;
    if(subjRadius/halfH>Math.max(0.82,subjRadius/startHalfH*1.06))continue;
    const source=[p[0]!,-p[2]!,p[1]!];
    if(source.some((v,k)=>v<spec.bounds.min[k]!+.35||v>spec.bounds.max[k]!-.35))continue;
    const q=evaluate(p,latM,m);
    if(q.score>best.score+1e-4||(Math.abs(q.score-best.score)<=1e-4&&m<shift)){position=p;best=q;shift=m;}
   }
  }
  shot.position=[position[0]!,-position[2]!,position[1]!] as Vec3;
  audit.push({id:shot.id,subject,subjectAssembly:[...subjectGroup],sourcePosition:spec.shots.find(s=>s.id===shot.id)!.position,effectivePosition:shot.position,target:shot.target,fovDeg:shot.fovDeg,before,after:best,shiftMeters:shift,basis:shift?'design_fill':'source',passed:best.visible>=Math.ceil(DISC_UV.length*.92)&&best.foregroundClear>=13&&best.midgroundClear>=34});
 }
 const probe=resolveReflectionPlacement(result,root);
 if(probe)for(const s of result.lighting.states)if(s.post.reflectionProbe)s.post.reflectionProbe.position=probe.effectivePosition;
 return {spec:result,receipt:{version:'mesh-camera-visibility-v3',method:'37 circular-disc subject rays(co-centered assembly aware) + 15 near-foreground/glass rays + 45 midground frustum rays(first72%); zero-alloc BVH; axis-preserving bounded local search',maxMove,decisions:audit,reflectionProbe:probe}};
}

/** Probe origin needs open capture space while staying as close as possible to room axes
 * so box-projected cubemap bounds stay aligned with physical walls, floor and ceiling. */
export function resolveReflectionPlacement(spec:SceneSpec,root:Node){
 if(!spec.lighting.states.some(s=>s.post.reflectionProbe))return null;
 const lo=spec.bounds.min,hi=spec.bounds.max,center=lo.map((v,k)=>(v+hi[k]!)/2) as Vec3;
 const halfSpan=lo.map((v,k)=>Math.max(.5,(hi[k]!-v)/2));
 const limit=Math.min(12,Math.max(...hi.map((v,k)=>v-lo[k]!))*.4),diag=Math.hypot(...hi.map((v,k)=>v-lo[k]!))*2;
 const targetClearance=Math.min(3.5,Math.max(1.5,limit*.32));
 const directions:number[][]=[];
 for(const x of [-1,0,1])for(const y of [-1,0,1])for(const z of [-1,0,1])if(x||y||z)directions.push(unit([x,y,z]));
 const clearance=(position:number[])=>{
  const origin=toEnginePosition(position as Vec3);
  if(containingOpaqueVolumes(root,origin,diag).length)return 0;
  return Math.min(...directions.map(d=>firstOpaqueHit(root,origin,[origin[0]!+d[0]!*limit,origin[1]!+d[1]!*limit,origin[2]!+d[2]!*limit])?.distance??limit));
 };
 const before=clearance(center);
 let position=center,best=before,bestScore=Math.min(before,targetClearance);
 if(before<1.5){
  const grid=[.5,.42,.58,.34,.66,.25,.75];
  for(const x of grid)for(const y of grid)for(const z of grid){
   const p=[lo[0]!+(hi[0]!-lo[0]!)*x,lo[1]!+(hi[1]!-lo[1]!)*y,lo[2]!+(hi[2]!-lo[2]!)*z] as Vec3;
   const q=clearance(p);
   if(q<1)continue;
   const axisShift=[0,1,2].map(k=>Math.abs(p[k]!-center[k]!)/halfSpan[k]!);
   const ecc=axisShift[0]!+axisShift[1]!+axisShift[2]!+axisShift.filter(v=>v>1e-4).length*.12;
   const s=Math.min(q,targetClearance)-ecc*2.2+Math.min(q,limit)*.01;
   if(s>bestScore+1e-6){position=p;best=q;bestScore=s;}
  }
 }
 return {sourcePosition:center,effectivePosition:position,beforeClearanceMeters:before,afterClearanceMeters:best,samples:directions.length,basis:position===center?'source':'design_fill',passed:best>=1};
}
