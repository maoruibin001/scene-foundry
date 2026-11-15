import {test,expect} from 'bun:test';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
process.env.PIPELINE_SPEC_DIR=mkdtempSync(join(tmpdir(),'spec-run-')); // 只隔离规格目录,不改其它测试共享的数据目录
const {storeSpec,loadSpec,specPlan}=await import('./spec-run');
const {sampleSpec}=await import('./spec/fixtures');

test('规格按内容寻址保存,改动产生新 ID;篡改文件被拒绝;验收条目成为需求基线',()=>{
 const s=sampleSpec(),a=storeSpec(s),b=storeSpec({...s,name:'改名'});
 expect(a.id).toMatch(/^[a-f0-9]{64}$/);expect(b.id).not.toBe(a.id);
 expect(loadSpec(a.id).spec.name).toBe(s.name);
 const p=specPlan(s);expect(p.requirements.map(r=>r.id)).toEqual(['coreAt']);expect(p.requirements[0].critical).toBe(true);
 expect(()=>storeSpec({...s,objects:[]} as any)).toThrow('position 无效'); // 验收引用了被删对象
 expect(()=>storeSpec({...s,shots:[]} as any)).toThrow('SCENE_SPEC_INVALID');
});
