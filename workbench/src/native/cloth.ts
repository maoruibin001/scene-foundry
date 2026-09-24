import {cross,norm,sub,type V} from './mesh';
import {TABLE_SURFACE} from './tabletop';

// 连续布面；木桌顶面为 .85 米。承重物下方压平，周围有褶皱及自由垂边。
export function clothPoint(u:number,v:number,w:number,d:number,contacts:number[][]=[]):V{
 const px=(u*2-1)*(w/2+.32),py=(v*2-1)*(d/2+.28);
 const ex=Math.max(0,Math.abs(px)-w/2),ey=Math.max(0,Math.abs(py)-d/2);
 const sx=Math.sign(px),sy=Math.sign(py);
 const x=ex?sx*(w/2+.012+ex*.07+.014*Math.sin(py*31+1.1)*Math.min(1,ex/.07)):px;
 const y=ey?sy*(d/2+.012+ey*.07+.014*Math.sin(px*28+.3)*Math.min(1,ey/.07)):py;
 let free=1;
 for(const [x0,y0,x1,y1] of contacts){const distance=Math.hypot(Math.max(x0-px,0,px-x1),Math.max(y0-py,0,py-y1));free*=Math.min(1,distance/.12);}
 const ridge=(t:number,s:number)=>Math.exp(-(t*t)/(s*s));
 const folds=.09*ridge(px+.20*py+.11,.11)+.075*ridge(px-.15*py-.27,.10)+.055*ridge(py+.31*px-.32,.075)+.020*(1+Math.sin(px*23+py*11))*.5;
 const z=TABLE_SURFACE-Math.hypot(ex,ey)*1.25+free*folds;
 return [x,y,z];
}
export function clothNormal(u:number,v:number,w:number,d:number,contacts:number[][]=[]):V{
 const e=.0001;
 return norm(cross(sub(clothPoint(u+e,v,w,d,contacts),clothPoint(u-e,v,w,d,contacts)),sub(clothPoint(u,v+e,w,d,contacts),clothPoint(u,v-e,w,d,contacts))));
}
