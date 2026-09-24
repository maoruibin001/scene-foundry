/** Z 向上；与 Engine 的垂直视场和透视除法一致。输入点来自真实运行画面的网格射线。 */
export type Camera={position:number[];target:number[];fov:number};
export type Match={label:string;point:number[];expected:number[];observed:number[];confidence:number;meshId:string};
const dot=(a:number[],b:number[])=>a.reduce((s,v,i)=>s+v*b[i],0);
const sub=(a:number[],b:number[])=>a.map((v,i)=>v-b[i]);
const add=(a:number[],b:number[],s=1)=>a.map((v,i)=>v+b[i]*s);
const cross=(a:number[],b:number[])=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=(a:number[])=>a.map(v=>v/Math.hypot(...a));
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
export function basis(c:Camera){const forward=unit(sub(c.target,c.position)),right=unit(cross(forward,[0,0,1])),up=cross(right,forward);return {forward,right,up};}
export function project(c:Camera,p:number[],aspect=16/9){const {forward,right,up}=basis(c),d=sub(p,c.position),z=dot(d,forward),t=Math.tan(c.fov/2);return [.5+dot(d,right)/(z*t*aspect*2),.5-dot(d,up)/(z*t*2),z];}
export function ray(c:Camera,uv:number[],aspect=16/9){const b=basis(c),t=Math.tan(c.fov/2);return unit(add(add(b.forward,b.right,(uv[0]-.5)*2*t*aspect),b.up,(.5-uv[1])*2*t));}
export function rayScene(meshes:any[],options:{near?:number;far?:number;doubleSided?:boolean}={}){
 const near=options.near??.101,far=options.far??1000;
 const scene=meshes.map(m=>{const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity],v=m.geometry.positions;for(let i=0;i<v.length;i++) {min[i%3]=Math.min(min[i%3],v[i]);max[i%3]=Math.max(max[i%3],v[i]);}return {id:m.name,min,max,v,indices:m.geometry.indices};});
 return (origin:number[],direction:number[])=>{
  let best=far,hit:null|{point:number[];meshId:string;distance:number}=null;
  for(const m of scene){let lo=0,hi=best;for(let k=0;k<3;k++){if(Math.abs(direction[k])<1e-10){if(origin[k]<m.min[k]||origin[k]>m.max[k])hi=-1;}else{const a=(m.min[k]-origin[k])/direction[k],b=(m.max[k]-origin[k])/direction[k];lo=Math.max(lo,Math.min(a,b));hi=Math.min(hi,Math.max(a,b));}}if(hi<lo)continue;
   for(let k=0;k<m.indices.length;k+=3){const vertex=(i:number)=>m.v.slice(m.indices[k+i]*3,m.indices[k+i]*3+3),a=vertex(0),e1=sub(vertex(1),a),e2=sub(vertex(2),a),p=cross(direction,e2),det=dot(e1,p);if(options.doubleSided?Math.abs(det)<=1e-9:det<=1e-9)continue;const t=sub(origin,a),u=dot(t,p)/det;if(u<0||u>1)continue;const q=cross(t,e1),v=dot(direction,q)/det;if(v<0||u+v>1)continue;const distance=dot(e2,q)/det;if(distance>near&&distance<best){best=distance;hit={point:add(origin,direction,distance),meshId:m.id,distance};}}
  }return hit;
 };
}
function solve(a:number[][],b:number[]){const m=a.map((r,i)=>[...r,b[i]]),n=b.length;for(let j=0;j<n;j++){let pivot=j;for(let i=j+1;i<n;i++)if(Math.abs(m[i][j])>Math.abs(m[pivot][j]))pivot=i;[m[j],m[pivot]]=[m[pivot],m[j]];const d=m[j][j];if(Math.abs(d)<1e-12)return b.map(()=>0);for(let k=j;k<=n;k++)m[j][k]/=d;for(let i=0;i<n;i++)if(i!==j){const t=m[i][j];for(let k=j;k<=n;k++)m[i][k]-=t*m[j][k];}}return m.map(r=>r[n]);}
export function fitCamera(seed:Camera,matches:Match[],aspect=16/9){
 if(matches.length<10)throw Error('相机拟合至少需要十个可靠对应点');
 const d=sub(seed.target,seed.position),distance=Math.hypot(...d),x0=[...seed.position,Math.atan2(d[1],d[0]),Math.atan2(d[2],Math.hypot(d[0],d[1])),seed.fov],travel=Math.min(2,Math.max(.3,distance*.25));
 const ranges=x0.map((v,i)=>i<3?[v-travel*(i===2?.35:1),v+travel*(i===2?.35:1)]:i===5?[Math.max(.3,v-.35),Math.min(2.2,v+.35)]:[v-.3,v+.3]);
 const decode=(x:number[]):Camera=>({...seed,position:x.slice(0,3),target:add(x.slice(0,3),[Math.cos(x[3])*Math.cos(x[4]),Math.sin(x[3])*Math.cos(x[4]),Math.sin(x[4])],distance),fov:x[5]});
 // 固定每第四点只用于验证，避免仅靠训练点误差下降声称可靠校准。
 const training=matches.filter((_,i)=>i%4!==3),heldOut=matches.filter((_,i)=>i%4===3);
 const residual=(x:number[])=>{const c=decode(x),r:number[]=[];for(const m of training){const uv=project(c,m.point,aspect);for(let k=0;k<2;k++){const delta=(uv[k]-m.expected[k])*(k===0?aspect:1),robust=Math.abs(delta)>.04?Math.sqrt(.04/Math.abs(delta)):1;r.push((uv[2]>.1?delta*robust:10)*m.confidence);}}for(let i=0;i<6;i++)r.push((x[i]-x0[i])*(i<3?.012:.025));return r;};
 const norm=(r:number[])=>r.reduce((s,v)=>s+v*v,0);let x=[...x0],r=residual(x),cost=norm(r),lambda=.001,steps=0;
 for(let iteration=0;iteration<80;iteration++){const jac=x.map((_,i)=>{const xx=[...x];xx[i]+=.00001;return residual(xx).map((v,k)=>(v-r[k])/.00001);}),a=jac.map((ji,i)=>jac.map((jj,k)=>dot(ji,jj)+(i===k?lambda:0))),b=jac.map(ji=>-dot(ji,r)),delta=solve(a,b),trial=x.map((v,i)=>clamp(v+delta[i],...ranges[i] as [number,number])),rr=residual(trial),next=norm(rr);if(next<cost){const gain=cost-next;x=trial;r=rr;cost=next;steps++;lambda=Math.max(1e-8,lambda*.4);if(gain<1e-10)break;}else lambda*=5;if(lambda>1e7)break;}
 const camera=decode(x),error=(c:Camera,m:Match)=>{const p=project(c,m.point,aspect);return p[2]>.1?Math.hypot((p[0]-m.expected[0])*aspect,p[1]-m.expected[1]):10;},mean=(c:Camera,rows:Match[])=>rows.reduce((s,m)=>s+error(c,m),0)/rows.length;
 const before=mean(seed,matches),after=mean(camera,matches),validationBefore=mean(seed,heldOut),validationAfter=mean(camera,heldOut),worstRegression=Math.max(...matches.map(m=>error(camera,m)-error(seed,m)));
 const accepted=before>.015&&after<=before*.8&&validationAfter<=validationBefore*.85&&validationAfter<.065&&worstRegression<.045;
 return {camera,report:{accepted,steps,trainingCount:training.length,heldOutCount:heldOut.length,before,after,validationBefore,validationAfter,worstRegression,unit:'画面高度的归一化距离；不是质量得分',rows:matches.map((m,i)=>({...m,heldOut:i%4===3,before:error(seed,m),after:error(camera,m),projected:project(camera,m.point,aspect).slice(0,2)}))}};
}
