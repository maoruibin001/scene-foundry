import {test,expect} from 'bun:test';
import {applyOpeningObservation,openingObservationContext,openingObservationSchema,OPENING_OBSERVATION_PROMPT} from './opening-observations';
import {comparableAssessment} from './refinement-baseline';
import {applyRefinement} from './refinement';
import {DEFAULT_POLICY} from '../quality';
const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};
function source():any{return {version:'scene-v1',program:{version:'geometry-v1',name:'任意复合结构',materials:[{id:'m',color:[.5,.5,.5,1],roughness:.8,metallic:0,textureId:null}],templates:[{id:'wall',parts:[{...pose,id:'body',material:'m',position:[0,0,1.5],shape:{type:'box',size:[3,.4,3],radius:0}}]}],instances:[{...pose,id:'one',label:'复合结构',template:'wall',requirementIds:[]}]},entities:[{instanceId:'one',role:'subject',category:'结构'}],cameras:[{name:'参考',referenceIndex:1,position:[0,-4,2],target:[0,0,1.5],fov:1},{name:'检查',referenceIndex:null,position:[4,-4,2],target:[0,0,1.5],fov:1}],textures:[],lighting:{direction:[0,1,-1],color:[1,1,1],intensity:1,ambientColor:[1,1,1],ambientIntensity:.4,points:[]},assumptions:[]};}
function observation():any{return {version:'opening-observations-v1',spatialOpenings:[{id:'opening',label:'应有开口',instanceId:'one',center:[0,-.2,1.5],normal:[0,1,0],up:[0,0,1],width:1,height:1.5,clearDepth:.8,expectedBeyond:'geometry',beyondDescription:'参考中的后方结构',referenceIndices:[1],evidence:'原图通透但生成网格堵塞，尺寸为推断'}],uncertainty:['净空深度为估计']};}
test('历史场景补充观察只产生新候选元数据，保留源几何与原文件语义',()=>{
 const s=source(),before=JSON.stringify(s),c=openingObservationContext(s),next=applyOpeningObservation(s,observation(),1,c);
 expect(JSON.stringify(s)).toBe(before);expect(next.program).toEqual(s.program);expect(next.cameras).toEqual(s.cameras);expect(next.assumptions).toEqual(['净空深度为估计']);expect(next.spatialOpenings).toHaveLength(1);expect(c.templates[0].parts[0]).not.toHaveProperty('shape');
 expect(()=>applyOpeningObservation(next,observation(),1)).toThrow('不能');
});
test('观察不能捏造所属物体、图片或模板范围，不能覆盖已冻结约束',()=>{
 for(const mutate of [(v:any)=>v.spatialOpenings[0].instanceId='missing',(v:any)=>v.spatialOpenings[0].referenceIndices=[2],(v:any)=>v.spatialOpenings[0].center=[90,0,0],(v:any)=>v.spatialOpenings[0].normal=[0,0,1]]){const v=observation();mutate(v);expect(()=>applyOpeningObservation(source(),v,1)).toThrow();}
 const s=source();s.spatialOpenings=[];expect(()=>applyOpeningObservation(s,observation(),1)).toThrow('已冻结');
});
test('新观察的净空必须在增量修正中真实实现，元数据本身不是修正成功',()=>{
 const s=applyOpeningObservation(source(),observation(),1),plan={requirements:[]},p:any={version:'scene-refinement-v1',reason:'移开错误构件并保留边框',instances:[],cameras:[],materials:[],parts:[],removeParts:[],addTemplates:[],addEntities:[],textures:[],textureReuse:[],lighting:null,assumptions:[]};
 p.cameras=[{...s.cameras[0],fov:.9}];expect(()=>applyRefinement(s,p,plan,1,'simple')).toThrow('封堵');
 p.parts=[{templateId:'wall',part:{...s.program.templates[0].parts[0],position:[1.3,0,1.5],shape:{type:'box',size:[.4,.4,3],radius:0}}}];expect(applyRefinement(s,p,plan,1,'simple').spatialOpenings).toEqual(s.spatialOpenings);
});
test('模型、路由、深度和评分政策不同必须重建基线，生成版本改变不冒充评审配置改变',()=>{
 const profile={provider:'codex-cli',judgeModel:'model',reasoningEffort:'xhigh',executionRoute:{configurationSha256:'a'.repeat(64)},specSha256:'s',policy:DEFAULT_POLICY};
 const a={profile},b={profile:structuredClone(profile)};expect(comparableAssessment(a,b)).toBe(true);
 for(const mutate of [(p:any)=>p.judgeModel='other',(p:any)=>p.reasoningEffort='high',(p:any)=>p.executionRoute.configurationSha256='b'.repeat(64),(p:any)=>delete p.executionRoute,(p:any)=>p.policy.score=90,(p:any)=>p.assessmentProtocolSha256='new-evidence-contract']){const c=structuredClone(b);mutate(c.profile);expect(comparableAssessment(a,c)).toBe(false);}
 expect(comparableAssessment({profile:{...profile,judgeModel:'old'},assessmentProfile:profile},b)).toBe(true);
 const verified={...profile,assessmentProtocolSha256:'current-contract'};expect(comparableAssessment({profile:verified},{profile:{...verified,pipelineVersionId:'different-generation-code'}})).toBe(true);expect(comparableAssessment({profile:verified},{profile})).toBe(false);
});
test('观察契约限制数据形态且为通用中文规则，不嵌入当前案例坐标',()=>{
 const s=openingObservationSchema();expect(s.required).toEqual(Object.keys(s.properties));expect(s.additionalProperties).toBe(false);expect(s.properties.spatialOpenings.maxItems).toBe(32);expect(OPENING_OBSERVATION_PROMPT).toContain('所有说明使用中文');expect(OPENING_OBSERVATION_PROMPT).not.toMatch(/餐厅|tpl_window|ed2616|7\.3|街机/);
});
