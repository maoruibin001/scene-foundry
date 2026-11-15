import {test,expect} from 'bun:test';
import {SPEC_LIMITS,sceneSpecErrors,validateSceneSpec} from './schema';
import {sampleSpec} from './fixtures';
export {sampleSpec};


test('合法规格通过',()=>{expect(sceneSpecErrors(sampleSpec())).toEqual([]);expect(()=>validateSceneSpec(sampleSpec())).not.toThrow();});

test('引用、ID、范围、灯光规则全部被检出',()=>{
 const s=sampleSpec() as any;
 s.objects.push({...s.objects[0]});                       // 重复 ID
 s.objects[0].family='NOPE';                              // 不存在的族
 s.families[0].materialSlots={shell:'missing'};           // 不存在的材质
 s.objects[0].transform.position=[0,0,500];               // 超范围
 s.lighting.states[0].lights.push({...s.lighting.states[0].lights[0],id:'key2'}); // 两盏方向光
 s.lighting.states[0].post.fog={color:[1,1,1],density:0.1,anisotropy:0,boundsMin:[-1,-1,-1],boundsMax:[1,1,1],light:'ghost'};
 s.acceptance[0].object='ghost';
 const errors=sceneSpecErrors(s).join('\n');
 for(const fragment of ['对象 ID 重复','不存在的资产族 NOPE','不存在的材质 missing','transform 无效','最多一盏方向光','fog 无效','position 无效'])expect(errors).toContain(fragment);
});

test('父子成环与面光投影被拒',()=>{
 const s=sampleSpec() as any;
 s.objects.push({...s.objects[0],id:'A',parent:'B'},{...s.objects[0],id:'B',parent:'A'});
 s.lighting.states[0].lights.push({id:'panel',kind:'area',position:[0,0,10],direction:[0,0,-1],color:[1,1,1],intensity:5,range:20,innerConeDeg:null,outerConeDeg:null,width:2,height:1,castShadow:true});
 const errors=sceneSpecErrors(s).join('\n');
 expect(errors).toContain('成环');expect(errors).toContain('面光不投影');
});

test('validateSceneSpec 汇总报错',()=>{expect(()=>validateSceneSpec({version:'x'})).toThrow('SCENE_SPEC_INVALID');});

test('trim 表面纹样与可选 decals 向后兼容及合法校验通过',()=>{
 const s=sampleSpec();
 expect(s.decals).toBeUndefined();
 s.materials[0]!.surface={pattern:'trim',tilesPerMeter:1};
 expect(sceneSpecErrors(s)).toEqual([]);
 s.decals=[
  {id:'DEC_STENCIL_01',label:'分区喷字',kind:'stencil',text:'SECTOR 01',color:[0.9,0.75,0.2],position:[0,-10,0.02],rotationDeg:[0,0,0],size:[3.2,0.8,0.25],opacity:0.92,roughness:0.7},
  {id:'DEC_HAZARD_01',label:'警戒斜纹',kind:'hazard',position:[4,-8,0.02],rotationDeg:[0,0,90],size:[4,0.6,0.2]},
  {id:'DEC_PUDDLE_01',label:'积水',kind:'puddle',position:[-3,-6,0.02],rotationDeg:[0,0,15],size:[2.5,2.0,0.2],roughness:0.03},
 ];
 expect(sceneSpecErrors(s)).toEqual([]);
});

test('decals 非法字段、过薄投影盒与超上限全部被检出',()=>{
 const s=sampleSpec() as any;
 s.decals=[
  {id:'DEC_01',label:'过薄贴花',kind:'stencil',text:'',color:[2,0,0],position:[0,0,0],rotationDeg:[0,0,0],size:[2,1,0.01],opacity:1.5,roughness:-0.1},
  {id:'DEC_01',label:'重复且坏类型',kind:'graffiti',position:[0,0,0],rotationDeg:[0,0,720],size:[1,1,0.2]},
 ];
 const errors=sceneSpecErrors(s).join('\n');
 for(const fragment of ['贴花 ID 重复:DEC_01','text 无效','color 须为线性 RGB 0..1','size 各分量须在 0.05','opacity 须在 0.01..1','roughness 须在 0..1','kind 须为 stencil/hazard/puddle','rotationDeg 须在 -360..360'])
  expect(errors).toContain(fragment);

 const tooMany=sampleSpec();
 tooMany.decals=Array.from({length:SPEC_LIMITS.decals+1},(_,i)=>({id:`D_${i}`,label:`D${i}`,kind:'puddle' as const,position:[0,0,0.02] as [number,number,number],rotationDeg:[0,0,0] as [number,number,number],size:[1,1,0.2] as [number,number,number]}));
 expect(sceneSpecErrors(tooMany).join('\n')).toContain(`decals 超过上限 ${SPEC_LIMITS.decals}`);
});

test('ambient.groundColor 半球反弹颜色可选及越界校验',()=>{
 const s=sampleSpec();
 s.lighting.states[0]!.ambient.groundColor=[0.24,0.30,0.40];
 expect(sceneSpecErrors(s)).toEqual([]);
 s.lighting.states[0]!.ambient.groundColor=null;
 expect(sceneSpecErrors(s)).toEqual([]);
 (s.lighting.states[0]!.ambient as any).groundColor=[0.2,1.5,-0.1];
 expect(sceneSpecErrors(s).join('\n')).toContain('ambient 无效');
});
