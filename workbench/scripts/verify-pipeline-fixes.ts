/**
 * Black-box comparison harness for the scene pipeline hardening work.
 * Usage: bun workbench/scripts/verify-pipeline-fixes.ts <workspace-root> > /tmp/<label>.json
 * The same script runs against the pre-fix snapshot and the fixed branch.
 * It imports only modules that exist on both sides and never writes into the workspace.
 * Two read-only fixtures come from workbench/data (ignored by Git): the 4ac6db19 gate
 * record and the c1d77f80 scene spec. Missing fixtures degrade the affected check to skipped.
 */
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const root=process.argv[2]??process.cwd();
const src=(p:string)=>join(root,'workbench/src',p);
const read=(p:string)=>{const f=src(p);return existsSync(f)?readFileSync(f,'utf8'):'';};
const imp=async(p:string)=>import(pathToFileURL(src(p)).href);
const data=(p:string)=>join(root,'workbench/data',p);
const R:any={root,at:new Date().toISOString(),checks:{}};

// 1. Owner approval of a job whose hard gates failed (real record 4ac6db19, 10.9 FPS, style 40/100).
{
 let gate:any;
 try{gate=JSON.parse(readFileSync(data('runs/4ac6db19-c8d5-479c-9a2b-aaf187205c0c/spec-gate.json'),'utf8'));}
 catch{gate={failed:['frameRate'],fps:10.9,hard:{runtime:true,noErrors:true,frameRate:false,build:true,catalog:true},styleJudge:{passed:false,overall:40,verdict:'partial'}};}
 const wf:any=await imp('spec/workflow-v2.ts');
 const job:any={specJob:'spec-job-v1',status:'needs_review',specGate:gate,
  runtime:{hard:{runtime:true,noErrors:true},distManifestDigest:'dist',images:['inspection-1.png'],hashes:['image']},
  specExport:{unresolved:0,proxies:0,dropped:0}};
 const actual={distManifestDigest:'dist',images:{'inspection-1.png':'image'}};
 const attempt=(ack?:string[])=>{try{
  const a=wf.approveSpecReview(job,actual,'2026-11-17T00:00:00Z',ack);
  return {accepted:true,error:null,acknowledged:a.acknowledgedFailures??null,recordedFps:a.fps??null};
 }catch(e){return {accepted:false,error:String(e).slice(0,220),acknowledged:null,recordedFps:null};}};
 const allIssues=typeof wf.specApprovalIssues==='function'?wf.specApprovalIssues(job):['frameRate'];
 R.checks.approval={gateFailed:gate.failed,fps:gate.fps,stylePassed:gate.styleJudge?.passed,
  withoutAck:attempt(),withAck:attempt(allIssues),
  outcomeOnLowFps:wf.specV2Outcome({hard:{runtime:true,noErrors:true,frameRate:false}})};
}

// 2. Spec -> generator contract precheck at upload time (real failing spec c1d77f80).
{
 let available=false,unresolved=-1,errors=-1,sample:string[]=[],schemaErrors=-1,skipped=false;
 let spec:any=null;
 try{spec=JSON.parse(readFileSync(data('runs/c1d77f80-344d-4f9c-aaf9-65a5a807113b/scene-spec.json'),'utf8'));}catch{skipped=true;}
 if(spec){
  try{
   const mod:any=await imp('spec/spec-precheck.ts');available=typeof mod.specPrecheck==='function';
   const r=mod.specPrecheck(spec);unresolved=(r.unresolved??[]).length;errors=(r.errors??[]).length;
   sample=[...(r.unresolved??[]),...(r.errors??[])].slice(0,4).map((x:any)=>String(x.object??x.reason??x).slice(0,140));
  }catch(e){sample=[String(e).slice(0,140)];}
  schemaErrors=(await imp('spec/schema.ts')).sceneSpecErrors(spec).length;
 }
 R.checks.contract={available,wiredIntoStoreSpec:/specPrecheck/.test(read('spec-run.ts')),unresolved,errors,sample,schemaErrorsOnSameSpec:schemaErrors,skipped};
}

