import {test,expect} from 'bun:test';
import {buildPairwiseRequest,normalizePairwise,validatePairwise,pairwiseSchema,PAIRWISE_DIMENSIONS,PAIRWISE_COMPARE} from './pairwise-compare';
import {modelSchema} from '../model-schema';

const ref=[{path:'r1',mime:'image/jpeg'}],A=[{path:'a1',mime:'image/png'}],B=[{path:'b1',mime:'image/png'}];

test('scene-pairwise 角色返回两两对比 schema，含五个维度与 A/B/tie',()=>{
 const s=modelSchema('scene-pairwise',{});
 expect(s).toEqual(pairwiseSchema());
 expect(s.properties.overall.properties.winner.enum).toEqual(['A','B','tie']);
 expect(s.properties.dimensions.items.properties.id.enum).toEqual([...PAIRWISE_DIMENSIONS]);
});

test('请求图片顺序：原图在前，然后甲帧，再乙帧；order=ba 交换甲乙位置',()=>{
 const ab=buildPairwiseRequest({modelSettings:{},referenceImages:ref,aFrames:A,bFrames:B});
 expect(ab.role).toBe('scene-pairwise');
 expect(ab.images).toEqual([...ref,...A,...B]);
 const ba=buildPairwiseRequest({modelSettings:{},referenceImages:ref,aFrames:A,bFrames:B,order:'ba'});
 expect(ba.images).toEqual([...ref,...B,...A]);
});

test('归一化把模型看到的 A/B 映射回真实候选；order=ba 时翻转以抵消位置偏差',()=>{
 // Model (seeing frames in given order) says A wins overall, material B wins.
 const raw={overall:{winner:'A',reason:'o'},dimensions:[{id:'material',winner:'B',reason:'m',frames:[]}],summary:'s'};
 const ab=normalizePairwise(raw,'ab');
 expect(ab.overall.winner).toBe('A');
 expect(ab.dimensions[0].winner).toBe('B');
 // With order 'ba', real candidates were swapped, so winners flip back.
 const ba=normalizePairwise(raw,'ba');
 expect(ba.version).toBe(PAIRWISE_COMPARE);
 expect(ba.overall.winner).toBe('B');
 expect(ba.dimensions[0].winner).toBe('A');
 expect(normalizePairwise({overall:{winner:'tie',reason:'x'},dimensions:[]},'ba').overall.winner).toBe('tie');
});

test('校验器要求总体结论与全部五个维度',()=>{
 const good={overall:{winner:'A',reason:'r'},dimensions:PAIRWISE_DIMENSIONS.map(id=>({id,winner:'tie',reason:'r',frames:[]})),summary:'s'};
 expect(validatePairwise(good)).toBe(good);
 expect(()=>validatePairwise({overall:{winner:'A',reason:'r'},dimensions:[{id:'material',winner:'A',reason:'r',frames:[]}],summary:'s'})).toThrow('缺少维度');
 expect(()=>validatePairwise({dimensions:[],summary:'s'})).toThrow('总体');
 expect(()=>validatePairwise(null)).toThrow('无效');
});
