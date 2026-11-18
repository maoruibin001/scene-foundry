/**
 * A/B harness: does the selected visual node really see pixels and pass verifiedVisualReview?
 * Makes one real model call (cbc5, may consume quota). Fixtures: two 48x48 solid-color PNGs
 * generated in /tmp/sf-visual-out by the comparison runbook.
 * Usage: bun workbench/scripts/verify-visual-route.ts <workspace-root>
 */
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=process.argv[2]??process.cwd();
const imp=(p:string)=>import(pathToFileURL(join(root,'workbench/src',p)).href);
const {callSpecNode}=await imp('spec/node-models.ts');
const {VISUAL_SCHEMA,verifiedVisualReview}=await imp('spec/visual-review.ts');
const {STYLE_SYSTEM}=await imp('spec-run.ts');
const images=[{path:'/tmp/sf-visual-out/ref.png',mime:'image/png'},{path:'/tmp/sf-visual-out/shot.png',mime:'image/png'}];
const selection:any={provider:'cbc5',model:'hy4flash-dev',reasoningEffort:'medium'};
const dir='/tmp/sf-visual-out-'+(root.includes('pre-fix')?'pre':'post');
const started=Date.now();
try{
 const r=await callSpecNode({role:'spec-style-judge',system:STYLE_SYSTEM,
  text:JSON.stringify({scene:'视觉路由连通性自检',conceptImages:['纯红色参考图'],screenshots:['纯蓝色截图'],shotLabels:['自检图']}),
  images,signal:AbortSignal.timeout(180000)},dir,selection,VISUAL_SCHEMA);
 const parsed=JSON.parse(r.text);
 let verified=false,verifyError:any=null;
 try{verified=Boolean(verifiedVisualReview(parsed,images.length));}catch(e){verifyError=String(e).slice(0,300);}
 console.log(JSON.stringify({root,ok:true,durationMs:Date.now()-started,evidenceStatus:parsed.evidence?.status,
  observations:parsed.evidence?.observations?.length??0,overall:parsed.overall,verdict:parsed.verdict,
  verified,verifyError,returnedModel:r.receipt?.returnedModel},null,2));
}catch(e){console.log(JSON.stringify({root,ok:false,durationMs:Date.now()-started,error:String(e).slice(0,400)},null,2));}
