/**
 * 生成器共用的小构件:两点之间的圆杆 / 方钢、沿折线的管与线槽。原语只能轴向放置,
 * 这里先沿 +Y 放好再绕 Z(倾斜)、绕 Y(朝向)转到目标方向;每个构件标签唯一,只转它自己。
 */
import {model,sel,type Model} from '@forgeax/engine/modeling';

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
/**
 * 基于 m.pipeNetwork 的工业圆角弯管(端头配法兰箍环):
 * 当折线段长与拐角满足 CAD 弯头几何约束时生成全四边圆弧弯管;过短/共线退化/急折角时无损回退到 polyRod。
 */
export function pipeRun(m:Model,pts:P3[],r:number,material:string,joint:string=material,segments=14):boolean{
 if(pts.length<2||!(r>0))return false;
 const dedup:P3[]=[pts[0]!];
 for(let i=1;i<pts.length;i++){
  const prev=dedup[dedup.length-1]!,cur=pts[i]!;
  if(Math.hypot(cur[0]-prev[0],cur[1]-prev[1],cur[2]-prev[2])>=1e-4)dedup.push(cur);
 }
 if(dedup.length<2)return false;
 // 合并严格共线的中间点,避免向 pipeNetwork 传入 0° 冗余二价节点
 const clean:P3[]=[dedup[0]!];
 for(let i=1;i+1<dedup.length;i++){
  const a=clean[clean.length-1]!,b=dedup[i]!,c=dedup[i+1]!;
  const u1=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],l1=Math.hypot(...u1);
  const u2=[c[0]-b[0],c[1]-b[1],c[2]-b[2]],l2=Math.hypot(...u2);
  const dot=(u1[0]*u2[0]+u1[1]*u2[1]+u1[2]*u2[2])/(l1*l2||1);
  if(dot<=0.9994)clean.push(b);
 }
 clean.push(dedup[dedup.length-1]!);

 if(r>=2e-4&&clean.length>=2){
  const edgeLen:number[]=[];
  for(let i=0;i+1<clean.length;i++){
   const a=clean[i]!,b=clean[i+1]!;
   edgeLen.push(Math.hypot(b[0]-a[0],b[1]-a[1],b[2]-a[2]));
  }
  const tanHalf=new Array<number>(clean.length).fill(0);
  let feasible=true;
  for(let i=1;i+1<clean.length;i++){
   const p0=clean[i-1]!,p1=clean[i]!,p2=clean[i+1]!;
   const l0=edgeLen[i-1]!,l1=edgeLen[i]!;
   const uIn=[(p1[0]-p0[0])/l0,(p1[1]-p0[1])/l0,(p1[2]-p0[2])/l0];
   const uOut=[(p2[0]-p1[0])/l1,(p2[1]-p1[1])/l1,(p2[2]-p1[2])/l1];
   // 两分支夹角余弦 dot(-uIn, uOut) > cos(16°) 时分支过近
   const branchCos=-(uIn[0]*uOut[0]+uIn[1]*uOut[1]+uIn[2]*uOut[2]);
   if(branchCos>0.96){feasible=false;break;}
   const turnCos=Math.max(-1,Math.min(1,-branchCos));
   tanHalf[i]=Math.tan(Math.acos(turnCos)/2);
  }
  let bendRadius=r*2.1;
  if(feasible){
   const minStub=3.5*r;
   for(let e=0;e<edgeLen.length;e++){
    const L=edgeLen[e]!;
    if(L<=minStub){feasible=false;break;}
    const th=tanHalf[e]!+tanHalf[e+1]!;
    if(th>1e-5)bendRadius=Math.min(bendRadius,(L-minStub)/th*0.92);
   }
   if(clean.length>=3&&bendRadius<1.28*r)feasible=false;
  }
  if(feasible){
   const sub=model();
   const edges=clean.slice(0,-1).map((_,i)=>[i,i+1] as const);
   const ringSegments=Math.max(6,Math.min(24,Math.round(segments/2)*2));
   const rep=sub.pipeNetwork({
    nodes:clean,
    edges,
    radius:r,
    ringSegments,
    strutSegments:2,
    levels:1,
    ...(clean.length>=3?{bend:{radius:bendRadius}}:{}),
   });
   if(rep.status==='ok'&&sub.poisoned===undefined){
    sub.assign(sel.all(),material);
    m.append(sub,{label:unique('pipe-net')});
    const collarSegs=Math.max(12,segments);
    const pStart=clean[0]!,pNext=clean[1]!,lStart=edgeLen[0]!;
    const cStart=Math.min(r*0.55,lStart*0.18);
    rod(m,pStart,[pStart[0]+(pNext[0]-pStart[0])/lStart*cStart,pStart[1]+(pNext[1]-pStart[1])/lStart*cStart,pStart[2]+(pNext[2]-pStart[2])/lStart*cStart],r*1.32,joint,'pipe-collar',collarSegs);
    const last=clean.length-1,pEnd=clean[last]!,pPrev=clean[last-1]!,lEnd=edgeLen[last-1]!;
    const cEnd=Math.min(r*0.55,lEnd*0.18);
    rod(m,pEnd,[pEnd[0]+(pPrev[0]-pEnd[0])/lEnd*cEnd,pEnd[1]+(pPrev[1]-pEnd[1])/lEnd*cEnd,pEnd[2]+(pPrev[2]-pEnd[2])/lEnd*cEnd],r*1.32,joint,'pipe-collar',collarSegs);
    return true;
   }
  }
 }
 polyRod(m,pts,r,material,joint,segments);
 return false;
}
/** 沿折线每隔 step 取点(含端点),用于支架、箍环。 */
export function along(pts:P3[],step:number):{p:P3;d:P3}[]{
 const out:{p:P3;d:P3}[]=[];
 for(let i=0;i+1<pts.length;i++){const a=pts[i],b=pts[i+1],d=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],len=Math.hypot(...d),n=Math.max(1,Math.floor(len/step));
  for(let k=i?1:0;k<=n;k++){const t=k/n;out.push({p:[a[0]+d[0]*t,a[1]+d[1]*t,a[2]+d[2]*t],d:d.map(x=>x/len) as P3});}}
 return out;
}
