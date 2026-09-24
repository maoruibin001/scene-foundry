/** Geometry checks use compiled parts; overlaps inside an assembled asset are intentional. */
export function obb(o:any){const a=o.rotation??0,c=Math.cos(a),s=Math.sin(a);return {center:[o.position[0],o.position[1],o.position[2]+o.size[2]/2],half:o.size.map((v:number)=>v/2),axes:[[c,s],[-s,c]],source:o};}
export function overlap(a:any,b:any,epsilon=.025){
 const x=obb(a),y=obb(b),z=Math.min(x.center[2]+x.half[2],y.center[2]+y.half[2])-Math.max(x.center[2]-x.half[2],y.center[2]-y.half[2]);if(z<=epsilon)return false;
 for(const axis of [...x.axes,...y.axes]){const dot=(v:number[],w:number[])=>v[0]*w[0]+v[1]*w[1],r=(p:any)=>Math.abs(dot(axis,p.axes[0]))*p.half[0]+Math.abs(dot(axis,p.axes[1]))*p.half[1];if(r(x)+r(y)-Math.abs(dot(axis,[y.center[0]-x.center[0],y.center[1]-x.center[1]]))<=epsilon)return false;}return true;
}
export function contained(child:any,parent:any,margin=.03){const p=obb(parent),a=obb(child);for(const sx of [-1,1])for(const sy of [-1,1]){const point=[a.center[0]+sx*a.axes[0][0]*a.half[0]+sy*a.axes[1][0]*a.half[1]-p.center[0],a.center[1]+sx*a.axes[0][1]*a.half[0]+sy*a.axes[1][1]*a.half[1]-p.center[1]];for(let k=0;k<2;k++)if(Math.abs(point[0]*p.axes[k][0]+point[1]*p.axes[k][1])>p.half[k]+margin)return false;}return true;}
export function supportTop(entity:any){return entity.position[2]+entity.size[2]*(entity.kind==='platform'?.42:1);}
export function supportEvidence(child:any,parent:any){
 const p=obb(parent),a=obb(child),required=[0,0];
 for(const sx of [-1,1])for(const sy of [-1,1]){const point=[a.center[0]+sx*a.axes[0][0]*a.half[0]+sy*a.axes[1][0]*a.half[1]-p.center[0],a.center[1]+sx*a.axes[0][1]*a.half[0]+sy*a.axes[1][1]*a.half[1]-p.center[1]];for(let k=0;k<2;k++)required[k]=Math.max(required[k],2*Math.abs(point[0]*p.axes[k][0]+point[1]*p.axes[k][1]));}
 return {id:parent.id,top:supportTop(parent),heightGap:child.position[2]-supportTop(parent),footprintContained:contained(child,parent),supportSize:parent.size.slice(0,2),requiredSupportSize:required.map(x=>Math.ceil((x+.06)*100)/100)};
}
export function inspectGeometry(ir:any,recipe:any){
 const checks:any[]=[],suspects:any[]=[],grounds=ir.entities.filter((e:any)=>e.role==='ground');
 for(const e of ir.entities.filter((e:any)=>e.role!=='ground')){
  const declared=ir.relations.filter((r:any)=>r.type==='on'&&r.subjects.includes(e.id)).map((r:any)=>ir.entities.find((p:any)=>p.id===r.target));
  const supports=declared.length?declared:grounds;
  const supported=supports.length?supports.some((g:any)=>Math.abs(e.position[2]-supportTop(g))<.03&&contained(e,g)):Math.abs(e.position[2])<.03;
  checks.push({type:'support',subject:e.id,passed:supported,reason:supported?'底部与支撑面贴合且投影位于支撑范围':'悬浮、埋入或超出支撑边界',evidence:{bottom:e.position[2],supports:supports.map((g:any)=>g.id),candidates:supports.map((g:any)=>supportEvidence(e,g)),implicitFloor:!supports.length}});
 }
 const parts=recipe.objects.filter((o:any)=>o.role!=='ground'&&o.shape!=='leaf');
 for(let i=0;i<parts.length;i++)for(let j=i+1;j<parts.length;j++){const a=parts[i],b=parts[j];if(a.entityId===b.entityId||!overlap(a,b))continue;const exact=a.shape==='box'&&b.shape==='box';const row={type:exact?'solidIntersection':'possibleIntersection',subject:a.entityId,target:b.entityId,parts:[a.id,b.id],passed:false,reason:exact?'独立实体的实体盒发生内部相交':'曲面包围盒相交，需视觉核对，不直接当作穿模'};(exact?checks:suspects).push(row);}
 return {checks,suspects,passed:checks.every(c=>c.passed),method:'rotated box SAT; support footprint containment; curved-part overlaps flagged for review, not treated as exact mesh collision'};
}
