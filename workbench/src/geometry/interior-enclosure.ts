import {compileGeometryProgram} from './program';
import {rasterVisibility} from './visibility';
import {basis,rayScene} from './camera-fit';

export const INTERIOR_ENCLOSURE='interior-enclosure-v1';
/** New ordinary jobs close an interior's missing side walls before the graybox is judged; older jobs keep their space unchanged. */
export function interiorEnclosureRule(job:any){return job?.grayboxEnclosurePolicy===INTERIOR_ENCLOSURE;}
/**
 * Workshop 64ed7618 (2026-10-21): the plan modelled only the two walls the reference shows; the inspection camera looking back saw 22.4%
 * void against 5–7% (window openings) for every closed room, and three re-judges on identical frames all failed S13 on the open side.
 * Graybox repair cannot add instances, so the side stayed open. Only void regions that reach the left, right or bottom frame edge count:
 * a window or door is a hole the wall surrounds. Workshops c37f345e and c7ebfc44 failed S13 on "右缘围护缺口"/"右侧白空区" with 2.3% and
 * 7.3% of a frame in such regions, while closed rooms showed 0–1.4%. A side face takes a wall when a camera's edge void reaches edgeLimit
 * and at least faceShare of its pixels leave through that face; a face an existing wall already spans is skipped.
 */
export const ENCLOSURE_LIMITS={edgeLimit:.02,faceShare:.01,wallReach:.6,wallCover:.5,roofDistance:30,roofShare:.5,spanCap:60,width:96,height:54};
type V=number[];
const meshesOf=(scene:any)=>compileGeometryProgram({...scene.program,materials:scene.program.materials.map((m:any)=>({...m,textureId:null,surfaceDetail:null}))}).meshes;
const rotate=(r:V,p:V)=>{let [x,y,z]=p;const [a,b,c]=r;[y,z]=[y*Math.cos(a)-z*Math.sin(a),y*Math.sin(a)+z*Math.cos(a)];[x,z]=[x*Math.cos(b)+z*Math.sin(b),-x*Math.sin(b)+z*Math.cos(b)];[x,y]=[x*Math.cos(c)-y*Math.sin(c),x*Math.sin(c)+y*Math.cos(c)];return [x,y,z];};

