import type {Pose} from './program';
import type {V} from './mesh';

export type Distribution={count:number;seed:number;volume:'box'|'ellipsoid';size:V;rotationRange:V;scaleRange:[number,number]};

/** 固定种子的均匀体积分布；只产生姿态，不依赖物体名称、场景或运行时间。 */
export function* distributedPoses(s:Distribution):Generator<Pose>{
 let state=s.seed>>>0;
 const random=()=>{state=(state+0x6d2b79f5)>>>0;let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};
 for(let i=0;i<s.count;i++){
  let unit:V;
  if(s.volume==='box')unit=[random()*2-1,random()*2-1,random()*2-1];
  else{const z=random()*2-1,angle=random()*Math.PI*2,r=Math.cbrt(random()),h=Math.sqrt(Math.max(0,1-z*z));unit=[r*h*Math.cos(angle),r*h*Math.sin(angle),r*z];}
  const scale=s.scaleRange[0]+random()*(s.scaleRange[1]-s.scaleRange[0]);
  yield {position:unit.map((v,k)=>v*s.size[k]/2) as V,rotation:s.rotationRange.map(v=>(random()*2-1)*v) as V,scale:[scale,scale,scale]};
 }
}
