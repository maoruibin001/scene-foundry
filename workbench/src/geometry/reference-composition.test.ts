import {test,expect} from 'bun:test';
import {referenceComposition,compositionContext,LEGACY_REFERENCE_COMPOSITION,REFERENCE_COMPOSITION} from './reference-composition';
import {sceneVisibility} from './visibility';
import {stable} from '../validated-cache';

function fixture(){
 const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};
 const scene:any={program:{version:'geometry-v1',name:'可见范围对照',materials:[{id:'m',color:[.5,.5,.5,1],roughness:1,metallic:0,textureId:null}],
  templates:[{id:'t',parts:[{...pose,id:'p',material:'m',shape:{type:'box',size:[1,1,1],radius:0}}]}],instances:[{...pose,id:'a',label:'主体',template:'t',requirementIds:[]},{...pose,id:'b',label:'遮挡',template:'t',position:[0,-1,0],requirementIds:[]}]},
  cameras:[{name:'参考',referenceIndex:1,position:[0,-4,1],target:[0,0,0],fov:1}],observedBindings:[{landmarkId:'L',instanceIds:['a']}]};
 const observation:any={landmarks:[{id:'L',label:'主体',critical:true,views:[{referenceIndex:1,box:[.25,.25,.75,.75],extent:'partial',evidence:'原图可见轮廓，边缘部分被遮挡'}]}],cameras:[{referenceIndex:1,contentRect:[0,0,1,1]}]};
 const labels=new Uint16Array(8*8);for(let y=2;y<6;y++)for(let x=2;x<6;x++)labels[y*8+x]=1;
 const report:any={method:'fixture',palette:[{number:1,instanceId:'a'},{number:2,instanceId:'b'}],views:[{cameraName:'参考',referenceIndex:1,width:8,height:8,labelsBase64:Buffer.from(labels.buffer).toString('base64')}]};
 return {scene,observation,report,labels};
}

