import {test,expect} from 'bun:test';
import {join} from 'node:path';
import {mkdirSync,rmSync} from 'node:fs';
import {assetContacts} from './contacts';
import {BLOCKOUT_PART_LIMIT,blockoutTemplateInput,blockoutSharedInterfaces,compactBlockoutSchema} from './blockout-contract';
import {blockoutGenerationInput,generateBlockoutTemplates,BLOCKOUT_TEMPLATE_PROMPT} from './blockout-assets';
import {validatedKey} from '../validated-cache';
import {modelSchema} from '../model-schema';
import {checkpointFixture} from './checkpoint-fixture';
import {read,runDir} from '../store';
import {matchingPolicy} from '../matching-level';
import {GRAYBOX_REPAIR_PROMPT,grayboxSpaceRepairSchema} from './graybox-space-repair';

const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};
function spaceFixture(){
 const briefs=['left','right','other'].map(id=>({id,label:id,description:'承托连接轮廓',origin:'中心',bounds:{min:[-1,-1,-1],max:[1,1,1]},maxParts:32}));
 return {program:{templates:briefs,instances:briefs.map((t,i)=>({...pose,id:'i'+i,label:t.label,template:t.id,position:[i*2,0,0]}))},cameras:[{position:[0,-5,3]}],spatialContacts:[{id:'joint',label:'共享接缝',kind:'seam',aId:'i0',bId:'i1',points:[[1,-.5,0],[1,.5,0]],referenceIndices:[1],evidence:'参考中的接缝'}]};
}
const key=(space:any,id:string)=>validatedKey({role:'scene-blockout',system:BLOCKOUT_TEMPLATE_PROMPT,text:JSON.stringify(blockoutTemplateInput(space,space.program.templates.find(t=>t.id===id))),schemaContext:{},maxTokens:6000,images:[]},{stageContract:'scene-blockout'});

test('灰模双方收到由共享规划推导的局部接口，不修改空间或声明贴合通过',()=>{
 const s=spaceFixture(),before=JSON.stringify(s),a=blockoutTemplateInput(s,s.program.templates[0]),b=blockoutTemplateInput(s,s.program.templates[1]);
 expect(a.spatialContacts).toEqual(assetContacts(s,'left'));expect(b.spatialContacts).toEqual(assetContacts(s,'right'));
 expect(a.spatialContacts[0].localPoints).toEqual([[1,-.5,0],[1,.5,0]]);expect(b.spatialContacts[0].localPoints).toEqual([[-1,-.5,0],[-1,.5,0]]);
 expect(b.spatialContacts[0]).toMatchObject({instanceId:'i1',neighborInstanceId:'i0',referenceIndices:[1],toleranceMeters:.03});
 expect(a).not.toHaveProperty('contactsPassed');expect(JSON.stringify(s)).toBe(before);
});

test('接触局部输入缓存忽略相机和无关实例，但相关邻居位姿变化更新接口与key',()=>{
 const s=spaceFixture(),before=key(s,'right');s.cameras[0].position=[8,-10,2];s.program.instances[2].position=[10,20,30];expect(key(s,'right')).toBe(before);
 s.program.instances[0].position=[.25,0,0];expect(blockoutTemplateInput(s,s.program.templates[1]).spatialContacts[0].localPoints[0]).toEqual([-.75,-.5,0]);expect(key(s,'right')).not.toBe(before);
 const translated=key(s,'right');s.program.instances[0].rotation=[0,0,Math.PI/2];s.program.instances[1].scale=[2,1,1];expect(key(s,'right')).not.toBe(translated);
});

test('共享接口点改变同时更新两方模板输入；一模板多实例保留每个不同局部接口',()=>{
 const s=spaceFixture(),oldA=key(s,'left'),oldB=key(s,'right');s.spatialContacts[0].points[0][1]=-.25;
 expect(key(s,'left')).not.toBe(oldA);expect(key(s,'right')).not.toBe(oldB);
 s.program.instances[1].template='left';s.program.templates=s.program.templates.filter(t=>t.id!=='right');
 const inputs=blockoutTemplateInput(s,s.program.templates[0]).spatialContacts;expect(inputs.map(c=>c.instanceId)).toEqual(['i0','i1']);expect(inputs.map(c=>c.localPoints[0][0])).toEqual([1,-1]);
});

