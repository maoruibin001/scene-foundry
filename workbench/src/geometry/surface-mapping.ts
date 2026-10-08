export type UvTransform={offset:[number,number];rotation:number;flipU:boolean;flipV:boolean};
export type UvProjection={mode:'native'}|{mode:'world-box';metersPerRepeat:[number,number,number];origin:[number,number,number]};
const finite=(n:any,min:number,max:number)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
export function validateSurfaceMapping(part:any){
 const t=part.uvTransform;
 if(t!=null&&(!Array.isArray(t.offset)||t.offset.length!==2||!t.offset.every(n=>finite(n,-100,100))||!finite(t.rotation,-Math.PI*2,Math.PI*2)||typeof t.flipU!=='boolean'||typeof t.flipV!=='boolean'))throw Error('UV 变换无效');
 if(part.smoothAngle!=null&&!finite(part.smoothAngle,0,180))throw Error('平滑角度无效');
 const p=part.uvProjection;
 if(p!=null){
  if(p.mode==='native'){if(Object.keys(p).some(k=>k!=='mode'))throw Error('原生 UV 投影不能包含世界映射参数');}
  else if(p.mode!=='world-box'||Object.keys(p).some(k=>!['mode','metersPerRepeat','origin'].includes(k))||!Array.isArray(p.metersPerRepeat)||p.metersPerRepeat.length!==3||!p.metersPerRepeat.every(n=>finite(n,.001,1000))||!Array.isArray(p.origin)||p.origin.length!==3||!p.origin.every(n=>finite(n,-1000,1000)))throw Error('世界 UV 投影无效：需要正的三轴米制周期和有限原点');
 }
}
/** 用最终世界坐标保持相邻部件的纹理尺度与相位。每个三角形独立顶点，按几何法线选轴，不改几何或法线。 */
export function projectSurfaceUvs(geometry:{positions:number[];indices:number[]},projection:UvProjection|undefined|null,native:number[]){
 if(!projection||projection.mode==='native')return native;
 const {positions:p,indices}=geometry,uvs=[...native],seen=new Map<number,number>();
 for(let k=0;k<indices.length;k+=3){
  const ids=indices.slice(k,k+3),[a,b,c]=ids.map(i=>p.slice(i*3,i*3+3));
  const u=b.map((n,i)=>n-a[i]),v=c.map((n,i)=>n-a[i]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]].map(Math.abs);
  const axis=n.indexOf(Math.max(...n)),horizontal=axis===0?1:0,vertical=axis===2?1:2;
  for(const id of ids){
   if(seen.has(id)&&seen.get(id)!==axis)throw Error('世界 UV 投影需要面边界独立顶点');
   seen.set(id,axis);
   uvs[id*2]=(p[id*3+horizontal]-projection.origin[horizontal])/projection.metersPerRepeat[horizontal];
   uvs[id*2+1]=-(p[id*3+vertical]-projection.origin[vertical])/projection.metersPerRepeat[vertical];
  }
 }
 return uvs;
}
/** 单位UV先以中心翻转/旋转，再重复与偏移；实例覆盖重复数也从原始UV计算。 */
export function mapSurfaceUvs(uvs:number[],scale:[number,number]=[1,1],t?:UvTransform|null){
 if(!t)return uvs.map((v,k)=>v*scale[k%2]);
 const c=Math.cos(t.rotation),s=Math.sin(t.rotation),out:number[]=[];
 for(let k=0;k<uvs.length;k+=2){const u=(uvs[k]-.5)*(t.flipU?-1:1),v=(uvs[k+1]-.5)*(t.flipV?-1:1);out.push((u*c-v*s+.5)*scale[0]+t.offset[0],(u*s+v*c+.5)*scale[1]+t.offset[1]);}
 return out;
}
/** 只平滑同一部件的共享位置，按夹角保留折边；相反朝向的双面网格不互相平均。 */
export function smoothSurfaceNormals(geometry:{positions:number[];normals:number[];indices:number[]},degrees:number){
 if(!degrees)return [...geometry.normals];
 const p=geometry.positions,groups=new Map<string,number[]>(),entries:{normal:number[];weight:number}[]=Array(p.length/3),threshold=Math.cos(Math.min(degrees,179.9)*Math.PI/180);
 const key=(i:number)=>p.slice(i*3,i*3+3).map(n=>Math.round(n*1e8)).join(',');
 for(let k=0;k<geometry.indices.length;k+=3){const ids=geometry.indices.slice(k,k+3);
  for(let c=0;c<3;c++){const i=ids[c],a=ids[(c+1)%3],b=ids[(c+2)%3],u=[0,1,2].map(j=>p[a*3+j]-p[i*3+j]),v=[0,1,2].map(j=>p[b*3+j]-p[i*3+j]),cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...cross);
   if(length<1e-12)continue;
   const weight=Math.acos(Math.max(-1,Math.min(1,u.reduce((n,x,j)=>n+x*v[j],0)/(Math.hypot(...u)*Math.hypot(...v)))));
   entries[i]={normal:cross.map(n=>n/length),weight};const id=key(i),list=groups.get(id)??[];if(!list.includes(i))list.push(i);groups.set(id,list);
  }
 }
 const out=[...geometry.normals];
 for(const list of groups.values())for(const i of list){const own=entries[i],sum=[0,0,0];for(const other of list){const e=entries[other];if(own.normal.reduce((n,x,j)=>n+x*e.normal[j],0)+1e-9<threshold)continue;for(let j=0;j<3;j++)sum[j]+=e.normal[j]*e.weight;}const length=Math.hypot(...sum);if(length>1e-12)for(let j=0;j<3;j++)out[i*3+j]=sum[j]/length;}
 return out;
}
