import {test,expect} from 'bun:test';
import {project,ray,cameraRay,basis,rayScene,fitCamera,type Match} from './camera-fit';
import {alignmentSchema,ALIGNMENT_PROMPT,validateObservations} from './camera-alignment';
import {compileGeometryProgram} from './program';
const seed={position:[7,-8,3],target:[0,0,1.3],fov:1},target={position:[7.5,-7.6,3.1],target:[.3,.1,1.1],fov:1.08};
const points=Array.from({length:16},(_,i)=>[(i%4-1.5)*1.5,(Math.floor(i/4)-1.5)*1.4,.3+(i%3)*.9]);
const matches=(c=target):Match[]=>points.map((point,i)=>({label:'观测'+i,point,expected:project(c,point).slice(0,2),observed:project(seed,point).slice(0,2),confidence:.9,meshId:'part'+i}));
test('三维投影和反投影方向互逆，使用任意视角、宽高比和 Z 向上坐标',()=>{for(const c of [seed,target])for(const aspect of [1,16/9,.8])for(const p of points){const uv=project(c,p,aspect),r=ray(c,uv,aspect),d=p.map((v,k)=>v-c.position[k]),length=Math.hypot(...d);r.forEach((v,k)=>expect(v).toBeCloseTo(d[k]/length,8));}});
test('真实几何射线取近处可见表面，不把后方或背面当成命中',()=>{
 const p:any={version:'geometry-v1',name:'几何',materials:[{id:'m',color:[1,1,1,1],roughness:.5,metallic:0,textureId:null}],templates:[{id:'t',parts:[{id:'p',material:'m',position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],shape:{type:'box',size:[2,2,2],radius:0}}]}],instances:[{id:'near',label:'近',template:'t',position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],requirementIds:[]},{id:'far',label:'远',template:'t',position:[0,5,0],rotation:[0,0,0],scale:[1,1,1],requirementIds:[]}]};
 const cast=rayScene(compileGeometryProgram(p).meshes),hit=cast([0,-5,0],[0,1,0]);expect(hit?.point).toEqual([0,-1,0]);expect(hit?.meshId.startsWith('near')).toBe(true);expect(cast([0,-5,0],[0,-1,0])).toBeNull();
});
test('受限求解让未参加拟合的点也下降，原相机和观测不会被覆盖',()=>{
 const m=matches(),before=JSON.stringify({seed,m}),f=fitCamera(seed,m);expect(f.report.accepted).toBe(true);expect(f.report.heldOutCount).toBe(4);expect(f.report.after).toBeLessThan(f.report.before*.15);expect(f.report.validationAfter).toBeLessThan(f.report.validationBefore*.15);expect(JSON.stringify({seed,m})).toBe(before);
});
test('已对齐或留出点不一致时不伪称改善，不接受少量点求解',()=>{
 expect(fitCamera(seed,matches(seed)).report.accepted).toBe(false);expect(()=>fitCamera(seed,matches().slice(0,9))).toThrow('十个');
 const m=matches();for(let i=3;i<m.length;i+=4)m[i].expected=m[i].observed;expect(fitCamera(seed,m).report.accepted).toBe(false);
});
test('观测契约不裁掉内容、不接收虚构机位和重复标签，允许如实报告无可用点',()=>{
 const v:any={version:'camera-observations-v1',views:[{referenceIndex:1,contentRect:[0,0,1,1],points:[],uncertainty:'无法对应'}]};expect(validateObservations(v,1)).toBe(v);expect(()=>validateObservations(v,2)).toThrow('独立观测');v.views[0].contentRect=[0,.4,1,1];expect(()=>validateObservations(v,1)).toThrow('裁掉');v.views[0].contentRect=[0,0,1,1];const p={label:'一点',referenceUV:[.3,.4],renderUV:[.4,.5],confidence:.9};v.views[0].points=[p,p];expect(()=>validateObservations(v,1)).toThrow('身份');
 const walk=(s:any)=>{if(s.type==='object'){expect(s.additionalProperties).toBe(false);expect(s.required).toEqual(Object.keys(s.properties));Object.values(s.properties).forEach(walk)}if(s.items)walk(s.items)};walk(alignmentSchema());expect(ALIGNMENT_PROMPT).not.toContain('餐厅');expect(ALIGNMENT_PROMPT).toContain('全部说明使用中文');
});

test('正交投影不随深度缩放；任意Z向上机位的像素射线平行且可逆',()=>{
 const c={...seed,projection:'orthographic' as const,orthographicHeight:8};
 for(const aspect of [1,16/9,.8])for(const point of points){const uv=project(c,point,aspect),beam=cameraRay(c,uv,aspect);beam.direction.forEach((v,k)=>expect(v).toBeCloseTo(basis(c).forward[k],8));const restored=beam.origin.map((v,k)=>v+beam.direction[k]*uv[2]);restored.forEach((v,k)=>expect(v).toBeCloseTo(point[k],8));const deeper=point.map((v,k)=>v+beam.direction[k]*5);expect(project(c,deeper,aspect)[0]).toBeCloseTo(uv[0],8);expect(project(c,deeper,aspect)[1]).toBeCloseTo(uv[1],8);}
 expect(()=>project({...c,orthographicHeight:0},points[0])).toThrow('覆盖高度');
});
test('正交校准优化覆盖高度，保留投影类型与原始视场，不依赖透视FOV缩放',()=>{
 const c={...seed,projection:'orthographic' as const,orthographicHeight:8},target={...c,orthographicHeight:9};
 const ms:Match[]=points.map((point,i)=>({label:'观测'+i,point,expected:project(target,point).slice(0,2),observed:project(c,point).slice(0,2),confidence:.95,meshId:'part'+i}));
 const fitted=fitCamera(c,ms);expect(fitted.camera.projection).toBe('orthographic');expect(fitted.camera.fov).toBe(c.fov);expect(fitted.report.accepted).toBe(true);expect(fitted.report.validationAfter).toBeLessThan(fitted.report.validationBefore*.2);expect(c.orthographicHeight).toBe(8);
});
