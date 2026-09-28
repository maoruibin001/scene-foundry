import {mkdirSync,existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {ROOT,DATA,runDir,save,read,digest} from '../store';
import {assetInput} from './asset-input';

export function assetEvidencePlan(layout:any,brief:any,observation:any){
 const instances=layout.program.instances.filter(i=>i.template===brief.id),ids=new Set(instances.map(i=>i.id));
 const landmarks=new Set((layout.observedBindings??[]).filter(b=>b.instanceIds.some(id=>ids.has(id))).map(b=>b.landmarkId));
 const evidence=(observation?.landmarks??[]).filter(l=>landmarks.has(l.id));
 const crops=evidence.flatMap(l=>l.views.map(v=>({...v,landmarkId:l.id,label:l.label}))).sort((a,b)=>((b.box[2]-b.box[0])*(b.box[3]-b.box[1]))-((a.box[2]-a.box[0])*(a.box[3]-a.box[1]))).slice(0,4);
 return {evidence,crops,referenceCameras:layout.cameras.filter(c=>c.referenceIndex!==null)};
}

/** 只裁切本次输入、展示注册表原像素；不调用模型，不把生成画面当作参考。 */
export async function prepareAssetEvidence(ctx:any,layout:any,brief:any,textures:any,folder:string){
 let observation=ctx.observation;
 const observationFile=join(runDir(ctx.job.id),'generation/reference-observations.json');
 if(!observation&&existsSync(observationFile))observation=read(observationFile);
 const plan=assetEvidencePlan(layout,brief,observation),input=assetInput(ctx.job.prompt,ctx.plan,layout,brief,textures);
 const selected=input.textureRegistry.slice(0,6).map(t=>({id:t.id,...textures[t.id]}));
 const output=join(folder,'reference-evidence');mkdirSync(output,{recursive:true});
 save(join(output,'request.json'),{references:ctx.images,crops:plan.crops,textures:selected});
 const python=join(DATA,'reconstruction-env/bin/python');
 const process=Bun.spawn([python,join(ROOT,'src/geometry/asset-evidence.py'),output],{stdout:'pipe',stderr:'pipe',signal:ctx.signal});
 const stderr=new Response(process.stderr).text(),stdout=new Response(process.stdout).text();
 const code=await process.exited;await stdout;
 if(code!==0)throw Error('资产局部图片准备失败：'+(await stderr).slice(-1200));
 const receipt=read(join(output,'receipt.json'));
 const images=receipt.images.map(i=>({path:join(output,i.file),mime:'image/png'}));
 save(join(folder,'reference-evidence.json'),{...receipt,referenceSha256:ctx.images.map(i=>digest(readFileSync(i.path)))});
 return {images,context:{referenceEvidence:plan.evidence,referenceCameras:plan.referenceCameras,imageOrder:[...ctx.images.map((_,n)=>'原始参考图 '+(n+1)),...receipt.images.map(i=>i.label)]}};
}
