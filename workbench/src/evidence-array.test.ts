import {test,expect} from 'bun:test';
import {evidenceSpans,validateGroundedPlan} from './grounding';
import {modelSchema} from './model-schema';
const source='一个低多边形的红白灯塔立在灰色岩石底座上。灯塔是画面主体。';
test('prompt quotation arrays retain literal ordered spans without connective parsing',()=>{
 expect(evidenceSpans(['一个低多边形的红白灯塔','灯塔是画面主体'],source)).toEqual(['一个低多边形的红白灯塔','灯塔是画面主体']);
 expect(evidenceSpans(['“红白灯塔”','“灰色岩石底座”'],source)).toEqual(['红白灯塔','灰色岩石底座']);
 for(const values of [[],[''],['蓝白灯塔'],['灯塔是画面主体','红白灯塔'],['红白灯塔与主体'],['红白灯塔',null]])expect(()=>evidenceSpans(values as any,source)).toThrow();
});
test('all planner modalities use array evidence and preserve image count uncertainty',()=>{
 expect(modelSchema('plan').properties.requirements.items.properties.evidence.type).toBe('array');
 const p={name:'plant',summary:'plant',capabilities:['mapping'],requirements:[{id:'r',text:'中央植物',critical:true,weight:5,source:'image',evidence:['图像中央可见绿色植物，叶片存在遮挡'],count:null}]};
 expect(validateGroundedPlan(p,'').requirements[0].evidence).toHaveLength(1);
 expect(()=>validateGroundedPlan({...p,requirements:[{...p.requirements[0],count:6}]},'')).toThrow();
});
