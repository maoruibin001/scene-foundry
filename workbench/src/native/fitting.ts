import {validateReconstruction,validateObservations,resolveSupports} from './reconstruction-schema';
const clone=(v:any)=>JSON.parse(JSON.stringify(v));
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const radians=(c:any)=>{const d=c.target.map((x:number,i:number)=>x-c.position[i]);return [Math.atan2(d[1],d[0]),Math.atan2(d[2],Math.hypot(d[0],d[1]))];};
export function projectPoint(c:any,p:number[]){const [yaw,pitch]=radians(c),f=[Math.cos(pitch)*Math.cos(yaw),Math.cos(pitch)*Math.sin(yaw),Math.sin(pitch)],r=[Math.sin(yaw),-Math.cos(yaw),0],u=[-Math.sin(pitch)*Math.cos(yaw),-Math.sin(pitch)*Math.sin(yaw),Math.cos(pitch)],d=p.map((x,i)=>x-c.position[i]),dot=(a:number[])=>a.reduce((s,x,i)=>s+x*d[i],0),z=dot(f),t=Math.tan(c.verticalFov/2);return [.5+dot(r)/(Math.max(.05,z)*t*(16/9)*2),.5-dot(u)/(Math.max(.05,z)*t*2),z];}
export function targetGeometry(layout:any,id:string){
 const asset=layout.assets.find((a:any)=>a.id===id);if(asset)return asset;
 if(id==='entrance_01'){const w=layout.architecture.find((w:any)=>w.openings.some((o:any)=>o.id===id));if(w){const left=Math.min(...w.openings.map((o:any)=>o.offset-o.width/2)),right=Math.max(...w.openings.map((o:any)=>o.offset+o.width/2)),center=(left+right)/2;return {position:[w.position[0]+Math.cos(w.rotation)*center,w.position[1]+Math.sin(w.rotation)*center,w.position[2]],rotation:w.rotation,size:[right-left,.02,Math.max(...w.openings.map((o:any)=>o.bottom+o.height))]};}}
 for(const wall of layout.architecture){const o=wall.openings.find((a:any)=>a.id===id);if(o){const c=Math.cos(wall.rotation),s=Math.sin(wall.rotation);return {...o,position:[wall.position[0]+c*o.offset,wall.position[1]+s*o.offset,wall.position[2]+o.bottom],rotation:wall.rotation,size:[o.width,.02,o.height]};}}
 return layout.architecture.find((a:any)=>a.id===id);
}
export function projectedBounds(camera:any,node:any){const points=[];for(const x of [-.5,.5])for(const y of [-.5,.5])for(const z of [0,1]){const c=Math.cos(node.rotation),s=Math.sin(node.rotation);points.push(projectPoint(camera,[node.position[0]+x*node.size[0]*c-y*node.size[1]*s,node.position[1]+x*node.size[0]*s+y*node.size[1]*c,node.position[2]+z*node.size[2]]));}return [Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];}
export function observedBounds(camera:any,node:any,observation:any){
 const bounds=projectedBounds(camera,node);
 // 第一视角的近端拱脚在画外，观察框下边缘实际来自远端拱脚。
 // 不能用整个三维包围盒的画外下边缘驱动相机，否则会系统性抬高构图。
 if(observation.kind==='arch'&&camera.referenceIndex===1){const x=-node.size[0]/2;bounds[3]=projectPoint(camera,[node.position[0]+x*Math.cos(node.rotation),node.position[1]+x*Math.sin(node.rotation),node.position[2]])[1];}
 return bounds;
}
export function contentBox(b:number[]){return [b[0],(b[1]*2377-109)/2160,b[2],(b[3]*2377-109)/2160];}
// 三维射线按墙的局部坐标检查实际门窗开口，避免包围框正确但实体位于墙后的伪解。
export function wallOcclusion(layout:any,from:number[],to:number[]){
 for(const wall of layout.architecture.filter((n:any)=>n.kind==='wall')){
  const c=Math.cos(wall.rotation),s=Math.sin(wall.rotation),local=(p:number[])=>{const x=p[0]-wall.position[0],y=p[1]-wall.position[1];return [c*x+s*y,-s*x+c*y,p[2]-wall.position[2]];},a=local(from),b=local(to),dy=b[1]-a[1];
  if(Math.abs(dy)<1e-8)continue;const t=-a[1]/dy;if(t<=.001||t>=.999)continue;const x=a[0]+t*(b[0]-a[0]),z=a[2]+t*(b[2]-a[2]);if(Math.abs(x)>wall.size[0]/2||z<0||z>wall.size[2])continue;
  const opening=wall.openings.find((o:any)=>Math.abs(x-o.offset)<o.width/2&&z>=o.bottom&&z<=o.bottom+o.height-o.rise+o.rise*Math.sqrt(Math.max(0,1-((x-o.offset)/(o.width/2))**2)));
  if(!opening)return wall.id;
 }
 return null;
}
export function requireVisibleTargets(layout:any){
 for(const rule of layout.fitOptions?.visibility??[]){const cam=layout.cameras.find((c:any)=>c.referenceIndex===rule.referenceIndex),node=targetGeometry(layout,rule.targetId);if(!cam||!node)throw Error('可见性约束引用无效：'+rule.targetId);const point=[...node.position];point[2]+=node.size[2]*.65;const wall=wallOcclusion(layout,cam.position,point);if(wall)throw Error('共同布局的参考视角 '+rule.referenceIndex+' 被墙体遮挡：'+rule.targetId+' / '+wall);}
}
function solve(a:number[][],b:number[]){const m=a.map((r,i)=>[...r,b[i]]),n=b.length;for(let j=0;j<n;j++){let pivot=j;for(let i=j+1;i<n;i++)if(Math.abs(m[i][j])>Math.abs(m[pivot][j]))pivot=i;[m[j],m[pivot]]=[m[pivot],m[j]];const d=m[j][j];if(Math.abs(d)<1e-12)return b.map(()=>0);for(let k=j;k<=n;k++)m[j][k]/=d;for(let i=0;i<n;i++)if(i!==j){const t=m[i][j];for(let k=j;k<=n;k++)m[i][k]-=t*m[j][k];}}return m.map(r=>r[n]);}
// 观测含遮挡框，不能把它们当成精确三维测量。先约束相机与共同物体，再输出剩余误差供人工/视觉复核。
export function fitLayout(seed:any,observations:any){
 validateReconstruction(seed);validateObservations(observations);
 const options=seed.fitOptions??{},movable=seed.assets.filter((a:any)=>options.assets?.[a.id]&&!a.support);
 const x0:number[]=[],bounds:number[][]=[],prior:number[]=[];
 const add=(v:number,lo:number,hi:number,s:number)=>{x0.push(v);bounds.push([lo,hi]);prior.push(s);};
 for(const cam of seed.cameras){const [yaw,pitch]=radians(cam),range=options.cameras?.[cam.referenceIndex]??{};for(let i=0;i<3;i++){const fallback=i===2?[1.45,1.85]:[cam.position[i]-1,cam.position[i]+1],b=range.position?.[i]??fallback;add(cam.position[i],b[0],b[1],i===2?.12:.05);}add(yaw,yaw-(range.yawDelta??.4),yaw+(range.yawDelta??.4),.12);add(pitch,Math.max(-.18,pitch-(range.pitchDelta??.3)),Math.min(.3,pitch+(range.pitchDelta??.3)),.08);add(cam.verticalFov,Math.max(.68,cam.verticalFov-(range.fovDelta??.5)),Math.min(1.2,cam.verticalFov+(range.fovDelta??.5)),.12);}
 for(const a of movable)for(let i=0;i<2;i++){const b=options.assets[a.id][i];add(a.position[i],b[0],b[1],.06);}
 const decode=(x:number[])=>{const l=clone(seed);let k=0;for(const cam of l.cameras){cam.position=x.slice(k,k+3);const yaw=x[k+3],pitch=x[k+4];cam.target=[cam.position[0]+Math.cos(yaw)*Math.cos(pitch)*10,cam.position[1]+Math.sin(yaw)*Math.cos(pitch)*10,cam.position[2]+Math.sin(pitch)*10];cam.verticalFov=x[k+5];k+=6;}for(const a of movable){const n=l.assets.find((n:any)=>n.id===a.id);n.position[0]=x[k++];n.position[1]=x[k++];}return resolveSupports(l);};
 const errors=(layout:any)=>{const rows:any[]=[];for(const o of observations.items){for(const cam of layout.cameras){const targetId=layout.observationTargets?.[o.id]?.[cam.referenceIndex]??o.id,node=targetGeometry(layout,targetId);if(!node)continue;const raw=o['reference'+cam.referenceIndex];if(raw[2]<=raw[0])continue;const b=contentBox(raw),p=observedBounds(cam,node,o),v=cam.referenceIndex;let weight=o.confidence;
 // 截断主拱、前景卡座和吊链无法用模型包围盒无歧义拟合；保留在报告中，不伪造低误差。
 const excluded=o.kind==='booth'||o.kind==='pendant'||(o.id==='fallen_lamp_table'&&v===1);
 if(excluded||(o.id==='fallen_lamp_floor'&&v===1))weight=0;
 if(o.kind==='fallen_lamp')weight*=.7;
 const edges=o.kind==='arch'&&v===1?[0,3]:[0,1,2,3];if(['arcade','round_table'].includes(o.kind)&&v===2)edges.splice(edges.indexOf(3),1);
 rows.push({id:o.id,targetId,referenceIndex:v,expected:b,projected:p,weight,edges});}}
 return rows;};
 const residual=(x:number[])=>{const layout=decode(x),rows=errors(layout),r:number[]=[];for(const row of rows)for(const i of row.edges){const delta=(clamp(row.projected[i],-.1,1.1)-row.expected[i])*(i%2===0?16/9:1);const robust=Math.abs(delta)>.16?Math.sqrt(.16/Math.abs(delta)):1;r.push(delta*robust*row.weight);}for(const rule of options.visibility??[]){const cam=layout.cameras.find((c:any)=>c.referenceIndex===rule.referenceIndex),node=targetGeometry(layout,rule.targetId);if(cam&&node){const point=[...node.position];point[2]+=node.size[2]*.65;r.push(wallOcclusion(layout,cam.position,point)?2:0);}}
 for(let i=0;i<x.length;i++)r.push((x[i]-x0[i])*prior[i]);return r;};
 const norm=(r:number[])=>r.reduce((s,v)=>s+v*v,0);let x=[...x0],r=residual(x),cost=norm(r),lambda=.001,accepted=0;
 for(let iteration=0;iteration<70;iteration++){const n=x.length,j=[];for(let i=0;i<n;i++){const xx=[...x],h=.0001;xx[i]+=h;const rr=residual(xx);j.push(rr.map((v,k)=>(v-r[k])/h));}const a=j.map((ji,i)=>j.map((jj,k)=>ji.reduce((s,v,t)=>s+v*jj[t],0)+(i===k?lambda:0))),b=j.map(ji=>-ji.reduce((s,v,k)=>s+v*r[k],0)),delta=solve(a,b),trial=x.map((v,i)=>clamp(v+delta[i],bounds[i][0],bounds[i][1])),rr=residual(trial),next=norm(rr);if(next<cost){const improvement=cost-next;x=trial;r=rr;cost=next;lambda=Math.max(1e-7,lambda*.45);accepted++;if(improvement<1e-9)break;}else lambda*=5;if(lambda>1e6)break;}
 const layout=decode(x),rows=errors(layout),before=errors(seed);validateReconstruction(layout);requireVisibleTargets(layout);const mean=(rs:any[])=>{const active=rs.filter(r=>r.weight>0);return active.reduce((s,r)=>s+r.edges.reduce((a:number,i:number)=>a+Math.abs(r.projected[i]-r.expected[i])*(i%2===0?1600:900),0)/r.edges.length,0)/active.length;};
 return {layout,report:{method:'固定建筑拓扑、限制相机与资产范围并检查墙体遮挡的双视角拟合',status:'需要运行画面复核',referenceSize:[3840,2377],contentRect:[0,109,3840,2160],acceptedSteps:accepted,beforeMeanEdgeErrorPx:mean(before),afterMeanEdgeErrorPx:mean(rows),outputResolution:[1600,900],limitations:['遮挡框不等于完整几何边界；卡座和吊链不用于拟合，截断拱洞只使用可见左边与底边。','建筑拓扑固定；墙体射线仅检查指定物体中心附近，不能替代完整可见性与穿插验收。','该误差仅衡量被选中的几何投影，不是完整复刻评分。'],rows}};
}
if(import.meta.main){const {readFileSync,writeFileSync}=await import('node:fs');const [seed,observations,out]=process.argv.slice(2);const r=fitLayout(JSON.parse(readFileSync(seed,'utf8')),JSON.parse(readFileSync(observations,'utf8')));writeFileSync(out,JSON.stringify(r.layout,null,2)+'\n');writeFileSync(out.replace(/\.json$/,'.fit.json'),JSON.stringify(r.report,null,2)+'\n');console.log(JSON.stringify({before:r.report.beforeMeanEdgeErrorPx,after:r.report.afterMeanEdgeErrorPx,steps:r.report.acceptedSteps,cameras:r.layout.cameras}));}
