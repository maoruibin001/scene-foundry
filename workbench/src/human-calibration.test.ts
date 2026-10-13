import {test,expect} from 'bun:test';
import {fitDimension,buildCalibrationModel,calibrateScore,calibrator,calibratePreview,humanCalibrationRule,HUMAN_CALIBRATION,CAL_POLICY} from './human-calibration';
import {qualityGate,DEFAULT_POLICY} from './quality';

test('策略开关',()=>{
 expect(humanCalibrationRule({humanCalibrationPolicy:HUMAN_CALIBRATION})).toBe(true);
 expect(humanCalibrationRule({})).toBe(false);
 expect(humanCalibrationRule(null)).toBe(false);
});

test('fitDimension：无样本恒等；少样本只平移并夹紧；足量做有界最小二乘',()=>{
 expect(fitDimension([])).toMatchObject({n:0,scale:1,bias:0});
 // 1 pair, judge 3 -> human 4 : bias +1, slope 1
 expect(fitDimension([[3,4]])).toMatchObject({n:1,scale:1,bias:1});
 // bias-only clamp to ±1.5 even if human much higher
 expect(fitDimension([[1,5]]).bias).toBe(1.5);
 // perfectly linear judge->human = judge+1 over >=minSlope points: slope~1, bias~1
 const f=fitDimension([[1,2],[2,3],[3,4],[4,5]]);
 expect(f.scale).toBeCloseTo(1,5);expect(f.bias).toBeCloseTo(1,5);expect(f.corr).toBeCloseTo(1,5);
 // scale is clamped to [0.5,2]
 expect(fitDimension([[0,0],[1,5],[2,10]]).scale).toBe(2);
});

test('buildCalibrationModel：维度分配对；applied 在样本达到 minApply 时才为真',()=>{
 const one=buildCalibrationModel([{judge:{material:3},human:{material:4}}]);
 expect(one.applied).toBe(false);
 expect(one.dimensions.material).toMatchObject({n:1,bias:1});
 const many=Array.from({length:CAL_POLICY.minApply},()=>({judge:{material:3,coverage:4,spatial:4,shape:4,readability:4},human:{material:4,coverage:4,spatial:4,shape:4,readability:4}}));
 const m=buildCalibrationModel(many);
 expect(m.applied).toBe(true);
 expect(m.dimensions.material.bias).toBeCloseTo(1,5);
});

test('calibrateScore：未生效时恒等；生效后仿射；force 用于预览',()=>{
 const notApplied={applied:false,dimensions:{material:{scale:1,bias:1}}};
 expect(calibrateScore('material',3,notApplied)).toBe(3);          // gated off
 expect(calibrateScore('material',3,notApplied,true)).toBe(4);     // preview force
 const applied={applied:true,dimensions:{material:{scale:1,bias:1}}};
 expect(calibrateScore('material',3,applied)).toBe(4);
 expect(calibrateScore('material',4.5,applied)).toBe(5);           // clamp to 5
 expect(calibrateScore('unknown',3,applied)).toBe(3);              // no model for dim
});

test('calibratePreview 用 rawScore 作基准并给出综合分前后',()=>{
 const dims=[{id:'material',weight:20,score:3,rawScore:3},{id:'coverage',weight:28,score:5,rawScore:5}];
 const model={applied:false,dimensions:{material:{scale:1,bias:1},coverage:{scale:1,bias:0}}};
 const p=calibratePreview(dims,model);
 expect(p.rows.find(r=>r.id==='material')).toMatchObject({base:3,calibrated:4});
 expect(p.calibratedComposite).toBeGreaterThan(p.rawComposite);   // material 3->4 raises composite
});

test('qualityGate 接受 calibrate 钩子并改变维度分（默认恒等不影响历史）',()=>{
 const plan={requirements:[{id:'R1',critical:false,weight:1}]};
 const review={requirements:[{id:'R1',verdict:'met',reason:'r',frames:['f']}],
  dimensions:['coverage','spatial','shape','material','readability'].map(id=>({id,score:3,reason:'r',frames:['f']}))};
 const hard={video:true,cameraStopped:true};
 const base=qualityGate(plan,review,hard,DEFAULT_POLICY);
 const bumped=qualityGate(plan,review,hard,DEFAULT_POLICY,(id,s)=>id==='material'?Math.min(5,s+2):s);
 expect(bumped.score).toBeGreaterThan(base.score);
 expect(base.dimensions.find((d:any)=>d.id==='material')).toMatchObject({rawScore:3});
});
