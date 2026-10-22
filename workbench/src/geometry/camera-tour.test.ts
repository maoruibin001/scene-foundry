import {test,expect} from 'bun:test';
import {cameraClearance,planCameraTour,segmentTriangleDistance,tourOcclusion,TOUR_LIMITS} from './camera-tour';
import {createCameraMotion,stepCamera,toggleCruise} from '../native/camera-motion';
const wall=(x:number,y0=-2,y1=2,z0=0,z1=3)=>({name:'thin_surface',geometry:{positions:[x,y0,z0,x,y1,z0,x,y1,z1,x,y0,z1],indices:[0,1,2,0,2,3]}});
const idle={forward:0,side:0,up:0,yaw:0,pitch:0,fast:false};
test('扫掠测距覆盖穿面、平行贴面、边缘及零长度路径',()=>{
 const a=[0,0,0],b=[2,0,0],c=[0,2,0];
 expect(segmentTriangleDistance([.2,.2,-1],[.2,.2,1],a,b,c)).toBe(0);
 expect(segmentTriangleDistance([.2,.2,.3],[.8,.2,.3],a,b,c)).toBeCloseTo(.3,8);
 expect(segmentTriangleDistance([-1,-1,0],[-1,1,0],a,b,c)).toBeCloseTo(1,8);
 expect(segmentTriangleDistance([3,0,0],[3,0,0],a,b,c)).toBeCloseTo(1,8);
 expect(segmentTriangleDistance([.2,.2,-1],[.2,.2,1],c,b,a)).toBe(0);
});
test('固定世界轴旧巡航穿过薄表面，新路径沿真实几何保留近裁面净空',()=>{
 const camera={position:[0,0,1.6],target:[-5,-3,1.4],fov:1.1},clear=cameraClearance([wall(.262)]);
 expect(clear(camera.position,[.35,.3,1.6],.18).safe).toBe(false);
 const plan=planCameraTour(camera,clear);expect(plan.status).toBe('ready');
 expect(Math.hypot(...plan.displacement)).toBeCloseTo(.5,8);
 expect(clear(plan.origin,plan.origin.map((v,i)=>v+plan.displacement[i]),plan.radius).safe).toBe(true);
});
test('使用三角形而非整块包围盒，不把真实洞口误判为实墙',()=>{
 const mesh=wall(0);mesh.geometry.positions=[0,-2,0,0,-.7,0,0,-.7,3,0,-2,3,0,.7,0,0,2,0,0,2,3,0,.7,3];mesh.geometry.indices=[0,1,2,0,2,3,4,5,6,4,6,7];
 const clear=cameraClearance([mesh]);expect(clear([-.4,0,1.6],[.4,0,1.6],.18).safe).toBe(true);
 expect(clear([-.4,.6,1.6],[.4,.6,1.6],.18).safe).toBe(false);
});
test('被包围或初始近裁面相交时明确阻止巡航，不以静止画面冒充移动',()=>{
 const camera={position:[0,0,1.6],target:[0,5,1.6],fov:1.1};
 const plan=planCameraTour(camera,cameraClearance([wall(.1)]));expect(plan.status).toBe('blocked');
 const s=createCameraMotion({...camera,cruise:plan});toggleCruise(s);stepCamera(s,idle,.1);expect(s.running).toBe(false);expect(s.position).toEqual(camera.position);expect(s.blockReason).toContain('近裁面');
});
test('巡航长期处于已验证线段，暂停恢复无跳变，自由移动后不能套用旧路径',()=>{
 const pose={position:[0,1.6,0],target:[0,1.6,-10],cruise:{status:'ready',origin:[0,1.6,0],displacement:[-.5,0,0]}};
 const s=createCameraMotion(pose);toggleCruise(s);
 for(let i=0;i<3000;i++){stepCamera(s,idle,.1);expect(s.position[0]).toBeGreaterThanOrEqual(-.500001);expect(s.position[0]).toBeLessThanOrEqual(.000001);}
 toggleCruise(s);const paused=[...s.position];toggleCruise(s);stepCamera(s,idle,0);expect(s.position).toEqual(paused);
 stepCamera(s,{...idle,forward:1},.1);const moved=[...s.position];toggleCruise(s);stepCamera(s,idle,.1);expect(s.position).toEqual(moved);expect(s.running).toBe(false);expect(s.blockReason).toContain('选择机位');
 expect(pose.position).toEqual([0,1.6,0]);
});

test('a tour end that lets a near pillar fill the frame gives way to a direction that keeps the view',()=>{
 // Study c1ba845b: the first reference camera toured right until the entry frame covered 25% of the frame instead of 8%.
 const quad=(name:string,x0:number,x1:number,y:number,z0:number,z1:number)=>({name,geometry:{positions:[x0,y,z0,x1,y,z0,x1,y,z1,x0,y,z1],indices:[0,1,2,0,2,3]}});
 const side=(name:string,x:number,y0:number,y1:number,z0:number,z1:number)=>({name,geometry:{positions:[x,y0,z0,x,y1,z0,x,y1,z1,x,y0,z1],indices:[0,1,2,0,2,3]}});
 const meshes=[quad('back__wall',-20,20,10,-5,10),side('pillar__post',.85,.4,4,0,3)],camera={position:[0,0,1.6],target:[0,10,1.6],fov:1};
 const clear=cameraClearance(meshes),occlusion=tourOcclusion(meshes);
 expect(planCameraTour(camera,clear).displacement[0]).toBeCloseTo(.5,6);
 expect(occlusion(camera,[.5,0,1.6]).rise).toBeGreaterThan(TOUR_LIMITS.coverageRise);
 const plan=planCameraTour(camera,clear,16/9,.1,occlusion);
 expect(plan.status).toBe('ready');expect(plan.coverageRise.rise).toBeLessThanOrEqual(TOUR_LIMITS.coverageRise);expect(plan.displacement[0]).toBeLessThan(.5);
 // Orthographic voxel views keep the first clear direction.
 expect(planCameraTour({...camera,projection:'orthographic'},clear,16/9,.1,occlusion).displacement[0]).toBeCloseTo(.5,6);
});
