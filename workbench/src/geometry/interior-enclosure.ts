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
 * and at least faceShare of its pixels leave through that face. Edge void leaving through a face means the face is open there, whatever
 * spans its plane: workshop 33fc7a82 skipped -y as 'covered' (1.0) while 4.6% of a frame left through it, and failed S13 on that gap.
 * covered is reported for diagnosis only.
 */
export const ENCLOSURE_LIMITS={edgeLimit:.02,faceShare:.01,wallReach:.6,wallCover:.5,roofDistance:30,roofShare:.5,solidShare:.97,skirt:1,cell:.25,spanCap:60,width:96,height:54};
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
/**
 * A copy must not reproduce window holes: workshop 33fc7a82 reused T02, a wall cut around a separate window instance (its openings name
 * the window, not the wall), and 5.4% of a frame still showed through. Rays across the template's face on its thin axis must all but hit.
 */
function solidWall(scene:any,brief:any){
 // Space templates are briefs (bounds only); the graybox scene carries the parts.
 const t=scene.program.templates.find((x:any)=>x.id===brief.id);if(!t?.parts?.length)return false;
 const b=brief.bounds,thin=b.max[0]-b.min[0]<=b.max[1]-b.min[1]?0:1,along=1-thin,grid=12;
 const program={...scene.program,templates:[{...t,bounds:b}],instances:[{id:'probe',label:'probe',template:t.id,position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],requirementIds:[]}]};
 let meshes;try{meshes=meshesOf({program});}catch{return false;}
 const cast=rayScene(meshes,{near:0,far:1e4,doubleSided:true});let hits=0;
 for(let i=0;i<grid;i++)for(let j=0;j<grid;j++){const o=[0,0,0];o[along]=b.min[along]+(b.max[along]-b.min[along])*(i+.5)/grid;o[2]=b.min[2]+(b.max[2]-b.min[2])*(j+.5)/grid;o[thin]=b.min[thin]-1;
  const d=[0,0,0];d[thin]=1;if(cast(o,d))hits++;}
 return hits/(grid*grid)>=ENCLOSURE_LIMITS.solidShare;
}
/** The largest solid wall to reuse: thin on one horizontal axis, at least half the room's height. */
function wallSource(space:any,scene:any,box:{min:V;max:V}){
 const opened=new Set((space.spatialOpenings??[]).map((o:any)=>space.program.instances.find((i:any)=>i.id===o.instanceId)?.template).filter(Boolean));
 const height=box.max[2]-box.min[2];
 return space.program.instances.map((i:any)=>({i,t:space.program.templates.find((t:any)=>t.id===i.template),e:space.entities.find((e:any)=>e.instanceId===i.id)}))
  .filter(({t,e}:any)=>t?.bounds&&e&&!opened.has(t.id)).map((x:any)=>{const s=[0,1,2].map(k=>(x.t.bounds.max[k]-x.t.bounds.min[k])*(x.i.scale?.[k]??1));return {...x,s};})
  .filter((x:any)=>Math.min(x.s[0],x.s[1])<=.6&&x.s[2]>=.5*height&&Math.max(x.s[0],x.s[1])>=1.5)
  .sort((a:any,b:any)=>Math.max(b.s[0],b.s[1])*b.s[2]-Math.max(a.s[0],a.s[1])*a.s[2]).find((x:any)=>solidWall(scene,x.t))??null;
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
/**
 * The new wall stands on the room box, which other geometry may push past the floor's edge: workshop 16d7d971's floor stopped at x 5.1,
 * its +x wall at 5.6, and the 0.5 m strip between them failed S13 as "右墙脚异常连续白缝". Along each new wall, down-rays within skirt
 * metres of it find where no floor lies; one copy of the largest flat ground template is stretched from the floor's edge to the wall.
 */
function floorSkirts(space:any,scene:any,walls:any[],box:{min:V;max:V}){
 const floors=space.program.instances.map((i:any)=>({i,t:space.program.templates.find((t:any)=>t.id===i.template),e:space.entities.find((e:any)=>e.instanceId===i.id)}))
  .filter(({t,e}:any)=>t?.bounds&&e?.role==='ground'&&!String(e.instanceId).startsWith('enclosure_')).map((x:any)=>{const s=[0,1,2].map(k=>(x.t.bounds.max[k]-x.t.bounds.min[k])*(x.i.scale?.[k]??1));return {...x,s};})
  .filter((x:any)=>x.s[2]<=.5&&x.s[0]>=1&&x.s[1]>=1).map((x:any)=>({...x,top:x.i.position[2]+x.t.bounds.max[2]*(x.i.scale?.[2]??1)}));
 // A ceiling is flat ground too; the floor is the lowest slab (something may still sit below it, e.g. a pit).
 const lowest=Math.min(...floors.map((x:any)=>x.top)),source=floors.filter((x:any)=>x.top<=lowest+.3).sort((a:any,b:any)=>b.s[0]*b.s[1]-a.s[0]*a.s[1])[0];if(!source)return [];
 const cast=rayScene(meshesOf({program:{...scene.program,instances:scene.program.instances}}),{near:0,far:50,doubleSided:true}),top=box.min[2]+1,low=box.min[2]-.05,step=ENCLOSURE_LIMITS.cell;
 const skirts:any[]=[];
 for(const wall of walls){const face=wall.face,axis=face[1]==='x'?0:1,tangent=1-axis,sign=face[0]==='+'?1:-1,plane=sign>0?box.max[axis]:box.min[axis];
  let edge:number|null=null;// innermost depth with no floor under it, measured from the wall
  for(let d=step/2;d<ENCLOSURE_LIMITS.skirt;d+=step){let missing=0,n=0;
   for(let u=box.min[tangent]+step/2;u<box.max[tangent];u+=step){const o=[0,0,top];o[axis]=plane-sign*d;o[tangent]=u;n++;const h=cast(o,[0,0,-1]);if(!h||h.point[2]<low)missing++;}
   if(missing/n>.25)edge=d;}
  if(edge===null)continue;
  const b=source.t.bounds,depth=edge+step/2,scale=[1,1,1];scale[axis]=depth/(b.max[axis]-b.min[axis]);scale[tangent]=(box.max[tangent]-box.min[tangent])/(b.max[tangent]-b.min[tangent]);
  const position=[0,0,0];position[tangent]=box.min[tangent]-b.min[tangent]*scale[tangent];position[axis]=(sign>0?plane-depth:plane)-b.min[axis]*scale[axis];position[2]=source.i.position[2];
  skirts.push({...structuredClone(source.i),id:'enclosure_floor_'+(sign>0?'pos':'neg')+face[1],label:'推断围合地面（'+face+'）',position:position.map(v=>+v.toFixed(4)),rotation:[0,0,0],scale:[scale[0],scale[1],source.i.scale?.[2]??1].map(v=>+v.toFixed(4)),_category:source.e.category});
 }
 return skirts;
}
/** Add inferred side walls to an interior space when a camera looks out of the room; returns the space unchanged otherwise. */
export function withInteriorEnclosure(space:any,scene:any){
 const report:any=enclosureVoids(scene);
 if(!report.interior)return {space,report:{...report,added:[],reason:'机位上方多数方向无顶面，按室外场景处理'}};
 const open=new Set<string>();
 for(const c of report.cameras){if(c.edgeShare<ENCLOSURE_LIMITS.edgeLimit)continue;
  for(const [face,n] of Object.entries(c.faces as Record<string,number>))if(n/(ENCLOSURE_LIMITS.width*ENCLOSURE_LIMITS.height)>=ENCLOSURE_LIMITS.faceShare)open.add(face);}
 const wallId=(f:string)=>'enclosure_'+(f[0]==='+'?'pos':'neg')+f[1],exists=(f:string)=>space.program.instances.some((i:any)=>i.id===wallId(f));
 // A wall added in an earlier round no longer spans a room the repair grew: workshop 33fc7a82 kept its round-0 -y wall and its
 // inspection camera still saw 5.4% of the frame through that side. Open faces that already have one are fitted to the current box.
 const fresh=[...open].filter(f=>!exists(f)).sort(),refit=[...open].filter(exists).sort();
 if(!fresh.length&&!refit.length)return {space,report:{...report,added:[]}};
 const source=wallSource(space,scene,report.box);
 if(!source)return {space,report:{...report,added:[],reason:'没有可复用的实心墙体模板'}};
 const walls=fresh.map(f=>wallFor(f,source,report.box)),refitted=refit.map(f=>wallFor(f,source,report.box)),next=structuredClone(space);
 next.program.instances=next.program.instances.map((i:any)=>refitted.find((w:any)=>w.id===i.id)??i);
 next.program.instances.push(...walls);
 next.entities.push(...walls.map((w:any)=>({instanceId:w.id,role:'ground',category:source.e.category})));
 const skirts=floorSkirts(space,scene,fresh.map((face,n)=>({face,wall:walls[n]})),report.box).map(({_category,...i}:any)=>({i,category:_category}));
 next.program.instances.push(...skirts.map((x:any)=>x.i));next.entities.push(...skirts.map((x:any)=>({instanceId:x.i.id,role:'ground',category:x.category})));
 if(fresh.length)next.assumptions=[...(next.assumptions??[]),'参考图未拍到的'+fresh.join('、')+'侧由管线按已有墙体模板推断围合（'+INTERIOR_ENCLOSURE+'）'];
 const placed=(w:any)=>({id:w.id,template:w.template,position:w.position,rotation:w.rotation,scale:w.scale});
 return {space:next,report:{...report,floors:skirts.map((x:any)=>({id:x.i.id,position:x.i.position,scale:x.i.scale})),added:walls.map(placed),refitted:refitted.map(placed),source:source.i.id}};
}
