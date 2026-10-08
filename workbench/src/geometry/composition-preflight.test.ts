import {test,expect} from 'bun:test';
import {spatialGate,COMPOSITION_PREFLIGHT_PROMPT} from './blockout';
const policy={spatialPreflight:'composition-v3'},space={spatialRelations:[{id:'geometry',critical:true},{id:'light',critical:true}]},frames=['reference-1.png'];
const review={score:3.5,confidence:.6,relations:[{id:'geometry',score:3,verdict:'partial',reason:'局部占幅偏差',frames},{id:'light',score:3,verdict:'uncertain',reason:'灰模不验证反射及照明',frames}]};
test('构图门槛拦截明显不足但不把灰模当完整视觉验收',()=>{
 expect(spatialGate(review,space,frames,policy)).toMatchObject({passed:true,protocol:'spatial-composition-v3',threshold:{space:3.5,critical:3,confidence:.6}});
 expect(spatialGate({...review,score:3},space,frames,policy).passed).toBe(false);
 expect(spatialGate({...review,score:4.5,relations:[{...review.relations[0],score:2.5},review.relations[1]]},space,frames,policy).failed).toEqual(['geometry']);
 expect(spatialGate({...review,score:4.5,relations:[{...review.relations[0],verdict:'missing'},review.relations[1]]},space,frames,policy).passed).toBe(false);
 expect(spatialGate({...review,confidence:.59},space,frames,policy).passed).toBe(false);
 expect(COMPOSITION_PREFLIGHT_PROMPT).toContain('不评纹理');
});
test('旧策略及无效证据仍按原契约处理',()=>{
 expect(spatialGate({...review,score:3},space,frames,{spatialPreflight:'coarse-v2'}).passed).toBe(true);
 expect(spatialGate(review,space,frames).passed).toBe(false);
 expect(()=>spatialGate({...review,relations:[{...review.relations[0],frames:['invented.png']},review.relations[1]]},space,frames,policy)).toThrow('截图证据');
 expect(()=>spatialGate({...review,relations:[review.relations[0]]},space,frames,policy)).toThrow('不完整');
});