test('partial和occluded均测实际可见范围；完全匹配不需要标成完整物体',()=>{
 for(const extent of ['partial','occluded']){const f=fixture();f.observation.landmarks[0].views[0].extent=extent;const before=stable(f);const row=referenceComposition(f.scene,f.observation,f.report).rows[0];
  expect(row.visible).toEqual([.25,.25,.75,.75]);expect(row.edgeResidual).toBe(0);expect(row.status).toBe('measured-visible-extent');expect(row.warnings.length).toBeGreaterThan(0);expect(stable(f)).toBe(before);
 }
});
test('可见像素偏移提供边缘方向和框外比例，不产生通过分或密度目标',()=>{
 const f=fixture();f.labels.fill(0);for(let y=2;y<6;y++)for(let x=3;x<7;x++)f.labels[y*8+x]=1;f.report.views[0].labelsBase64=Buffer.from(f.labels.buffer).toString('base64');
 const report=referenceComposition(f.scene,f.observation,f.report),row=report.rows[0];expect(row.delta).toEqual([.125,0,.125,0]);expect(row.centreDelta).toEqual([.125,0]);expect(row.outsideTargetFraction).toBe(.25);expect(report.quality).toBe('not-assessed');expect(report.score).toBeUndefined();expect(report.passed).toBeUndefined();
});
test('原图和采样使用同一内容区变换，黑边不导致坐标误比较',()=>{
 const f=fixture();f.observation.cameras[0].contentRect=[.125,0,.875,1];const row=referenceComposition(f.scene,f.observation,f.report).rows[0];expect(row.visible).toEqual(row.expected);expect(row.visible).toEqual([.16667,.25,.83333,.75]);expect(row.edgeResidual).toBe(0);
});
test('多个绑定实例聚合可见像素不重复计数，未知绑定或未知像素拒绝',()=>{
 const f=fixture();f.scene.observedBindings[0].instanceIds=['a','a','b'];f.labels[2*8+2]=2;f.report.views[0].labelsBase64=Buffer.from(f.labels.buffer).toString('base64');expect(referenceComposition(f.scene,f.observation,f.report).rows[0].pixels).toBe(16);
 f.scene.observedBindings[0].instanceIds.push('missing');expect(()=>referenceComposition(f.scene,f.observation,f.report)).toThrow('绑定');f.scene.observedBindings[0].instanceIds=['a'];f.labels[0]=99;f.report.views[0].labelsBase64=Buffer.from(f.labels.buffer).toString('base64');expect(()=>referenceComposition(f.scene,f.observation,f.report)).toThrow('身份');
});
test('零可见和小面积不会得到0误差冒充匹配，检查机位不能代替参考机位',()=>{
 const f=fixture();f.labels.fill(0);f.report.views[0].labelsBase64=Buffer.from(f.labels.buffer).toString('base64');let row=referenceComposition(f.scene,f.observation,f.report).rows[0];expect(row.edgeResidual).toBeNull();expect(row.status).toBe('unverified');
 f.labels[3*8+3]=1;f.report.views[0].labelsBase64=Buffer.from(f.labels.buffer).toString('base64');row=referenceComposition(f.scene,f.observation,f.report).rows[0];expect(row.status).toBe('unverified');expect(row.warnings.join()).toContain('小面积');
 f.scene.cameras[0].referenceIndex=null;expect(referenceComposition(f.scene,f.observation,f.report).rows).toHaveLength(0);
});
test('缺记录、缺裁切、重复参考机位和非法采样明确未验证或拒绝',()=>{
 const f=fixture();expect(referenceComposition(f.scene,null,f.report).unverified).toHaveLength(1);f.observation.cameras[0].contentRect=null;expect(referenceComposition(f.scene,f.observation,f.report).rows).toHaveLength(0);
 f.observation.cameras[0].contentRect=[0,0,1,1];f.scene.cameras.push({...f.scene.cameras[0],name:'重复'});expect(referenceComposition(f.scene,f.observation,f.report).unverified).toHaveLength(1);f.scene.cameras.pop();f.report.views[0].labelsBase64='bad';expect(()=>referenceComposition(f.scene,f.observation,f.report)).toThrow('采样');
});
test('较来源偏差变化和隐藏主体单列，换原图目标不能比较',()=>{
 const f=fixture(),baseline=referenceComposition(f.scene,f.observation,f.report);f.labels.fill(0);f.report.views[0].labelsBase64=Buffer.from(f.labels.buffer).toString('base64');const hidden=referenceComposition(f.scene,f.observation,f.report),ctx=compositionContext(hidden,baseline);
 expect(ctx.rows[0].sourceDelta).toEqual({edgeResidual:null,wasVisible:true,isVisible:false,visibilityLost:true});f.observation.landmarks[0].views[0].box=[.2,.2,.8,.8];expect(()=>compositionContext(referenceComposition(f.scene,f.observation,f.report),baseline)).toThrow('目标');
});
test('真实编译几何被前景遮住时只统计露出表面，透明几何保持未验证',()=>{
 const f=fixture();const report=sceneVisibility(f.scene);const visible=referenceComposition(f.scene,f.observation,report).rows[0];expect(visible.pixels).toBeLessThan(report.views[0].instances.find(i=>i.instanceId==='b')!.pixels);
 const without=structuredClone(f.scene);without.program.instances.pop();expect(visible.pixels).toBeLessThan(referenceComposition(without,f.observation).rows[0].pixels);
 f.scene.program.instances[1].scale=[2,1,2];expect(referenceComposition(f.scene,f.observation).rows[0].pixels).toBe(0);
 f.scene.program.materials[0].color[3]=.1;const transparent=referenceComposition(f.scene,f.observation).rows[0];expect(transparent.pixels).toBe(0);expect(transparent.edgeResidual).toBeNull();
});

