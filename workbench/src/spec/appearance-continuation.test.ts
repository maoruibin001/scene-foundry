import {test,expect} from 'bun:test';
import {sampleSpec} from './fixtures';
import {applyAppearanceRevision} from './appearance-continuation';
test('appearance changes retain exact geometry, transforms and shots, and preserve the original spec',()=>{
 const spec=sampleSpec();spec.sourceEnvironment={entities:{sun:{components:{DirectionalLight:{intensity:2}}}},camera:{exposure:1}};const before=JSON.stringify(spec);
 const r=applyAppearanceRevision(spec,{id:'r1',summary:'Improve actual material and lighting evidence',patches:[{target:'sourceLightingMode',id:'*',set:{lightingMode:'spec'},reason:'Use the explicit light state instead of native imported lighting'},{target:'material',id:'steel',set:{surface:{pattern:'plate',tilesPerMeter:.5},roughness:.32},reason:'Source has no surface maps'}]});
 expect(JSON.stringify(spec)).toBe(before);expect(r.spec.objects).toEqual(spec.objects);expect(r.spec.shots).toEqual(spec.shots);expect(r.spec.sourceEnvironment?.lightingMode).toBe('spec');expect(r.receipt.changedObjects).toEqual([]);
});
test('an appearance model cannot move geometry, rewrite unrelated state fields or obscure defects with dense fog',()=>{
 const s=sampleSpec();expect(()=>applyAppearanceRevision(s,{id:'bad',summary:'bad',patches:[{target:'object',id:'CORE_001',set:{transform:{position:[0,0,1]}},reason:'move'}]})).toThrow('OUT_OF_SCOPE');
 expect(()=>applyAppearanceRevision(s,{id:'bad',summary:'bad',patches:[{target:'state',id:'*',set:{lights:[]},reason:'clear lighting'}]})).toThrow('OUT_OF_SCOPE');
 expect(()=>applyAppearanceRevision(s,{id:'bad',summary:'bad',patches:[{target:'post',id:'*',set:{fog:{color:[.1,.2,.3],density:.004,anisotropy:.5,boundsMin:[-20,-20,0],boundsMax:[20,20,20],light:'key'},volumetric:{extinction:.1,albedo:[.7,.8,.9],anisotropy:.5,heightFalloff:.01,noise:.1,maxDistance:80}},reason:'fake fog'}]})).toThrow('FOG_TOO_DENSE');
});
