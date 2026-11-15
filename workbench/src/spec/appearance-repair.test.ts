import {test,expect} from 'bun:test';
import {sampleSpec} from './fixtures';
import {applyAppearanceRepair} from './appearance-repair';
import {planSpecExport,writeSpecPack} from './export-pack';
import {mkdtempSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const answer=(patches:any[])=>({observations:[{imageIndex:0,description:'可见金属表面高光破碎，暗部欠缺层次'}],summary:'修正材质',patches});
const patch=(target:string,values:any)=>({target,id:'steel',state:null,valuesJson:JSON.stringify(values),reason:'根据可见高光异常降低微表面法线强度，保留所有几何'});
test('视觉修正保留几何和要求，仅更改有依据的材质字段',()=>{
 const s=sampleSpec(),r=applyAppearanceRepair(s,answer([patch('material',{roughness:.2,surface:{pattern:'worn',tilesPerMeter:.5,normalStrength:.1}})]),1);
 expect(r.spec.objects).toEqual(s.objects);expect(r.spec.acceptance).toEqual(s.acceptance);expect(s.materials[0].roughness).toBe(.3);expect(r.spec.materials[0].roughness).toBe(.2);expect(r.receipt.decisions[0].basis).toBe('design_fill');
});
test('不能用视觉补丁改对象、数量、材质ID、原包络或不看图给结论',()=>{
 for(const p of [patch('object',{transform:{}}),patch('material',{id:'fake'}),patch('material',{roughness:-1})])expect(()=>applyAppearanceRepair(sampleSpec(),answer([p]),1)).toThrow();
 expect(()=>applyAppearanceRepair(sampleSpec(),answer([]),2)).toThrow('PIXELS_UNVERIFIED');
});
test('程序化材质法线强度实际传到烘焙材质；null保持光滑，零强度不会被默认值覆盖',()=>{
 const s=sampleSpec();s.materials[0].surface={pattern:'worn',tilesPerMeter:1,normalStrength:0};let p=planSpecExport(s);expect(p.materials[0].surface?.normalStrength).toBe(0);
 const d=mkdtempSync(join(tmpdir(),'look-pack-'));writeSpecPack(s,p,d,{packageId:'019fb7ce-6100-7000-8000-000000000000',sourceKey:'scene/test',name:'test'});expect(readFileSync(join(d,'spec.pack.ts'),'utf8')).toContain('normalScale:');
 s.materials[0].surface=null;p=planSpecExport(s);expect(p.materials[0].surface).toBeUndefined();
});
