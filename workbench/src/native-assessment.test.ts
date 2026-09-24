import {test,expect} from 'bun:test';
import {nativePlan,nativeAssessment} from './native-run';
import {DEFAULT_POLICY,HARD_CHECKS,DIMENSIONS} from './quality';
import {VISUAL_RULE_IDS} from './spec';
import {versionStats,inputKey} from './versions';
test('写实复刻的高均分不能豁免关键资产部分还原',()=>{const plan=nativePlan(),runtime={hard:Object.fromEntries(HARD_CHECKS.map(k=>[k,true])),buildEvidence:true,catalogEvidence:true,submittedFps:30,images:['view.png']},review={confidence:.9,requirements:plan.requirements.map(r=>({id:r.id,verdict:r.id==='arcade'?'partial':'met',reason:'对应真实图像',frames:['view.png']})),dimensions:DIMENSIONS.map(d=>({id:d.id,score:5,reason:'画面依据',frames:['view.png']})),specRules:VISUAL_RULE_IDS.map(id=>({id,status:'passed',reason:'真实图像依据',frames:['view.png']}))};expect(nativeAssessment(plan,review,runtime,{...DEFAULT_POLICY,score:90,dimensionFloor:4}).status).toBe('failed');review.requirements[0].frames=['invented.png'];expect(()=>nativeAssessment(plan,review,runtime,DEFAULT_POLICY)).toThrow('不存在');});
test('辅助制作不进入自动化成功率且双图身份参与版本对比',()=>{const j:any={status:'passed',validationKind:'native-assisted',stages:{},pipelineVersion:{id:'x'},profile:{pipelineVersionId:'x'}};expect(versionStats([j])).toMatchObject({total:1,assisted:1,rate:null,passed:0});expect(inputKey({images:[{id:'a'},{id:'b'}]})).not.toBe(inputKey({images:[{id:'a'},{id:'c'}]}));});
