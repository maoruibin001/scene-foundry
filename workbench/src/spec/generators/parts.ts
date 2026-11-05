/**
 * 生成器共用的小构件:两点之间的圆杆 / 方钢、沿折线的管与线槽。原语只能轴向放置,
 * 这里先沿 +Y 放好再绕 Z(倾斜)、绕 Y(朝向)转到目标方向;每个构件标签唯一,只转它自己。
 */
import {sel,type Model} from '@forgeax/engine/modeling';

export type P3=[number,number,number];
let serial=0;
const unique=(label:string)=>`${label}-${++serial}`;

function orient(m:Model,label:string,a:P3,b:P3){
 const d=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],len=Math.hypot(...d),c:P3=[(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2];
 const theta=Math.acos(Math.max(-1,Math.min(1,d[1]/len)))*180/Math.PI,beta=Math.atan2(-d[2],d[0])*180/Math.PI;
 if(Math.abs(theta)>1e-6)m.rotate(sel.createdBy(label),'z',-theta,c);
 if(Math.abs(theta)>1e-6&&Math.abs(theta-180)>1e-6&&Math.abs(beta)>1e-6)m.rotate(sel.createdBy(label),'y',beta,c);
}
/** a→b 的圆杆,半径 r。 */
export function rod(m:Model,a:P3,b:P3,r:number,material:string,label='rod',segments=12){
 const len=Math.hypot(b[0]-a[0],b[1]-a[1],b[2]-a[2]);if(len<1e-4)return;const l=unique(label);
 m.cylinder({radiusTop:r,radiusBottom:r,height:len,radialSegments:segments,center:[(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2],material,label:l});orient(m,l,a,b);
}
/** a→b 的方钢,截面 w×h(h 在倾斜前的 Z 方向)。 */
export function bar(m:Model,a:P3,b:P3,w:number,h:number,material:string,label='bar'){
 const len=Math.hypot(b[0]-a[0],b[1]-a[1],b[2]-a[2]);if(len<1e-4)return;const l=unique(label);
 m.box({size:[w,len,h],center:[(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2],material,label:l});orient(m,l,a,b);
}
/** 折线管:直段圆杆 + 拐点球形弯头。 */
export function polyRod(m:Model,pts:P3[],r:number,material:string,joint:string=material,segments=14){
 for(let i=0;i+1<pts.length;i++)rod(m,pts[i],pts[i+1],r,material,'pipe',segments);
 for(let i=1;i+1<pts.length;i++)m.sphere({radius:r*1.04,widthSegments:segments,heightSegments:Math.max(4,segments/2),center:pts[i],material:joint,label:unique('elbow')});
}
/** 沿折线每隔 step 取点(含端点),用于支架、箍环。 */
export function along(pts:P3[],step:number):{p:P3;d:P3}[]{
 const out:{p:P3;d:P3}[]=[];
 for(let i=0;i+1<pts.length;i++){const a=pts[i],b=pts[i+1],d=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],len=Math.hypot(...d),n=Math.max(1,Math.floor(len/step));
  for(let k=i?1:0;k<=n;k++){const t=k/n;out.push({p:[a[0]+d[0]*t,a[1]+d[1]*t,a[2]+d[2]*t],d:d.map(x=>x/len) as P3});}}
 return out;
}
