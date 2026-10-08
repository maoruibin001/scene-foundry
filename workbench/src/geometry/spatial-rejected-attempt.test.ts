import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {read,save,digest} from '../store';
import {stable} from '../validated-cache';
import {sameRejectedSpatialCase,rejectedSpatialAttempt,assertNotRejectedSpatialScene} from './spatial-rejected-attempt';

function fixture(){
 const root=mkdtempSync(join(tmpdir(),'spatial-negative-')),source=join(root,'source'),folder=join(root,'failed'),repair=join(root,'repair');for(const p of [source,folder,repair,join(folder,'runtime'),join(folder,'project/evidence'),join(repair,'preview')])mkdirSync(p,{recursive:true});
 const job={id:crypto.randomUUID(),improvementId:'own',prompt:'原输入',baselineId:'own-reference',complexity:'complex',matchingLevel:'standard',images:[{id:'original'}],plan:{requirements:[{id:'R1'}]},modelSettings:{model:'fixture'},policy:{deliveryStandard:'basic70'},profile:{engineSha:'engine',generatorSha:'generator',assessmentProtocolSha256:'review'}};
 const gate={round:0,passed:false,protocol:'spatial-composition-v3',threshold:{space:3.5,critical:3,confidence:.6},review:{score:2.9,confidence:.9,relations:[]},failed:['path'],runtimeDigest:'real-build',frames:['reference-1.png'],endedAt:1};
 const image=join(folder,'runtime/reference-1.png');writeFileSync(image,Buffer.from('actual screenshot fixture'));const patch={parts:[{id:'changed'}]},scene={program:{templates:[{id:'a'}]},cameras:[{id:'reference'}]};
 save(join(source,'gate.json'),{...gate,review:{...gate.review,score:3.2}});save(join(folder,'gate.json'),gate);save(join(folder,'graybox-parts-source.json'),{repairFolder:repair});
 save(join(folder,'runtime/runtime.json'),{distManifestDigest:gate.runtimeDigest,hard:Object.fromEntries(['framing','cameraMotion','nonFlat','multipleViews','entitiesLoaded','frameRate','runtime','noErrors','hudToggle','video','cameraStopped'].map(k=>[k,true])),images:['reference-1.png'],hashes:[digest(readFileSync(image))],referenceFrames:[{file:'reference-1.png',referenceIndex:1}]});
 save(join(folder,'project/evidence/run-report.json'),{distManifestDigest:gate.runtimeDigest,engineSha:'engine',generatorSha:'generator'});save(join(folder,'scene-space-judge-parsed.json'),gate.review);save(join(folder,'scene-space-judge-receipt.json'),{stopReason:'completed',requestedModel:'fixture'});save(join(folder,'scene-space-judge-input-receipt.json'),{images:[{path:image,sha256:digest(readFileSync(image))}]});
 save(join(repair,'patch.json'),patch);save(join(repair,'reviewed-scene.json'),scene);const preview={patchSha256:digest(stable(patch)),canonicalSceneSha256:digest(stable(scene))};save(join(repair,'repair-receipt.json'),{sourceFolder:source,preview});save(join(repair,'preview/graybox-preview-audit.json'),{attempts:[{status:'rendered',...preview}]});
 return {root,source,folder,repair,job,gate,image,scene,ctx:{job},close:()=>rmSync(root,{recursive:true,force:true})};
}

test('同一基线的真实失败图、补丁和独立反馈作为负证据保留，不冒充新来源或新目标',()=>{
 const x=fixture();try{const before=readFileSync(join(x.folder,'gate.json'),'utf8'),v=rejectedSpatialAttempt(x.folder,x.job,x.ctx,x.source);expect(v.review.score).toBe(2.9);expect(v.sourceFolder).toBe(x.source);expect(v.frames[0].path).toBe(x.image);expect(v.patch.parts).toHaveLength(1);expect(readFileSync(join(x.folder,'gate.json'),'utf8')).toBe(before);}finally{x.close();}
});
test('不同输入/需求/模型/政策/Engine/评审或来源几何，不混入上一失败',()=>{
 const x=fixture();try{for(const change of [{prompt:'other'},{images:[{id:'other'}]},{plan:{requirements:[]}},{modelSettings:{model:'other'}},{policy:{deliveryStandard:'strict'}},{profile:{...x.job.profile,engineSha:'other'}},{improvementId:'other'}])expect(sameRejectedSpatialCase(x.job,{...x.job,...change})).toBeFalsy();const p=join(x.repair,'repair-receipt.json'),r=read(p);save(p,{...r,sourceFolder:'foreign'});expect(rejectedSpatialAttempt(x.folder,x.job,x.ctx,x.source)).toBeNull();}finally{x.close();}
});
test('已通过、低置信度或不同门槛不作确定的失败禁令；评分/图像/选中补丁篡改明确拒绝',()=>{
 const x=fixture();try{for(const changes of [{passed:true},{review:{...x.gate.review,confidence:.2}},{protocol:'other'}]){save(join(x.folder,'gate.json'),{...x.gate,...changes});expect(rejectedSpatialAttempt(x.folder,x.job,x.ctx,x.source)).toBeNull();}save(join(x.folder,'gate.json'),x.gate);writeFileSync(x.image,'tampered');expect(()=>rejectedSpatialAttempt(x.folder,x.job,x.ctx,x.source)).toThrow('哈希变化');}finally{x.close();}
});
test('相同几何机位换文案不能再测量/渲染；实际几何变化可继续，原失败不改',()=>{
 const x=fixture();try{const v=rejectedSpatialAttempt(x.folder,x.job,x.ctx,x.source);expect(()=>assertNotRejectedSpatialScene([v],structuredClone(x.scene))).toThrow('PREVIOUSLY_REJECTED');const changed={...x.scene,cameras:[{id:'reference',position:[.1,0,0]}]};expect(assertNotRejectedSpatialScene([v],changed)).toBe(changed);expect(x.scene.cameras).toEqual([{id:'reference'}]);}finally{x.close();}
});
