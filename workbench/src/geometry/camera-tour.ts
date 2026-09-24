/** Z 向上。用真实三角形检查相机近裁面的包围球扫过整段路径，不用物体包围盒代替净空。 */
type V=number[];
const sub=(a:V,b:V)=>a.map((v,i)=>v-b[i]),add=(a:V,b:V,s=1)=>a.map((v,i)=>v+b[i]*s);
const dot=(a:V,b:V)=>a.reduce((s,v,i)=>s+v*b[i],0),length=(v:V)=>Math.hypot(...v);
const cross=(a:V,b:V)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const clamp=(x:number)=>Math.max(0,Math.min(1,x));
function segmentDistance(a:V,b:V,c:V,d:V){
 const u=sub(b,a),v=sub(d,c),w=sub(a,c),aa=dot(u,u),bb=dot(u,v),cc=dot(v,v),dd=dot(u,w),ee=dot(v,w),den=aa*cc-bb*bb;
 let s=0,t=0;
 if(aa<1e-18)t=cc<1e-18?0:clamp(ee/cc);
 else if(cc<1e-18)s=clamp(-dd/aa);
 else {s=den>1e-18?clamp((bb*ee-cc*dd)/den):0;t=(bb*s+ee)/cc;if(t<0){t=0;s=clamp(-dd/aa);}else if(t>1){t=1;s=clamp((bb-dd)/aa);}}
 return length(sub(add(a,u,s),add(c,v,t)));
}
function pointTriangle(p:V,a:V,b:V,c:V){
 const ab=sub(b,a),ac=sub(c,a),ap=sub(p,a),d1=dot(ab,ap),d2=dot(ac,ap);
 if(d1<=0&&d2<=0)return length(ap);
 const bp=sub(p,b),d3=dot(ab,bp),d4=dot(ac,bp);if(d3>=0&&d4<=d3)return length(bp);
 const vc=d1*d4-d3*d2;if(vc<=0&&d1>=0&&d3<=0)return length(sub(p,add(a,ab,d1/(d1-d3))));
 const cp=sub(p,c),d5=dot(ab,cp),d6=dot(ac,cp);if(d6>=0&&d5<=d6)return length(cp);
 const vb=d5*d2-d1*d6;if(vb<=0&&d2>=0&&d6<=0)return length(sub(p,add(a,ac,d2/(d2-d6))));
 const va=d3*d6-d5*d4;if(va<=0&&d4-d3>=0&&d5-d6>=0)return length(sub(p,add(b,sub(c,b),(d4-d3)/(d4-d3+d5-d6))));
 const sum=va+vb+vc;if(Math.abs(sum)<1e-18)return Math.min(segmentDistance(p,p,a,b),segmentDistance(p,p,b,c),segmentDistance(p,p,c,a));
 return length(sub(p,add(add(a,ab,vb/sum),ac,vc/sum)));
}
export function segmentTriangleDistance(start:V,end:V,a:V,b:V,c:V){
 const n=cross(sub(b,a),sub(c,a)),direction=sub(end,start),den=dot(n,direction);
 if(Math.abs(den)>1e-16){const t=dot(n,sub(a,start))/den;if(t>=0&&t<=1&&pointTriangle(add(start,direction,t),a,b,c)<1e-8)return 0;}
 return Math.min(pointTriangle(start,a,b,c),pointTriangle(end,a,b,c),segmentDistance(start,end,a,b),segmentDistance(start,end,b,c),segmentDistance(start,end,c,a));
}
export function cameraClearance(meshes:any[]){
 const triangles=meshes.flatMap(m=>{const g=m.geometry,rows=[];for(let i=0;i<g.indices.length;i+=3){const v=g.indices.slice(i,i+3).map((index:number)=>g.positions.slice(index*3,index*3+3));rows.push({id:m.name,v,min:[0,1,2].map(k=>Math.min(...v.map((p:V)=>p[k]))),max:[0,1,2].map(k=>Math.max(...v.map((p:V)=>p[k])))});}return rows;});
 return (start:V,end:V,radius:number)=>{
  const min=start.map((v,i)=>Math.min(v,end[i])-radius),max=start.map((v,i)=>Math.max(v,end[i])+radius);let distance=Infinity,meshId:string|null=null;
  for(const t of triangles){if(min.some((v,i)=>v>t.max[i]||max[i]<t.min[i]))continue;const d=segmentTriangleDistance(start,end,t.v[0],t.v[1],t.v[2]);if(d<distance){distance=d;meshId=t.id;}}
  return {safe:distance>radius+1e-6,distance:Number.isFinite(distance)?distance:null,meshId};
 };
}
export function planCameraTour(camera:{position:V;target:V;fov:number},clear:ReturnType<typeof cameraClearance>,aspect=16/9,near=.1){
 const radius=near*Math.sqrt(1+Math.tan(camera.fov/2)**2*(1+aspect**2))+.02;
 const start=[...camera.position],initial=clear(start,start,radius),base={version:'camera-tour-v1',origin:start,radius,near,aspect,method:'真实三角形与近裁面包围球的线段扫掠，包含玻璃表面'};
 if(!initial.safe)return {...base,status:'blocked',displacement:[0,0,0],reason:'参考机位的近裁面空间已与场景表面相交',blocker:initial.meshId};
 const f=sub(camera.target,start);f[2]=0;const norm=length(f);const forward=norm>1e-8?f.map(v=>v/norm):[0,1,0],right=[forward[1],-forward[0],0];
 // 优先侧向视差；找不到完整幅度时才缩短，不能通过隐藏障碍或原地转向获得通过。
 for(const amplitude of [.5,.35,.2,.12])for(const angle of [0,Math.PI,Math.PI/4,-Math.PI/4,Math.PI*3/4,-Math.PI*3/4,Math.PI/2,-Math.PI/2]){
  const displacement=right.map((v,i)=>amplitude*(v*Math.cos(angle)+forward[i]*Math.sin(angle))),end=add(start,displacement);
  if(clear(start,end,radius).safe)return {...base,status:'ready',displacement,reason:null,blocker:null};
 }
 return {...base,status:'blocked',displacement:[0,0,0],reason:'参考机位周围没有足够净空的连续平移路径',blocker:null};
}
