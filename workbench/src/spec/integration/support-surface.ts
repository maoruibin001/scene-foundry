/** Pipeline-derived planar support. Runtime queries source triangles, never inferred filled holes. */
export type SurfaceData={height:number;triangles:number[][];obstacles:number[][]};
const cross=(ax:number,az:number,bx:number,bz:number)=>ax*bz-az*bx;
export function containsTriangle(t:readonly number[],x:number,z:number){
 if(Math.abs(cross(t[2]-t[0],t[3]-t[1],t[4]-t[0],t[5]-t[1]))<1e-10)return false;
 const a=cross(t[2]-t[0],t[3]-t[1],x-t[0],z-t[1]),b=cross(t[4]-t[2],t[5]-t[3],x-t[2],z-t[3]),c=cross(t[0]-t[4],t[1]-t[5],x-t[4],z-t[5]);
 return (a>=-1e-6&&b>=-1e-6&&c>=-1e-6)||(a<=1e-6&&b<=1e-6&&c<=1e-6);
}
const edgeDistance=(x:number,z:number,ax:number,az:number,bx:number,bz:number)=>{const d=(bx-ax)**2+(bz-az)**2;const u=d?Math.max(0,Math.min(1,((x-ax)*(bx-ax)+(z-az)*(bz-az))/d)):0;return Math.hypot(x-ax-u*(bx-ax),z-az-u*(bz-az));};
export function createSupportSurface(data:SurfaceData,radius:number){
 const size=4,buckets=new Map<string,number[][]>();
 for(const t of data.triangles){for(let x=Math.floor(Math.min(t[0],t[2],t[4])/size);x<=Math.floor(Math.max(t[0],t[2],t[4])/size);x++)for(let z=Math.floor(Math.min(t[1],t[3],t[5])/size);z<=Math.floor(Math.max(t[1],t[3],t[5])/size);z++){const key=x+','+z;const bucket=buckets.get(key)??[];bucket.push(t);buckets.set(key,bucket);}}
 const supported=(x:number,z:number)=>(buckets.get(Math.floor(x/size)+','+Math.floor(z/size))??[]).some(t=>containsTriangle(t,x,z));
 return (x:number,z:number)=>{
  if(!Number.isFinite(x)||!Number.isFinite(z)||!supported(x,z))return false;
  for(let i=0;i<16;i++){const a=i*Math.PI/8;if(!supported(x+radius*Math.cos(a),z+radius*Math.sin(a)))return false;}
  for(const t of data.obstacles){if(containsTriangle(t,x,z))return false;for(let i=0;i<3;i++){const j=(i+1)%3;if(edgeDistance(x,z,t[2*i],t[2*i+1],t[2*j],t[2*j+1])<radius)return false;}}
  return true;
 };
}
/** Only upward horizontal source triangles at the walking datum become support.
 * Body-height triangles become barriers; no automatic floor across pits. Identity source TRS required by caller. */
export function deriveSupportSurface(position:ArrayLike<number>,indices:ArrayLike<number>,height=0):SurfaceData{
 const triangles:number[][]=[],obstacles:number[][]=[];
 for(let i=0;i<indices.length;i+=3){const v=[indices[i],indices[i+1],indices[i+2]].map(n=>[position[3*n],position[3*n+1],position[3*n+2]]);const ys=v.map(p=>p[1]),t=v.flatMap(p=>[p[0],p[2]]);const area=cross(t[2]-t[0],t[3]-t[1],t[4]-t[0],t[5]-t[1]);
  if(ys.every(y=>Math.abs(y-height)<.005)&&area< -1e-7)triangles.push(t);
  else if(Math.max(...ys)>height+.15&&Math.min(...ys)<height+2.05){ // body-height intersection, including narrow vertical faces
   if(Math.max(...ys)-Math.min(...ys)>.05)obstacles.push(t);
  }
 }
 if(!triangles.length)throw Error('NO_UPWARD_SUPPORT_AT_DATUM');
 return {height,triangles,obstacles};
}