// 3. Static/structural checks (each maps to one reported defect).
{
 const ep=read('spec/export-pack.ts'),nm=read('spec/node-models.ts'),nd=read('spec/normalize-doc.ts'),
  pa=read('spec/parallel-assets.ts'),ap=read('spec/asset-previews.ts'),sr=read('spec-run.ts'),
  pkg=readFileSync(join(root,'workbench/package.json'),'utf8');
 R.checks.cache={meshKeyIncludesKitDigest:/meshContentHash\s*=\s*[^;]*GENERATOR_KIT_DIGEST/.test(ep)};
 R.checks.provider={retryImplemented:/retryCbc|for\s*\(\s*let\s+attempt|cbcAttempts/i.test(nm),
  resizeFailureThrows:/CBC4_IMAGE_RESIZE_FAILED|RESIZE_FAILED/.test(nm),
  defaultConcurrency:Number((nd.match(/SPEC_CBC4_CONCURRENCY\|\|\s*(\d+)/)??[])[1]??-1),
  normalizeCacheVersioned:/normalizeImplementationDigest|NORMALIZE_IMPL_DIGEST/.test(sr),
  visualReceiptAlias:/MODEL_RECEIPT_ALIASES/.test(nm)};
 R.checks.worker={watchdog:/watchdog|WATCHDOG|taskTimeoutMs/i.test(pa),
  previewTelemetryLocal:/poolTelemetry/.test(ap)&&/poolTelemetry/.test(sr),
  globalTelemetryStillRead:/getParallelAssetStats\(\)\.lastPoolWorkers/.test(sr)};
 const script=(pkg.match(/"test"\s*:\s*"([^"]+)"/)??[])[1]??'';
 const cliTimeout=Number((script.match(/--timeout\s+(\d+)/)??[])[1]??5000);
 const readme=existsSync(join(root,'README.md'))?readFileSync(join(root,'README.md'),'utf8'):'';
 R.checks.tests={uniformTestEntry:/--timeout/.test(script)&&/bun run test/.test(readme),
  defaultTimeoutMs:cliTimeout,scriptTimeout:/--timeout/.test(pkg)};
 const gateAssign=(sr.match(/job\.specGate=\{[\s\S]{0,700}?\};/)??[''])[0];
 R.checks.reporting={verifyErrorInGate:/verifyError/.test(gateAssign),styleReviewErrorInGate:/styleReviewError/.test(gateAssign),
  gateUsesComputedHard:/specV2Outcome\(\{hard\}\)/.test(sr)||/specV2Outcome\(hard\)/.test(sr)};
 R.checks.hygiene={debugScripts:['.calib-judge.ts','.calib-judge-00.ts','.calib-judge-pool.ts'].filter(f=>existsSync(src(f))).length,
  verifyScriptInRepo:existsSync(join(root,'workbench/scripts/verify-pipeline-fixes.ts'))};
}
// 9. 规格内容 → 生成器契约归一：把 88 项无解参数与灰模代理真正消掉（第二阶段修复）。
{
 const cr=read('spec/contract-reconcile.ts'),sr=read('spec-run.ts'),nd=read('spec/normalize-doc.ts'),wf=read('spec/workflow-v2.ts');
 const reconcileScript=join(root,'workbench/scripts/reconcile-specs.ts');
 const migrationScript=join(root,'workbench/scripts/migrate-historical-spec-reports.ts');
 let unresolvedAfter=-1,proxiesAfter=-1,exportErrorsAfter=-1,constraintFixes=-1;
 try{
  const crMod:any=await imp('spec/contract-reconcile.ts');
  const epMod:any=await imp('spec/export-pack.ts');
  const spec=JSON.parse(readFileSync(data('runs/c1d77f80-344d-4f9c-aaf9-65a5a807113b/scene-spec.json'),'utf8'));
  const {spec:fixed,report}=crMod.reconcileSpec(spec);
  const r=epMod.prepareExportPlacements(fixed).report;
  unresolvedAfter=r.unresolved.length;proxiesAfter=r.proxies.length;exportErrorsAfter=r.errors.length;
  constraintFixes=report.counts.constraint??-1;
 }catch{}
 R.checks.contractReconcile={
  moduleExists:existsSync(src('spec/contract-reconcile.ts')),
  storeSpecReconciles:/reconcileSpec\(input\)/.test(sr),
  planReconciles:/reconcileSpec\(loaded\.spec\)/.test(sr),
  crossParamConstraints:/applyAdaptConstraints/.test(cr),
  generatorProbeInScript:existsSync(reconcileScript)&&/runGenerator/.test(existsSync(reconcileScript)?readFileSync(reconcileScript,'utf8'):''),
  normalizePromptHasFullContract:/paramContract/.test(nd),
  promptRejectsBadValues:/GENERATOR_PARAM_RULES/.test(nd),
  historicalInvalidationWired:/historicalReviewInvalidation/.test(wf),
  migrationScriptExists:existsSync(migrationScript),
  unresolvedAfter,proxiesAfter,exportErrorsAfter,constraintFixes,
 };
}
console.log(JSON.stringify(R,null,2));
