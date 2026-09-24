export type Cruise={status:string;origin:number[];displacement:number[];reason?:string|null};
export type Pose={position:number[];target:number[];cruise?:Cruise};
export type Motion={forward:number;side:number;up:number;yaw:number;pitch:number;fast:boolean};
export type CameraMotion=Pose&{running:boolean;travel:number;origin:Pose;phase:number;blockReason?:string};
const copy=(p:Pose):Pose=>({position:[...p.position],target:[...p.target]});
export function createCameraMotion(p:Pose):CameraMotion{return {...copy(p),...(p.cruise?{cruise:{...p.cruise,origin:[...p.cruise.origin],displacement:[...p.cruise.displacement]}}:{}),running:false,travel:0,phase:0,origin:copy(p)};}
export function toggleCruise(s:CameraMotion){
 if(s.running){s.running=false;return;}
 s.blockReason=undefined;
 if(s.cruise){const c=s.cruise,den=c.displacement.reduce((n,v)=>n+v*v,0),t=den?s.position.reduce((n,v,i)=>n+(v-c.origin[i])*c.displacement[i],0)/den:0;
  const deviation=Math.hypot(...s.position.map((v,i)=>v-c.origin[i]-c.displacement[i]*t));
  if(c.status!=='ready'||den<1e-8){s.blockReason=c.reason??'没有可用的连续观测路径';return;}
  if(t<-.0001||t>1.0001||deviation>.0001){s.blockReason='已离开验证过的路径，请先选择机位再连续观测';return;}
  s.phase=Math.acos(1-2*Math.max(0,Math.min(1,t)));
 }
 s.running=true;s.travel=0;s.origin=copy(s);
}
/** 自由检查相机；参考构图只由显式复位恢复，不参与移动边界。 */
export function stepCamera(s:CameraMotion,m:Motion,delta:number){
 const dt=Math.max(0,Math.min(delta,.1));
 if(m.forward||m.side||m.up||m.yaw||m.pitch)s.running=false;
 if(s.running){
  s.travel+=dt;const a=s.travel*.08,offset=s.cruise?s.cruise.origin.map((v,i)=>v+s.cruise!.displacement[i]*(1-Math.cos(s.phase+s.travel*.14))/2-s.origin.position[i]):[Math.sin(a)*.35,0,Math.sin(a*.7)*.30];
  s.position=s.origin.position.map((v,i)=>v+offset[i]);
  s.target=s.origin.target.map((v,i)=>v+offset[i]);
 }
 const d=s.target.map((v,i)=>v-s.position[i]),length=Math.hypot(...d)||1;
 let yaw=Math.atan2(d[0],-d[2]),pitch=Math.asin(Math.max(-1,Math.min(1,d[1]/length)));
 yaw+=m.yaw;pitch=Math.max(-Math.PI/2+.02,Math.min(Math.PI/2-.02,pitch+m.pitch));
 const scale=1.6*(m.fast?3:1)*dt/Math.max(1,Math.hypot(m.forward,m.side,m.up));
 const move=[(Math.sin(yaw)*m.forward+Math.cos(yaw)*m.side)*scale,m.up*scale,(-Math.cos(yaw)*m.forward+Math.sin(yaw)*m.side)*scale];
 s.position=s.position.map((v,i)=>v+move[i]);
 if(m.yaw||m.pitch){
  const h=Math.cos(pitch)*length;
  s.target=[s.position[0]+Math.sin(yaw)*h,s.position[1]+Math.sin(pitch)*length,s.position[2]-Math.cos(yaw)*h];
 }else s.target=s.target.map((v,i)=>v+move[i]);
}
