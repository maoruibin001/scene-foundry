import {existsSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {read,save,digest,saveJob} from '../store';
import {stable} from '../validated-cache';
import {applyGrayboxSpaceRepair,grayboxSpaceRepairSchema} from './graybox-space-repair';
import {createGrayboxSpacePreview} from './graybox-space-preview';
import {buildGrayboxPartScene} from './graybox-local-parts';
import {validateSpace} from './layout-stages';
import {bindObservedSpace} from './reference-observations';
import {spatialInstances} from './spatial-order';

/** Re-open the actual selection evidence for normal handoff and later checkpoint recovery. */
export function reviewedGrayboxGeometry(repairFolder:string,ctx:any){
 const receipt=read(join(repairFolder,'repair-receipt.json')),source=read(join(receipt.sourceFolder,'scene.json')),space=read(join(receipt.sourceFolder,'space.json')),patch=read(join(repairFolder,'patch.json'));
 const contractVersion=read(join(repairFolder,'preview/graybox-preview-audit.json')).version;
 const preview=createGrayboxSpacePreview({space,sourceScene:source,observation:contractVersion==='graybox-space-preview-v2'?undefined:ctx.observation,contractVersion,images:ctx.images,folder:join(repairFolder,'preview'),signal:ctx.signal,schema:grayboxSpaceRepairSchema(),
  apply:p=>applyGrayboxSpaceRepair(space,p,v=>{const s=validateSpace(v,ctx.plan,ctx.images.length,ctx.job.complexity);return ctx.observation?bindObservedSpace(s,ctx.observation):s;}),buildScene:(s,p)=>buildGrayboxPartScene(source,s,p,ctx.plan,ctx.images.length),render:async()=>{throw Error('read-only geometry verification cannot render');}});
 const selected=preview.assertReviewed(patch),scene=read(join(repairFolder,'reviewed-scene.json'));
 if(stable(selected)!==stable(receipt.preview)||digest(stable(scene))!==selected.canonicalSceneSha256)throw Error('灰模部件保存与真实预览摘要不符');
 return {scene,patch,receipt,selected};
}

export function persistReviewedGrayboxGeometry(repairFolder:string,space:any,ctx:any,folder:string){
 const v=reviewedGrayboxGeometry(repairFolder,ctx);
 if(stable(v.scene.cameras)!==stable(space.cameras)||stable(v.scene.program.instances)!==stable(spatialInstances(space.program.instances)))throw Error('灰模部件交接空间不一致');
 const changed=new Set([...v.patch.parts.map(p=>p.templateId),...(v.patch.groups??[]).map(p=>p.templateId)]),templates=v.scene.program.templates;
 const proof={version:'reviewed-graybox-geometry-v1',repairFolder,canonicalSceneSha256:v.selected.canonicalSceneSha256,selectedPatchSha256:v.selected.patchSha256};
 save(join(folder,'graybox-parts-source.json'),proof);
 for(const t of templates){const dir=join(folder,'templates',t.id);mkdirSync(dir,{recursive:true});save(join(dir,'geometry.json'),{templates:[t]});}
 const progress={total:templates.length,completed:templates.length,reused:templates.length-changed.size,patched:changed.size,active:0,peak:0,concurrency:1,modelRequests:0,steps:templates.map(t=>({id:t.id,status:changed.has(t.id)?'patched':'reused',source:proof}))};
 save(join(folder,'template-progress.json'),progress);ctx.job.blockout.templateProgress=progress;saveJob(ctx.job);
 return {value:{templates}};
}

export function recoverReviewedGrayboxGeometry(folder:string,ctx:any){
 const file=join(folder,'graybox-parts-source.json');if(!existsSync(file))return null;
 const proof=read(file),v=reviewedGrayboxGeometry(proof.repairFolder,ctx);
 if(proof.version!=='reviewed-graybox-geometry-v1'||proof.canonicalSceneSha256!==v.selected.canonicalSceneSha256||proof.selectedPatchSha256!==v.selected.patchSha256)throw Error('灰模部件恢复来源变化');
 const scene=read(join(folder,'scene.json'));
 if(stable(scene.program.templates)!==stable(v.scene.program.templates))throw Error('灰模部件恢复网格变化');
 return v.scene.program.templates;
}
