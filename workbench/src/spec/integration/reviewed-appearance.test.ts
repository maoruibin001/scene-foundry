import {test,expect} from 'bun:test';
import {sampleSpec} from '../fixtures';import {validateSceneSpec} from '../schema';import {specDigest} from '../continuation';import {reviewedAppearanceReceipt} from './reviewed-appearance';
test('reviewed appearance binds both immutable snapshots and retains every object',()=>{
 const base=sampleSpec(),result=structuredClone(base);result.materials[0].roughness=.37;
 const before=JSON.stringify(base),r=reviewedAppearanceReceipt(base,result,specDigest(result),'reviewed-r1');
 expect(r.baseSpecSha256).toBe(specDigest(base));expect(r.resultSpecSha256).toBe(specDigest(result));expect(r.changedObjects).toEqual([]);expect(r.retainedObjects).toEqual(base.objects.map(o=>o.id));expect(r.patches[0].target).toBe('material');expect(JSON.stringify(base)).toBe(before);
 expect(()=>reviewedAppearanceReceipt(base,result,'0'.repeat(64),'bad')).toThrow('DIGEST_MISMATCH');
});
test('appearance adoption refuses geometry, cameras and acceptance changes even with a matching result digest',()=>{
 for(const field of ['objects','shots','acceptance'] as const){const base=sampleSpec(),result=structuredClone(base);result.materials[0].roughness=.37;
  if(field==='objects')result.objects[0].notes='unrelated object edit';else if(field==='shots')result.shots[0].position[0]+=1;else result.acceptance[0].description+=' changed';
  validateSceneSpec(result);expect(()=>reviewedAppearanceReceipt(base,result,specDigest(result),'bad')).toThrow('NONVISUAL_CHANGE');
 }
});
