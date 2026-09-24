import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, cpSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { exportSceneModulePack } from '../../scene-generator/apps/composition/backend/src/pack-export/moduleExport.ts';

export function validateBrief(b: any) {
  if (!b.id || !b.semanticBrief || !Array.isArray(b.targets) || !b.targets.length) throw new Error('brief: identity, semantics and targets required');
  if (b.targets.some((t: string) => !['scene-mapping','scene-consistency'].includes(t))) throw new Error('brief: unsupported target');
  if (!/^scene\/[a-z0-9][a-z0-9/-]*$/.test(b.sourceKey)) throw new Error('brief: stable lower-case scene sourceKey required');
  if (!/^[0-9a-f-]{36}$/.test(b.packageId)) throw new Error('brief: package UUID required');
  if (typeof b.entry!=='string'||b.entry.includes('..')||b.entry.startsWith('/')) throw new Error('brief: entry must stay inside source');
  if (!Number.isInteger(b.budget?.maxMaterials)||b.budget.maxMaterials<=0) throw new Error('brief: material budget required');
  if (b.externalAssets?.required) throw new Error('external-asset-provider-not-configured: live search/import receipt required');
  if (!Number.isInteger(b.budget?.maxTriangles) || b.budget.maxTriangles <= 0) throw new Error('brief: triangle budget required');
  return b;
}

export function assertBuiltState(report:any,digest:string){
  if(report.stages?.['engine-build']?.status!=='passed'||report.stages?.catalog?.status!=='passed'||report.buildInputDigest!==digest)throw new Error('consumer inputs changed or build failed: run build');
}

const root=resolve(process.env.ASSET_PIPELINE_ROOT??resolve(import.meta.dirname,'..'));
const dependencies=resolve(import.meta.dirname,'../..'),engine=join(dependencies,'engine');
const cli=join(engine,'packages/engine/dist/bin/forgeax.mjs');
const game=join(root,'game'), evidence=join(root,'evidence');
const reportPath=join(evidence,'run-report.json');
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const treeDigest=(dir:string):string=>hash(readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).map(e=>e.name+':'+(e.isDirectory()?treeDigest(join(dir,e.name)):hash(readFileSync(join(dir,e.name),'utf8')))).join('\n'));
const read=(f:string)=>JSON.parse(readFileSync(f,'utf8'));
const save=(f:string,v:unknown)=>writeFileSync(f,JSON.stringify(v,null,2)+'\n');

