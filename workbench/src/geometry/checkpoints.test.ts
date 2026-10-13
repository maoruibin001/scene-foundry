import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CheckpointStore} from './checkpoints';
import {digest,save} from '../store';
import {validateGroundedPlan} from '../grounding';
import {checkpointFixture as fixture} from './checkpoint-fixture';
test('连续检查点恢复保留原图观察和裁切坐标；摘要保护防止静默变更',()=>{const f=fixture();try{
 const observation={landmarks:[{id:'pool',views:[{referenceIndex:1,box:[.2,.1,.8,.9]}]}]};
 save(join(f.registration.generationDir,'reference-observations.json'),observation);
 const first=f.store.register(f.registration),nextDir=join(f.root,'next');
 f.store.restore(first.id,f.job,nextDir);
 expect(JSON.parse(readFileSync(join(nextDir,'reference-observations.json'),'utf8'))).toEqual(observation);
 const second=f.store.register({...f.registration,generationDir:nextDir}),thirdDir=join(f.root,'third');
 f.store.restore(second.id,f.job,thirdDir);
 expect(JSON.parse(readFileSync(join(thirdDir,'reference-observations.json'),'utf8'))).toEqual(observation);
 writeFileSync(join(f.store.path(first.id),'payload/reference-observations.json'),'{}');
 expect(()=>f.store.restore(first.id,f.job,join(f.root,'tampered'))).toThrow('已改变');
}finally{rmSync(f.root,{recursive:true,force:true});}});
test('检查点复用真实几何、保留原版本，并在新候选下重新校验',()=>{const f=fixture();try{
 const m=f.store.register(f.registration);expect(m.assets).toHaveLength(1);expect(f.store.register(f.registration).id).toBe(m.id);
 const next={...f.job,pipelineVersion:{id:'candidate-b'}},out=f.store.restore(m.id,next,join(f.root,'restored'));
 expect(out.assets[0].value).toEqual(f.geometry);expect(out.assets[0].source.pipelineVersion.id).toBe('candidate-a');expect(f.store.matching(next)[0].completed).toBe(1);
 expect(JSON.parse(readFileSync(join(f.root,'restored/assets/shape/geometry.json'),'utf8'))).toEqual(f.geometry);
}finally{rmSync(f.root,{recursive:true,force:true});}});
test('检查点拒绝输入、图序、模型、深度及引擎改变；源码候选变化允许重验',()=>{const f=fixture();try{
 const m=f.store.register(f.registration);
 for(const change of [{prompt:'别的场景'},{complexity:'complex'},{images:[...f.job.images].reverse()},{modelSettings:{...f.job.modelSettings,reasoningEffort:'xhigh'}},{modelSettings:{...f.job.modelSettings,model:'other'}},{profile:{...f.job.profile,engineSha:'new-engine'}}])expect(()=>f.store.load(m.id,{...f.job,...change})).toThrow('不匹配');
 writeFileSync(join(f.store.path(m.id),'payload/assets/shape/geometry.json'),'{}');expect(()=>f.store.load(m.id,f.job)).toThrow('已改变');expect(f.store.matching(f.job)).toHaveLength(0);
}finally{rmSync(f.root,{recursive:true,force:true});}});
test('已完成标志不足以复用：必须同时匹配布局、需求、图片、模型和几何摘要',()=>{const f=fixture();try{
 for(const change of [{layoutSha256:'wrong'},{planSha256:'wrong'},{geometrySha256:'wrong'},{referenceSha256:[]},{modelSettings:{model:'other'}}]){save(join(f.registration.generationDir,'assets/shape/checkpoint.json'),{...f.checkpoint,...change});expect(()=>f.store.register(f.registration)).toThrow('不一致');}
 save(join(f.registration.generationDir,'assets/shape/checkpoint.json'),{...f.checkpoint,status:'failed'});expect(f.store.register(f.registration).assets).toHaveLength(0);
}finally{rmSync(f.root,{recursive:true,force:true});}});
test('精修策略、冻结依据及失败调用子目录封存恢复，旧调用不被覆盖',()=>{const f=fixture();try{
 const folder=join(f.registration.generationDir,'assets/shape'),child=join(folder,'detail-repair-1');mkdirSync(child);
 const basis={version:'voxel-detail-basis-v1',source:'fixture immutable basis'};save(join(f.registration.generationDir,'voxel-detail-basis.json'),basis);
 save(join(folder,'checkpoint.json'),{...f.checkpoint,modelAttemptFolders:['detail-repair-1'],detailRepair:'voxel-detail-merge-feedback-v1',detailRepairStartedAt:123});
 save(join(folder,'voxel-detail-merge-feedback.json'),{error:'precise grid conflict'});
 save(join(folder,'voxel-entity-execution.json'),{pid:11,startedAt:100});save(join(child,'voxel-entity-execution.json'),{pid:12,startedAt:123});save(join(child,'checkpoint.json'),{status:'failed',error:'budget'});
 const snapshot=f.store.register(f.registration),out=join(f.root,'detail-restored');f.store.restore(snapshot.id,f.job,out);
 for(const name of ['voxel-detail-basis.json','assets/shape/voxel-entity-execution.json','assets/shape/detail-repair-1/voxel-entity-execution.json','assets/shape/detail-repair-1/checkpoint.json','assets/shape/voxel-detail-merge-feedback.json'])expect(readFileSync(join(out,name))).toEqual(readFileSync(join(f.registration.generationDir,name)));
 expect(JSON.parse(readFileSync(join(out,'assets/shape/checkpoint.json'),'utf8')).detailRepairStartedAt).toBe(123);
 save(join(folder,'checkpoint.json'),{...f.checkpoint,modelAttemptFolders:['../outside']});expect(()=>f.store.register(f.registration)).toThrow('归档路径');
}finally{rmSync(f.root,{recursive:true,force:true});}});