test('空间续修提供来源姿态的逐模板共享接口；实例改变后派生值更新，补丁预算不扩大',()=>{
 const s=spaceFixture(),before=blockoutSharedInterfaces(s);expect(before).toEqual(['left','right'].map(templateId=>({templateId,spatialContacts:assetContacts(s,templateId)})));
 s.program.instances[0].position=[.25,0,0];const after=blockoutSharedInterfaces(s);expect(after.find(i=>i.templateId==='right')!.spatialContacts[0].localPoints[0]).toEqual([-.75,-.5,0]);expect(after).not.toEqual(before);
 expect(GRAYBOX_REPAIR_PROMPT).toContain('改变任何连接双方的实例位姿或contacts.points后须按新位姿重新核对');const schema=grayboxSpaceRepairSchema();expect(schema.properties.templates.maxItems).toBe(0);expect(schema.properties.groups.maxItems).toBe(3);expect(schema.properties.contacts.maxItems).toBe(8);expect(schema.properties.groups.items.properties.parts.maxItems).toBe(BLOCKOUT_PART_LIMIT);
});

test('灰模输入、输出和提示的部件预算同源为8，局部更低预算保留',()=>{
 const s=spaceFixture(),brief=s.program.templates[0];
 expect(blockoutTemplateInput(s,brief).brief.maxParts).toBe(BLOCKOUT_PART_LIMIT);expect(blockoutGenerationInput(s,brief).brief.maxParts).toBe(BLOCKOUT_PART_LIMIT);
 expect(blockoutTemplateInput(s,{...brief,maxParts:3}).brief.maxParts).toBe(3);expect(compactBlockoutSchema().properties.templates.items.properties.parts.maxItems).toBe(BLOCKOUT_PART_LIMIT);
});

for(const standard of [false,true])test(`${standard?'批量':'单模板'}真实请求文本包含全部接口点，响应schema保留灰模契约`,async()=>{
 const f=checkpointFixture(),id=crypto.randomUUID(),folder=join(runDir(id),'generation/blockout/0');mkdirSync(folder,{recursive:true});
 try{
  const s=read(join(f.registration.generationDir,'layout.json')),brief=s.program.templates[0];s.program.templates=['left','right'].map(id=>({...brief,id}));s.program.instances=s.program.templates.map((t,i)=>({...s.program.instances[0],id:t.id,label:t.id,template:t.id,position:[i*3,0,0]}));s.spatialContacts=[{id:'support',label:'支架连接',kind:'support',aId:'left',bId:'right',points:[[3,0,.2]],referenceIndices:[],evidence:'测试明确接触'}];
  const job:any={...f.job,id,reuseMode:'fresh',blockout:{},executionSettings:{assetConcurrency:2},...(standard?{matchingPolicy:matchingPolicy('standard'),optimizationPolicy:{matchingLevel:'standard'}}:{})};let received=0;
  await generateBlockoutTemplates(s,{job,plan:f.registration,images:[],signal:new AbortController().signal},folder,(async(input,_dir,validate)=>{
   const wire=JSON.parse(input.text),items=standard?wire.items:[wire];if(standard)expect(wire.contract).toBe('batch-local-graybox-v2');
   for(const item of items){received++;expect(item.contract).toBe('composition-graybox-v3');expect(item.spatialContacts).toEqual(assetContacts(s,item.brief.id));expect(item.spatialContacts[0].localPoints).toHaveLength(1);expect(item.brief.maxParts).toBeLessThanOrEqual(BLOCKOUT_PART_LIMIT);}
   expect(input.system).toContain('localPoints');expect(modelSchema(input.role,input.schemaContext)).toEqual(compactBlockoutSchema());
   return {value:validate({templates:items.map(item=>({...f.geometry.template,id:item.brief.id,parts:f.geometry.template.parts.map(p=>({...p,material:'blockout'}))}))}),receipt:{}};
  }) as any);expect(received).toBe(2);
 }finally{rmSync(f.root,{recursive:true,force:true});rmSync(runDir(id),{recursive:true,force:true});}
});