/** Room box from geometry no larger than spanCap per axis, so a sky dome or terrain sheet cannot become the room. */
// One box per instance: a wall with windows is short sills, lintels and piers part by part, but one face-wide instance (workshop 02d102b2).
function meshBoxes(meshes:any[]){
 const byInstance=new Map<string,{lo:V;hi:V}>();
 for(const m of meshes){const id=String(m.name).split('__')[0],p=m.geometry.positions,b=byInstance.get(id)??{lo:[Infinity,Infinity,Infinity],hi:[-Infinity,-Infinity,-Infinity]};
  for(let i=0;i<p.length;i++){b.lo[i%3]=Math.min(b.lo[i%3],p[i]);b.hi[i%3]=Math.max(b.hi[i%3],p[i]);}byInstance.set(id,b);}
 return [...byInstance.values()].filter(b=>b.hi.every((v,k)=>v-b.lo[k]<=ENCLOSURE_LIMITS.spanCap));
}
function roomBox(boxes:{lo:V;hi:V}[]){
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 for(const b of boxes)for(let k=0;k<3;k++){min[k]=Math.min(min[k],b.lo[k]);max[k]=Math.max(max[k],b.hi[k]);}
 return {min,max};
}
/** Share of a side face's width spanned by tall geometry lying on its plane. */
function faceCover(face:string,boxes:{lo:V;hi:V}[],box:{min:V;max:V}){
 const axis=face[1]==='x'?0:1,tangent=1-axis,plane=face[0]==='+'?box.max[axis]:box.min[axis],height=box.max[2]-box.min[2],reach=ENCLOSURE_LIMITS.wallReach;
 const spans=boxes.filter(b=>b.lo[axis]<=plane+reach&&b.hi[axis]>=plane-reach&&b.hi[2]-b.lo[2]>=.5*height&&b.hi[axis]-b.lo[axis]<=2*reach).map(b=>[b.lo[tangent],b.hi[tangent]]).sort((a,b)=>a[0]-b[0]);
 let covered=0,end=-Infinity;for(const [a,b] of spans){const lo=Math.max(a,end);if(b>lo)covered+=b-lo;end=Math.max(end,b);}
 return covered/(box.max[tangent]-box.min[tangent]);
}
/** Void share of every camera and the side face each void ray leaves the room box through. */
export function enclosureVoids(scene:any){
 const meshes=meshesOf(scene),boxes=meshBoxes(meshes),box=roomBox(boxes),cast=rayScene(meshes,{near:.1,far:2000,doubleSided:true});
 // A roof of beams or slats lets a single zenith ray through (workshop c37f345e); a cone from every camera reads the cover instead.
 const cone=[[0,0,1],...Array.from({length:12},(_,n)=>{const a=n*Math.PI/6,tilt=20*Math.PI/180;return [Math.sin(tilt)*Math.cos(a),Math.sin(tilt)*Math.sin(a),Math.cos(tilt)];})];
 const shots=scene.cameras.flatMap((c:any)=>cone.map(d=>cast(c.position,d))),roofHits=shots.filter((h:any)=>h&&h.distance<ENCLOSURE_LIMITS.roofDistance).length;
 const interior=roofHits/shots.length>=ENCLOSURE_LIMITS.roofShare;
 const {width:w,height:h}=ENCLOSURE_LIMITS;
 const cameras=scene.cameras.map((c:any)=>{
  const r=rasterVisibility(meshes,c,w,h,.1,2000),b=basis(c),t=Math.tan(c.fov/2),aspect=w/h,faces:Record<string,number>={'+x':0,'-x':0,'+y':0,'-y':0};let voids=0;
  const edge=new Uint8Array(w*h),seen=new Uint8Array(w*h);
  for(let p=0;p<w*h;p++){if(r.front[p]>=0||seen[p])continue;const stack=[p],comp:number[]=[];seen[p]=1;let touches=false;
   while(stack.length){const q=stack.pop()!;comp.push(q);const x=q%w,y=Math.floor(q/w);if(x===0||x===w-1||y===h-1)touches=true;
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=w||ny>=h)continue;const n=ny*w+nx;if(!seen[n]&&r.front[n]<0){seen[n]=1;stack.push(n);}}}
   if(touches)for(const q of comp)edge[q]=1;}
  let edgeVoids=0;
  for(let p=0;p<w*h;p++){if(r.front[p]>=0)continue;voids++;if(!edge[p])continue;edgeVoids++;
   const x=(p%w+.5)/w,y=(Math.floor(p/w)+.5)/h,d=[0,1,2].map(k=>b.forward[k]+b.right[k]*(x-.5)*2*t*aspect+b.up[k]*(.5-y)*2*t);
   let exit:string|null=null,best=Infinity;
   for(const k of [0,1]){if(Math.abs(d[k])<1e-9)continue;const bound=d[k]>0?box.max[k]:box.min[k],s=(bound-c.position[k])/d[k];if(s>0&&s<best){best=s;exit=(d[k]>0?'+':'-')+(k?'y':'x');}}
   const zAt=c.position[2]+d[2]*best;if(exit&&zAt>=box.min[2]-.01&&zAt<=box.max[2]+.01)faces[exit]++;}
  return {camera:c.name,voidShare:+(voids/(w*h)).toFixed(4),edgeShare:+(edgeVoids/(w*h)).toFixed(4),faces};});
 const covered=Object.fromEntries(['+x','-x','+y','-y'].map(f=>[f,+faceCover(f,boxes,box).toFixed(3)]));
 return {version:INTERIOR_ENCLOSURE,interior,box,covered,cameras};
}
/** The largest opening-free wall to reuse: thin on one horizontal axis, at least half the room's height. */
function wallSource(space:any,box:{min:V;max:V}){
 const opened=new Set((space.spatialOpenings??[]).map((o:any)=>space.program.instances.find((i:any)=>i.id===o.instanceId)?.template).filter(Boolean));
 const height=box.max[2]-box.min[2];
 return space.program.instances.map((i:any)=>({i,t:space.program.templates.find((t:any)=>t.id===i.template),e:space.entities.find((e:any)=>e.instanceId===i.id)}))
  .filter(({t,e}:any)=>t?.bounds&&e&&!opened.has(t.id)).map((x:any)=>{const s=[0,1,2].map(k=>(x.t.bounds.max[k]-x.t.bounds.min[k])*(x.i.scale?.[k]??1));return {...x,s};})
  .filter((x:any)=>Math.min(x.s[0],x.s[1])<=.6&&x.s[2]>=.5*height&&Math.max(x.s[0],x.s[1])>=1.5)
  .sort((a:any,b:any)=>Math.max(b.s[0],b.s[1])*b.s[2]-Math.max(a.s[0],a.s[1])*a.s[2])[0]??null;
}
/** One instance of the source wall template stretched over a missing side face, its inner surface on the room box. */
function wallFor(face:string,source:any,box:{min:V;max:V}){
 const b=source.t.bounds,thinLocal=b.max[0]-b.min[0]<=b.max[1]-b.min[1]?0:1,along=thinLocal?0:1,axis=face[1]==='x'?0:1,tangent=1-axis;
 // Rotate about Z so the template's long horizontal axis runs along the face.
 const rotation=[0,0,along===tangent?0:Math.PI/2],len=b.max[along]-b.min[along],thick=b.max[thinLocal]-b.min[thinLocal];
 const scale=[1,1,1];scale[along]=(box.max[tangent]-box.min[tangent])/len;scale[2]=(box.max[2]-box.min[2])/(b.max[2]-b.min[2]);scale[thinLocal]=1;
 const corners=[0,1,2,3,4,5,6,7].map(n=>rotate(rotation,[0,1,2].map(k=>(n>>k&1?b.max[k]:b.min[k])*scale[k])));
 const lo=[0,1,2].map(k=>Math.min(...corners.map(c=>c[k]))),target=[box.min[0],box.min[1],box.min[2]];
 target[axis]=face[0]==='+'?box.max[axis]:box.min[axis]-thick;
 const position=[0,1,2].map(k=>+(target[k]-lo[k]).toFixed(4));
 return {...structuredClone(source.i),id:'enclosure_'+(face[0]==='+'?'pos':'neg')+face[1],label:'推断围合墙（'+face+'）',position,rotation,scale:scale.map(v=>+v.toFixed(4))};
}
/** Add inferred side walls to an interior space when a camera looks out of the room; returns the space unchanged otherwise. */
export function withInteriorEnclosure(space:any,scene:any){
 const report:any=enclosureVoids(scene);
 if(!report.interior)return {space,report:{...report,added:[],reason:'机位上方多数方向无顶面，按室外场景处理'}};
 const open=new Set<string>();
 for(const c of report.cameras){if(c.edgeShare<ENCLOSURE_LIMITS.edgeLimit)continue;
  for(const [face,n] of Object.entries(c.faces as Record<string,number>))if(n/(ENCLOSURE_LIMITS.width*ENCLOSURE_LIMITS.height)>=ENCLOSURE_LIMITS.faceShare&&report.covered[face]<ENCLOSURE_LIMITS.wallCover)open.add(face);}
 const fresh=[...open].filter(f=>!space.program.instances.some((i:any)=>i.id==='enclosure_'+(f[0]==='+'?'pos':'neg')+f[1])).sort();
 if(!fresh.length)return {space,report:{...report,added:[]}};
 const source=wallSource(space,report.box);
 if(!source)return {space,report:{...report,added:[],reason:'没有可复用的无开口墙体模板'}};
 const walls=fresh.map(f=>wallFor(f,source,report.box)),next=structuredClone(space);
 next.program.instances.push(...walls);
 next.entities.push(...walls.map((w:any)=>({instanceId:w.id,role:'ground',category:source.e.category})));
 next.assumptions=[...(next.assumptions??[]),'参考图未拍到的'+fresh.join('、')+'侧由管线按已有墙体模板推断围合（'+INTERIOR_ENCLOSURE+'）'];
 return {space:next,report:{...report,added:walls.map((w:any)=>({id:w.id,template:w.template,position:w.position,rotation:w.rotation,scale:w.scale})),source:source.i.id}};
}
