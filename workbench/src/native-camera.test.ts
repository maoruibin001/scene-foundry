import {test,expect} from 'bun:test';
import {createCameraMotion,stepCamera,toggleCruise,type Motion} from './native/camera-motion';
const pose={position:[0,1.7,0],target:[0,2,-10]},idle:Motion={forward:0,side:0,up:0,yaw:0,pitch:0,fast:false};
test('持续前进五秒超过旧边界，松键停止并保持观察方向',()=>{
 const s=createCameraMotion(pose);
 for(let i=0;i<300;i++)stepCamera(s,{...idle,forward:1},1/60);
 expect(s.position[2]).toBeCloseTo(-8,8);expect(s.target[2]-s.position[2]).toBeCloseTo(-10,8);
 const stopped=structuredClone(s);for(let i=0;i<60;i++)stepCamera(s,idle,1/60);expect(s).toEqual(stopped);
});
test('斜向速度归一化，升降与加速生效，长帧不突然跃迁',()=>{
 const a=createCameraMotion(pose),b=createCameraMotion(pose),c=createCameraMotion(pose);
 stepCamera(a,{...idle,forward:1},.1);stepCamera(b,{...idle,forward:1,side:1},.1);stepCamera(c,{...idle,up:1,fast:true},10);
 expect(Math.hypot(b.position[0],b.position[2])).toBeCloseTo(Math.abs(a.position[2]),8);
 expect(c.position[1]-pose.position[1]).toBeCloseTo(.48,8);
});
test('向右转向后向右移动，俯仰不翻转且保留目标距离',()=>{
 const s=createCameraMotion(pose);stepCamera(s,{...idle,yaw:Math.PI/2,forward:1},.1);
 expect(s.position[0]).toBeCloseTo(.16,8);expect(s.position[2]).toBeCloseTo(0,8);
 stepCamera(s,{...idle,pitch:100},.1);const d=s.target.map((v,i)=>v-s.position[i]);
 expect(Math.hypot(...d)).toBeCloseTo(Math.hypot(10,.3),8);expect(d[1]).toBeGreaterThan(0);expect(Math.hypot(d[0],d[2])).toBeGreaterThan(.1);
});
test('巡航从当前位置开始，平移观察方向，手动操作立即停止',()=>{
 const s=createCameraMotion(pose);for(let i=0;i<100;i++)stepCamera(s,{...idle,side:1},.1);
 const p=[...s.position],d=s.target.map((v,i)=>v-s.position[i]);toggleCruise(s);stepCamera(s,idle,1/60);
 expect(Math.hypot(...s.position.map((v,i)=>v-p[i]))).toBeLessThan(.001);
 expect(s.target.map((v,i)=>v-s.position[i])).toEqual(d);
 const before=[...s.position];stepCamera(s,{...idle,up:1},.1);expect(s.running).toBe(false);expect(s.position[0]).toBe(before[0]);
 toggleCruise(s);toggleCruise(s);const stopped=structuredClone(s);stepCamera(s,idle,.1);expect(s).toEqual(stopped);
});
test('重新选择参考视角完全复位，不污染参考输入',()=>{
 const original=structuredClone(pose);let s=createCameraMotion(pose);stepCamera(s,{...idle,up:1,yaw:.5},.1);toggleCruise(s);
 s=createCameraMotion(pose);expect(s.position).toEqual(original.position);expect(s.target).toEqual(original.target);expect(s.running).toBe(false);expect(pose).toEqual(original);
});
