import {test,expect} from 'bun:test';
import {referenceImageIds,generationInput,batchCase} from './reference-input';
import {inputKey} from './versions';
const a='a'.repeat(64),b='b'.repeat(64),c='c'.repeat(64);
test('重试与重建保留全部参考图顺序、文字和复杂度',()=>{
 const job={prompt:'按三张图还原同一空间',image:{id:a},images:[{id:b},{id:a},{id:c}],complexity:'complex'};
 expect(generationInput(job)).toEqual({prompt:job.prompt,imageIds:[b,a,c],complexity:'complex'});
 expect(referenceImageIds(generationInput(job))).toEqual([b,a,c]);
});
test('固定评测案例完整保留多图，不退化成首图评测',()=>{
 const parsed={prompt:'还原',images:[{id:a},{id:b}],image:{id:a},complexity:'complex',mode:'image_prompt'};
 const row=batchCase('indoor',parsed);expect(referenceImageIds(row)).toEqual([a,b]);
 expect(inputKey({...parsed,images:[{id:a},{id:b}]})).not.toBe(inputKey({...parsed,images:[{id:b},{id:a}]}));
});
test('旧单图记录可读，明确空图列表不被旧字段覆盖',()=>{
 expect(referenceImageIds({imageId:a})).toEqual([a]);expect(referenceImageIds({image:{id:b}})).toEqual([b]);
 expect(referenceImageIds({imageIds:[],imageId:a})).toEqual([]);expect(referenceImageIds({})).toEqual([]);
});
test('重复、超量及非法引用在调用模型前拒绝',()=>{
 for(const imageIds of [[a,a],[a,b,c,'d'.repeat(64),'e'.repeat(64),'f'.repeat(64)],['../secret'],[null],'wrong'])expect(()=>referenceImageIds({imageIds})).toThrow();
});
