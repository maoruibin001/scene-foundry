import {test,expect} from 'bun:test';
import {validateLighting,lightingSchema,spotEntities,directionalShadowFields,bindDirectionalShadow,type SceneLighting} from './lighting';
const base=():SceneLighting=>({direction:[0,0,-1],color:[1,1,1],intensity:1,ambientColor:[1,1,1],ambientIntensity:.2,points:[]});
const spot=()=>({position:[2,3,4],direction:[0,1,-1],color:[1,.8,.6],intensity:45,range:8,innerConeDeg:25,outerConeDeg:60,castShadow:true});
test('已有光照不变；真实坎德拉尺度不被归一化误限',()=>{
 const old=base();expect(validateLighting(old)).toBe(old);expect(spotEntities(old)).toEqual({});
 old.points=[spot()];old.spots=[spot()];expect(validateLighting(old)).toBe(old);
 expect(lightingSchema().properties.spots.maxItems).toBe(4);
});
test('局部光导出坐标、半角、强度和遮挡完整保留',()=>{
 const v=spotEntities({...base(),spots:[spot()]}).spotLight0.components;
 expect(v.Transform.pos).toEqual([2,4,-3]);expect(v.SpotLight.direction).toEqual([0,-1,-1]);
 expect(v.SpotLight.intensity).toBe(45);expect(v.SpotLight.innerConeDeg).toBe(25);expect(v.SpotLight.outerConeDeg).toBe(60);expect(v.SpotLight.castShadow).toBe(true);expect(v.SpotLight.farPlane).toBe(8);
});
test('拒绝退化方向、错误锥角、非有限强度以及超出真实阴影容量',()=>{
 for(const change of [{direction:[0,0,0]},{outerConeDeg:25},{innerConeDeg:-1},{outerConeDeg:91},{intensity:NaN},{intensity:Infinity},{intensity:10001},{range:0},{castShadow:undefined}])expect(()=>validateLighting({...base(),spots:[{...spot(),...change} as any]})).toThrow();
 expect(()=>validateLighting({...base(),spots:Array.from({length:5},spot)})).toThrow('数量超限');
});

test('PCSS映射真实Engine字段，保留原场景默认值与有界质量参数',()=>{const s:SceneLighting={...base(),directionalShadow:{filter:'pcssHigh',angularRadius:.008,maxPenumbraTexels:32,mapSize:2048}};expect(directionalShadowFields(s)).toEqual({shadowFilter:5,shadowAngularRadius:.008,maxPenumbraTexels:32,mapSize:2048});expect(directionalShadowFields(base())).toEqual({shadowFilter:2,mapSize:1024});const world='DirectionalLight:{shadowDistance:65,mapSize:1024,cascadeCount:3,shadowFilter:2}';expect(bindDirectionalShadow(world,base())).toBe(world);expect(bindDirectionalShadow(world,s)).toContain('shadowAngularRadius:0.008');expect(()=>bindDirectionalShadow('bad-template',s)).toThrow('契约变化');});
test('非法PCSS参数不能进入生成，局部光不能冒充支持方向光软阴影',()=>{const good={filter:'pcssMedium',angularRadius:.00465,maxPenumbraTexels:32,mapSize:1024};for(const changes of [{filter:'area-light'},{angularRadius:0},{angularRadius:.1},{maxPenumbraTexels:65},{maxPenumbraTexels:1.5},{mapSize:8192}])expect(()=>validateLighting({...base(),directionalShadow:{...good,...changes} as any})).toThrow('阴影参数');expect(spotEntities({...base(),spots:[spot()],directionalShadow:good as any}).spotLight0.components.SpotLight.pcfKernelSize).toBe(3);});
