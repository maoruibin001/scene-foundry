import {test,expect} from 'bun:test';
import seed from './native/diner-layout-seed.json';
import {validateReconstruction,resolveSupports} from './native/reconstruction-schema';
import {projectPoint,targetGeometry,wallOcclusion,observedBounds,projectedBounds,requireVisibleTargets} from './native/fitting';
import {bindWindowEmission} from './native/material-binding';
test('相机投影采用 Z 向上且两个参考视角的前方投影到画心',()=>{for(const c of seed.cameras){const p=projectPoint(c,c.target);expect(p[0]).toBeCloseTo(.5,9);expect(p[1]).toBeCloseTo(.5,9);expect(p[2]).toBeGreaterThan(0);}const c={position:[0,0,1],target:[0,5,1],verticalFov:1};expect(projectPoint(c,[1,5,1])[0]).toBeGreaterThan(.5);expect(projectPoint(c,[0,5,2])[1]).toBeLessThan(.5);});
test('墙洞具有独立身份并随墙体旋转，重复 ID 被拒绝',()=>{const l=structuredClone(seed);expect(()=>validateReconstruction(l)).not.toThrow();const w=l.architecture.find(n=>n.id==='window_wall_east')!,o=w.openings[0],g=targetGeometry(l,o.id);expect(g.position[0]).toBeCloseTo(w.position[0],5);expect(g.position[1]).toBeCloseTo(w.position[1]-o.offset,5);w.openings[0].id='arch_main';expect(()=>validateReconstruction(l)).toThrow('重复');});
test('桌上灯罩绑定桌面，父物体平移旋转后依然落在对应桌面',()=>{const l=structuredClone(seed),table=l.assets.find(a=>a.id==='booth_02')!,lamp=l.assets.find(a=>a.id==='fallen_lamp_table')!;table.position=[2,3,.1];table.rotation=Math.PI/2;(lamp as any).support.localPosition=[.5,.25,.865/1.26];lamp.position=[-10,-10,20];resolveSupports(l);expect(lamp.position[0]).toBeCloseTo(2-.25*table.size[1],8);expect(lamp.position[1]).toBeCloseTo(3+.5*table.size[0],8);expect(lamp.position[2]).toBeCloseTo(.1+table.size[2]*.865/1.26,8);(table as any).support={assetId:lamp.id,localPosition:[0,0,0]};expect(()=>resolveSupports(l)).toThrow('环');});
test('窗景使用当前 Engine 的纹理发光槽，绑定幂等且未知模板不静默略过',()=>{const source='baseColor: [...surface.baseColor],';const output=bindWindowEmission(source);expect(output).toContain('emissiveTexture:');expect(output).toContain('surfaceTextureKey(surface.baseColorTexture)');expect(bindWindowEmission(output)).toBe(output);expect(()=>bindWindowEmission('changed-template')).toThrow('模板变化');});

test('旋转墙体遮挡按门洞和拱顶检查，不能把墙后街机当作可见',()=>{const wall={id:'w',kind:'wall',position:[2,0,0],size:[6,.3,4],rotation:Math.PI/2,openings:[{offset:0,width:2,bottom:0,height:3,rise:.5}]},l={architecture:[wall]};expect(wallOcclusion(l,[0,0,1],[4,0,1])).toBeNull();expect(wallOcclusion(l,[0,2,1],[4,2,1])).toBe('w');expect(wallOcclusion(l,[0,.95,2.9],[4,.95,2.9])).toBe('w');expect(wallOcclusion(l,[0,0,1],[1,2,1])).toBeNull();});

test('原生桌面先分配支撑和净距：旋转卡座仍能避开灯罩，越界与塞满桌面拒绝生成',async()=>{
 const {resolveTabletopItems}=await import('./native/tabletop');
 const l=structuredClone(seed),table=l.assets.find(a=>a.id==='booth_02')!,lamp=l.assets.find(a=>a.id==='fallen_lamp_table')!;
 resolveSupports(l);resolveTabletopItems(l);expect((table as any).tableItemsPosition[1]).toBeLessThan(0);
 table.position=[-2,1,.2];table.rotation=-.61;resolveSupports(l);resolveTabletopItems(l);expect((table as any).tableItemsPosition[1]).toBeLessThan(0);
 (lamp as any).support.localPosition[0]=.3;resolveSupports(l);expect(()=>resolveTabletopItems(l)).toThrow('超出卡座桌面边界');
 (lamp as any).support.localPosition=[0,0,.865/1.26];lamp.size=[.98,1.9,.42];lamp.rotation=table.rotation;resolveSupports(l);expect(()=>resolveTabletopItems(l)).toThrow('没有可用净距');
});
test('挂画完整落在窗间实墙范围内',()=>{
 for(const art of seed.assets.filter(n=>n.kind==='picture')){const wall=seed.architecture.find(n=>n.id===(art as any).wallId)!;expect(wall).toBeDefined();const dx=art.position[0]-wall.position[0],dy=art.position[1]-wall.position[1],x=dx*Math.cos(wall.rotation)+dy*Math.sin(wall.rotation);
 for(const o of wall.openings)expect(Math.abs(x-o.offset)).toBeGreaterThan((art.size[0]+o.width)/2+.03);}
});
test('被画面截断的近端拱脚不能当作可见观察框的下边缘',()=>{
 const camera={referenceIndex:1,position:[-2,-6,1.6],target:[3,3,1.6],verticalFov:.82},node={position:[0,-.55,0],size:[9.6,.02,3.65],rotation:-Math.PI/2};
 const full=projectedBounds(camera,node),visible=observedBounds(camera,node,{kind:'arch'}),farFoot=projectPoint(camera,[0,4.25,0]);
 expect(full[3]).toBeGreaterThan(1);expect(visible[3]).toBeCloseTo(farFoot[1],8);expect(visible[3]).toBeLessThan(1);
 expect(observedBounds({...camera,referenceIndex:2},node,{kind:'arch'})).toEqual(projectedBounds({...camera,referenceIndex:2},node));
});
test('入口向前移动挡住第一机位时，布局被拒绝而不是继续导出评分',()=>{
 const layout=structuredClone(seed);expect(()=>requireVisibleTargets(layout)).not.toThrow();
 layout.architecture.find(n=>n.id==='entrance_wall')!.position[1]=-4.4;
 expect(()=>requireVisibleTargets(layout)).toThrow('被墙体遮挡');
});
