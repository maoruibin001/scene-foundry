import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CheckpointStore} from './checkpoints';
import {digest,save} from '../store';
import {validateGroundedPlan} from '../grounding';
import {checkpointFixture as fixture} from './checkpoint-fixture';
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
