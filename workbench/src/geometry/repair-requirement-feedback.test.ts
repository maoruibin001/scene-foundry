import {test,expect} from 'bun:test';
import {repairRequirementFeedback} from './repair-requirement-feedback';
const plan={requirements:[{id:'a',text:'主体轮廓与表面',critical:true},{id:'b',text:'光照',critical:true}]};
const scene={program:{templates:[{id:'t',parts:[{material:'base'}]}],instances:[{id:'i',label:'主体',template:'t',requirementIds:['a','b'],surfaceOverrides:[{sourceMaterialId:'base',targetMaterialId:'variant'}]}]}};
const review={requirements:[{id:'a',verdict:'partial',reason:'薄片厚度与布面尚不正确',frames:['reference-1.png']}]};
const old=(extra:any={})=>({jobId:'old',relation:'ancestor-result',scoreComparison:{comparableWithinAttempt:true,comparableToCurrentAssessment:true},assessment:{unmetRequirements:[{id:'a',verdict:'partial',reason:'此前仅完成轮廓'}]},selectedGoals:[{requirementIds:['a'],kind:'surface',problem:'粗糙度错误',expectedChange:'表面层次接近原图'}],scoreGain:.1,...extra});
test('逐条连接需求、有效覆盖材质与可见实例，保留原输入和评审',()=>{
 const inputs={plan,review,scene},before=JSON.stringify(inputs),out=repairRequirementFeedback(plan,review,scene,{views:[{referenceIndex:1,cameraName:'参考',instances:[{instanceId:'i',frameFraction:.25},{instanceId:'unrelated',frameFraction:.7}]}]},{attempts:[old()]});
 expect(out.requirements[0]).toMatchObject({id:'a',verdict:'partial',recordedIncompleteCount:1,remainingEvidence:review.requirements[0].reason});
 expect(out.requirements[0].associatedMaterials).toEqual(['base','variant']);expect(out.requirements[0].views[0].geometrySampleFraction).toBe(.25);
 expect(out.requirements[0].evaluations[0].selectedGoals).toHaveLength(1);expect(JSON.stringify(inputs)).toBe(before);
});
test('跨契约记录不混入重复失败计数，分支关系不抹除',()=>{
 const out=repairRequirementFeedback(plan,review,scene,{}, {attempts:[old(),old({jobId:'branch',relation:'ancestor-alternative'}),old({jobId:'foreign',scoreComparison:{comparableWithinAttempt:true,comparableToCurrentAssessment:false}})],omittedVerified:3});
 expect(out.requirements[0].recordedIncompleteCount).toBe(2);expect(out.requirements[0].evaluations[1].relation).toBe('ancestor-alternative');expect(out.omittedVerifiedHistory).toBe(3);
});
test('未知评审与缺失历史不能冒充通过，异常面积不能变为零',()=>{
 const out=repairRequirementFeedback(plan,review,scene,{views:[{instances:[{instanceId:'i'}]}]},{attempts:[old({assessment:{unmetRequirements:[]}})]});
 expect(out.requirements[1].verdict).toBe('未评估');expect(out.requirements[0].evaluations[0].verdict).toBe('未记录');expect(out.requirements[0].recordedIncompleteCount).toBe(0);expect(out.requirements[0].views[0].geometrySampleFraction).toBeNull();expect(out.requirements[1].evaluations).toEqual([]);expect(repairRequirementFeedback(plan,review,scene,{views:[{}]},{attempts:[]}).requirements[0].views[0].geometrySampleFraction).toBeNull();
});

test('紧凑可见性上下文通过调色表解析编号，未知编号不伪报零面积',()=>{
 const visibility={palette:[{number:1,instanceId:'i'}],views:[{instances:[{number:1,frameFraction:.4}]}]};
 const good=repairRequirementFeedback(plan,review,scene,visibility,{attempts:[]});expect(good.requirements[0].views[0]).toMatchObject({visibleInstanceIds:['i'],geometrySampleFraction:.4});
 visibility.palette=[];expect(repairRequirementFeedback(plan,review,scene,visibility,{attempts:[]}).requirements[0].views[0].geometrySampleFraction).toBeNull();
});