test('整物体和局部部件共用实例时不把全物体轮廓冒充各部件偏差',()=>{
 const f=fixture();f.scene.observedBindings.push({landmarkId:'edge',instanceIds:['a']});
 f.observation.landmarks.push({id:'edge',label:'主体边线',critical:true,views:[{referenceIndex:1,box:[.25,.25,.3,.75],extent:'partial',evidence:'边线仅为主体局部'}]});
 const before=stable(f),report=referenceComposition(f.scene,f.observation,f.report);
 expect(report.version).toBe(REFERENCE_COMPOSITION);expect(report.unverified).toHaveLength(2);
 for(const row of report.rows){expect(row.comparisonScope).toBe('unverified-binding-scope');expect(row.status).toBe('unverified');
  for(const key of ['visible','pixels','delta','edgeResidual','centreDelta','spanRatio','outsideTargetFraction'])expect(row[key]).toBeNull();
  expect(row.boundInstanceEvidence).toEqual({visible:[.25,.25,.75,.75],pixels:16,contentExcludedPixels:0});
 }
 expect(compositionContext(report,report).rows.every((r:any)=>r.sourceDelta===null)).toBe(true);expect(stable(f)).toBe(before);
 // Historical proof stays historical, never silently rewritten as v2 evidence.
 const old=referenceComposition(f.scene,f.observation,f.report,{version:LEGACY_REFERENCE_COMPOSITION});expect(old.rows[1].edgeResidual).toBeGreaterThan(0);expect(old.rows[1].targetId).toBeUndefined();expect(old.unverified).toEqual([]);
});
test('部分重合的实例组也不能确定部件范围，另一个机位的独立目标不受影响',()=>{
 const f=fixture();f.scene.observedBindings.push({landmarkId:'group',instanceIds:['a','b']});
 f.observation.landmarks.push({id:'group',views:[{referenceIndex:1,box:[.1,.1,.9,.9]}]});
 expect(referenceComposition(f.scene,f.observation,f.report).rows[0].edgeResidual).toBeNull();
 f.observation.landmarks[1].views[0].referenceIndex=2;
 expect(referenceComposition(f.scene,f.observation,f.report).rows[0].edgeResidual).toBe(0);
});
test('同地标同机位多框没有逐框绑定时保留两个未验证目标，不能复用同一整物体残差',()=>{
 const f=fixture();f.observation.landmarks[0].views.push({referenceIndex:1,box:[.1,.1,.2,.2],extent:'partial'});
 const report=referenceComposition(f.scene,f.observation,f.report);expect(report.rows).toHaveLength(2);
 expect(new Set(report.rows.map((r:any)=>r.targetId)).size).toBe(2);
 expect(report.rows.every((r:any)=>r.edgeResidual===null&&r.warnings.join().includes('逐框'))).toBe(true);
});
test('来源按同一目标框而不是同地标第一个框匹配，重复身份或新绑定不比较',()=>{
 const f=fixture(),report=referenceComposition(f.scene,f.observation,f.report),row=report.rows[0];
 const source=structuredClone(report);source.rows.unshift({...row,targetId:'different-target',edgeResidual:123});source.rows[1].edgeResidual=.2;
 expect(compositionContext(report,source).rows[0].sourceDelta.edgeResidual).toBe(-.2);
 source.rows.push({...source.rows[1]});expect(compositionContext(report,source).rows[0].sourceDelta).toBeNull();
 source.rows.pop();source.rows[1].instanceIds=['b'];expect(compositionContext(report,source).rows[0].sourceDelta).toBeNull();
 expect(()=>compositionContext(report,{...source,version:LEGACY_REFERENCE_COMPOSITION})).toThrow('版本');
});
test('相同实例集合重排可比较；绑定身份变化和不可靠目标不能冒充进步',()=>{
 const f=fixture();f.scene.observedBindings[0].instanceIds=['a','b'];const report=referenceComposition(f.scene,f.observation,f.report),source=structuredClone(report);
 source.rows[0].instanceIds=['b','a'];expect(compositionContext(report,source).rows[0].sourceDelta.edgeResidual).toBe(0);
 source.rows[0].comparisonScope='unverified-binding-scope';expect(compositionContext(report,source).rows[0].sourceDelta).toBeNull();
 expect(()=>referenceComposition(f.scene,f.observation,f.report,{version:'unknown'})).toThrow('版本');
});
test('范围不明也不能跳过非法实例或像素身份校验',()=>{
 const f=fixture();f.observation.landmarks[0].views.push({...f.observation.landmarks[0].views[0]});
 f.scene.observedBindings[0].instanceIds.push('unknown');expect(()=>referenceComposition(f.scene,f.observation,f.report)).toThrow('绑定');
 f.scene.observedBindings[0].instanceIds.pop();f.labels[0]=99;f.report.views[0].labelsBase64=Buffer.from(f.labels.buffer).toString('base64');
 expect(()=>referenceComposition(f.scene,f.observation,f.report)).toThrow('身份');
});
