import {test,expect} from 'bun:test';
import {sampleSpec} from './fixtures';import {continueSpec,specDigest,validateContinuationReceipt} from './continuation';
test('continues a frozen baseline; material-only revisions preserve all geometry and source bytes',()=>{
 const s=sampleSpec(),before=JSON.stringify(s);const r=continueSpec(s,{baseSpecSha256:specDigest(s),revision:{id:'material-r1',summary:'controlled material edit',patches:[{target:'material',id:s.materials[0].id,set:{roughness:.4},reason:'Owner requests a controlled appearance improvement'}]}});
 expect(JSON.stringify(s)).toBe(before);expect(r.spec.objects).toEqual(s.objects);expect(r.receipt.changedObjects).toEqual([]);expect(r.receipt.baseSpecSha256).toBe(specDigest(s));expect(r.receipt.resultSpecSha256).not.toBe(specDigest(s));
 expect(()=>continueSpec(s,{baseSpecSha256:'0'.repeat(64),revision:{id:'stale',summary:'',patches:[]}})).toThrow('STALE_SOURCE_SCENE');
 expect(()=>continueSpec(s,{baseSpecSha256:specDigest(s),revision:{id:'move',summary:'',patches:[{target:'object',id:s.objects[0].id,set:{transform:{position:[0,0,0]}},reason:'try'}]}})).toThrow('master');
});

test('replacement geometry keeps source placement and every unrelated object immutable',()=>{
 const s=sampleSpec();s.objects[0].sourceMesh={metadata:'m.json',binary:'m.bin',metadataSha256:'1'.repeat(64),binarySha256:'2'.repeat(64),slots:{shell:s.materials[0].id}};
 const before=structuredClone(s.objects[0]);
 const r=continueSpec(s,{baseSpecSha256:specDigest(s),revision:{id:'replace-source',summary:'Owner-authorized source replacement',patches:[{target:'replaceGeometry',id:s.objects[0].id,set:{geometryBinding:{id:'GEN-ENTRY-01',params:{openFraction:1,includeVestibule:false},basis:'design_fill',reason:'Owner requested an open technological gate'}},reason:'Owner requested replacement of the obstacle'}]}});
 expect(r.spec.objects[0].sourceMesh).toBeUndefined();expect(r.spec.objects[0].transform).toEqual(before.transform);expect(s.objects[0].sourceMesh).toEqual(before.sourceMesh);expect(r.receipt.changedObjects).toEqual([before.id]);
});

test('continuation receipt binds both source and result digests',()=>{
 const b=sampleSpec(),r=continueSpec(b,{baseSpecSha256:specDigest(b),revision:{id:'r1',summary:'no edit',patches:[]}});
 expect(validateContinuationReceipt(b,r.spec,r.receipt)).toBe(true);
 expect(()=>validateContinuationReceipt(b,r.spec,{...r.receipt,resultSpecSha256:'0'.repeat(64)})).toThrow('INVALID_SCENE_CONTINUATION_RECEIPT');
});

test('repeated valid continuations retain bounded provenance and explicit parent receipts',()=>{
 let s=sampleSpec();s.provenance.method='x'.repeat(200);const original=JSON.stringify(s);
 for(let i=0;i<30;i++){const base=specDigest(s),r=continueSpec(s,{baseSpecSha256:base,revision:{id:'long-revision-'+i,summary:'no geometry change',patches:[]}});expect(r.spec.provenance.method.length).toBeLessThanOrEqual(200);expect(r.spec.provenance.method).toContain(base);expect(validateContinuationReceipt(s,r.spec,r.receipt)).toBe(true);s=r.spec;}
 expect(s.objects).toEqual(JSON.parse(original).objects);
});