async function main(){
  mkdirSync(evidence,{recursive:true});
  const operation=process.argv[2]??'generate';
  const brief=validateBrief(read(join(root,'brief.json')));
  const report=existsSync(reportPath)?read(reportPath):{id:brief.id,stages:{},externalAssets:{status:'not-requested'},browser:{status:'not-run'},spec:{status:'pending-visual-review'}};
  report.engineSha=brief.engineSha; report.generatorSha=brief.generatorSha; report.briefDigest=hash(readFileSync(join(root,'brief.json'),'utf8'));
  const invalidate=(reason:string)=>{report.browser={status:'not-run',reason};report.spec={status:'pending-visual-review'};save(reportPath,report);};
  const generationDigest=hash(report.briefDigest+treeDigest(join(root,'source')));
  if(['build','verify','preview','accept'].includes(operation)){
    const receipt=read(join(evidence,'generation-receipt.json'));
    if(receipt.provenance.generationDigest!==generationDigest){invalidate('generation-inputs-changed');throw new Error('generation inputs changed: run generate before '+operation);}
  }
  const buildInputDigest=()=>hash(treeDigest(join(game,'assets'))+readFileSync(join(game,'forge.json'),'utf8'));
  if(['verify','preview','accept'].includes(operation)){try{assertBuiltState(report,buildInputDigest())}catch(e){invalidate('consumer-inputs-or-build-changed');throw e}}
  if(['preview','accept'].includes(operation)&&['asset-verify','asset-ready','engine-status'].some(k=>report.stages[k]?.status!=='passed'))throw new Error('run verify before preview');
  const stage=async(name:string,fn:()=>any)=>{
    const started=Date.now();report.stages[name]={status:'running'};save(reportPath,report);
    try{const value=await fn(); report.stages[name]={status:'passed',durationMs:Date.now()-started};save(reportPath,report);return value;}
    catch(error){report.stages[name]={status:'failed',durationMs:Date.now()-started,error:String(error)};save(reportPath,report);throw error;}
  };
  const engineCommand=(name:string,args:string[])=>{
    const r=spawnSync(process.execPath.includes('bun')?'node':process.execPath,[cli,...args,'--root',game,'--json'],{cwd:game,encoding:'utf8',env:{...process.env,FORGEAX_SHARED_APP_INPUTS_MANIFEST:join(engine,'shared-build-inputs/manifest.json')},timeout:240000,killSignal:'SIGKILL',maxBuffer:32*1024*1024});
    writeFileSync(join(evidence,name+'.stdout'),r.stdout??'');writeFileSync(join(evidence,name+'.stderr'),r.stderr??'');
    if(r.error||r.status!==0)throw new Error(`${name} exit=${r.status}: ${(r.stderr??'').slice(-1800)} ${(r.stdout??'').slice(-1200)}`);
    let result;try{result=JSON.parse(r.stdout)}catch{throw new Error(`${name}: response is not structured JSON`)}
    if(result.ok===false||result.outcome==='failed')throw new Error(`${name}: ${JSON.stringify(result).slice(-2000)}`);
    return result;
  };
  if(operation==='generate'){
    report.stages={};report.browser={status:'not-run'};report.spec={status:'pending-visual-review'};delete report.catalog;delete report.generated;
    save(reportPath,report);
    await stage('candidate',()=>{
      for(const [dir,sha] of [[engine,brief.engineSha],[join(dependencies,'scene-generator'),brief.generatorSha]]){
        const r=spawnSync('git',['rev-parse','HEAD'],{cwd:dir,encoding:'utf8'});if(r.status||r.stdout.trim()!==sha)throw new Error('candidate SHA mismatch: '+dir);
        const dirty=spawnSync('git',['diff','--quiet','HEAD'],{cwd:dir});if(dirty.status)throw new Error('candidate has tracked changes: '+dir);
      }
    });
    const staging=join(root,'.staging-generated');
    const result=await stage('generate-export',()=>exportSceneModulePack({sourceDir:join(root,'source'),entryFile:brief.entry,exportName:brief.exportName,args:brief.args,packageId:brief.packageId,sourceKey:brief.sourceKey,projectName:brief.name,destination:staging,includeDefaultLighting:false,consumerBuildBudgetMs:brief.budget.consumerBuildMs}));
    await stage('generation-budget',()=>{
      if(result.triangleCount>brief.budget.maxTriangles||result.materialCount>brief.budget.maxMaterials)throw new Error('generated content exceeds declared budget');
      if(result.diagnostics.some((d:any)=>d.severity==='error'))throw new Error('scene diagnostics contain errors');
      if(result.meshCount===0)throw new Error('generated scene is empty');
    });
    await stage('publish-assets',()=>{
      const target=join(game,'assets/generated'),previous=join(root,'.previous-generated');
      if(existsSync(previous))rmSync(previous,{recursive:true});
      if(existsSync(target))renameSync(target,previous);
      try{renameSync(staging,target)}catch(e){if(existsSync(previous))renameSync(previous,target);throw e}
      const identity={sceneGuid:result.sceneGuid,packageId:result.packageId,sourceKey:result.sceneKey};
      save(join(game,'assets/generated-identity.json'),identity);
      writeFileSync(join(game,'assets/generated-identity.ts'),'export default '+JSON.stringify(identity)+' as const;\n');
      save(join(evidence,'generation-receipt.json'),{...result,path:target,provenance:{kind:'procedural-scene-script',generatorSha:brief.generatorSha,sourceHash:hash(readFileSync(join(root,'source',brief.entry),'utf8')),generationDigest}});
      report.generated={sceneGuid:result.sceneGuid,triangles:result.triangleCount,meshes:result.meshCount,materials:result.materialCount};
    });
  } else if(operation==='build'){
    report.browser={status:'not-run'};report.spec={status:'pending-visual-review'};
    for(const key of ['engine-binding','project-check','engine-build','catalog','asset-verify','asset-ready','engine-status'])delete report.stages[key];
    delete report.catalog;save(reportPath,report);
    await stage('engine-binding',()=>engineCommand('engine-binding',['project','engine','use-local',engine]));
    await stage('project-check',()=>engineCommand('project-check',['project','check']));
    await stage('engine-build',()=>engineCommand('project-build',['project','build']));
    await stage('catalog',()=>{
      const catalog=read(join(game,'dist/pack-index.json'));const receipt=read(join(evidence,'generation-receipt.json'));
      const rows=Array.isArray(catalog)?catalog:catalog.entries;
      if(!Array.isArray(rows))throw new Error('catalog rows missing');
      if(!rows.some((r:any)=>r.guid===receipt.sceneGuid&&r.kind==='scene'))throw new Error('generated scene GUID absent from catalog');
      report.catalog={rows:rows.length,kinds:[...new Set(rows.map((r:any)=>r.kind))],sha256:hash(JSON.stringify(catalog))};
      save(join(evidence,'catalog.json'),catalog);
      report.buildInputDigest=buildInputDigest();
      report.distManifestDigest=hash(readFileSync(join(game,'dist/forgeax-dist.json'),'utf8'));
    });
  } else if(operation==='verify'){
    await stage('asset-verify',()=>{const r=engineCommand('asset-verify',['asset','verify']);const s=r.value.summary;if(s.unproducedAssetCount||s.unknownAssetCount||s.unmaterializedScriptablePackCount)throw new Error('Asset verification contains unavailable outputs');return r;});
    const receipt=read(join(evidence,'generation-receipt.json'));
    await stage('asset-ready',()=>engineCommand('asset-ready',['asset','resolve',receipt.sceneGuid,'--require','ready']));
    await stage('engine-status',()=>{const r=engineCommand('engine-status',['project','engine','status']);if(!r.value.healthy||r.value.resolved.root!==engine)throw new Error('Engine binding is not healthy or resolved to another source');return r;});
  } else if(operation==='accept'){
    await stage('browser-acceptance',()=>{
      const b=read(join(evidence,'browser/observations.json'));
      const required=['renderedScene','cruisePositionMotion','hidesHud','restoresHud','spacePauses','arrowMovement'];
      if(b.status!=='passed'||required.some(k=>b.checks?.[k]!==true)||b.consoleWarningsAndErrors?.length||!b.screenshots?.length)throw new Error('Browser evidence incomplete or failed');
      if(b.distManifestDigest!==report.distManifestDigest||b.distManifestDigest!==hash(readFileSync(join(game,'dist/forgeax-dist.json'),'utf8')))throw new Error('Browser evidence belongs to another build');
      for(const path of b.screenshots)if(!existsSync(join(evidence,path)))throw new Error('Missing screenshot evidence: '+path);
      report.browser={...b,evidence:'browser/observations.json'};
      report.spec={status:'passed-for-observed-sample',scope:'Scene mapping/consistency, continuous moving camera, H hide/restore, bounded local preview path; no all-device guarantee'};
    });
  } else if(operation==='preview'){
    console.log('Starting the Engine-owned static preview; keep this terminal running.');
    const p=Bun.spawn(['node',cli,'project','preview','--root',game,'--port',process.env.ASSET_PIPELINE_PORT??'19773','--json'],{cwd:game,stdout:'inherit',stderr:'inherit'});process.exit(await p.exited);
  } else throw new Error('Use generate, build, verify, preview or accept');
  report.updatedAt=new Date().toISOString();save(reportPath,report);console.log(JSON.stringify(report,null,2));
}
if(import.meta.main)await main();
