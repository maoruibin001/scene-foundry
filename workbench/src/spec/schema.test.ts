import {test,expect} from 'bun:test';
import {sceneSpecErrors,validateSceneSpec} from './schema';
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
