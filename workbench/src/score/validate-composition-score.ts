// Offline validation of composition-score-v1 against recorded graybox evidence. No model calls.
// bun src/score/validate-composition-score.ts <inventory.json> <validation.json>  (inventory from inventory-composition-score.py)
import {readFileSync,existsSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const W=new URL('..',import.meta.url).pathname.replace(/\/$/,'');
const {compositionScore}=await import(W+'/score/composition-score.ts');
const {referenceComposition}=await import(W+'/geometry/reference-composition.ts');
const inv=JSON.parse(readFileSync(process.argv[2],'utf8'));
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const clone=(x:any)=>JSON.parse(JSON.stringify(x));
const out:any[]=[];const limit=Number(process.env.LIMIT??1e9);let n=0;
for(const r of inv){
 if(r.kind!=='graybox'||!r.rc||r.gate==null||!r.render)continue;if(n++>=limit)break;
 const jd=join(r.root,r.job),b=join(jd,r.folder);
 const stored=read(join(b,'reference-composition.json')),gate=read(join(b,'gate.json'));
 const obsFile=join(jd,'generation/reference-observations.json');
 const rec:any={job:r.job,root:r.root,round:r.folder,version:stored.version,judge:gate.review.score,judgeConfidence:gate.review.confidence,passed:gate.passed,
  critRel:(gate.review.relations??[]).filter((x:any)=>x.critical!==false).map((x:any)=>x.score),stored:compositionScore(stored)};
 delete rec.stored.perRow;
 if(existsSync(join(b,'judge-consensus/consensus.json'))){const c=read(join(b,'judge-consensus/consensus.json'));rec.replicas=c.reviews?.map((x:any)=>({score:x.score,passed:x.passed,failed:x.failed?.length??0}));}
 try{
  const scene=read(join(b,'render-scene.json')),obs=read(obsFile),opt={version:stored.version};
  const base=referenceComposition(scene,obs,undefined,opt),bs=compositionScore(base);
  rec.recomputed=bs.score;rec.reproduced=Math.abs((bs.score??-1)-(rec.stored.score??-1))<1e-9;
  // Probe target: the critical measured landmark with most visible pixels.
  const area=(x:any)=>(x.visible[2]-x.visible[0])*(x.visible[3]-x.visible[1]);const rows=stored.rows.filter((x:any)=>x.critical&&x.status==='measured-visible-extent'&&area(x)>=.01&&area(x)<=.25).sort((a:any,b2:any)=>a.edgeResidual-b2.edgeResidual);
  const t=rows[0];
  if(t){
   const ids=new Set<string>(t.measuredInstanceIds??t.instanceIds);
   const insts=scene.program.instances,pos=insts.map((i:any)=>i.position),ext=[0,1,2].map(k=>Math.max(...pos.map((p:any)=>p[k]))-Math.min(...pos.map((p:any)=>p[k]))),diag=Math.hypot(...ext)||1;
   const probe=(name:string,mutate:(s:any)=>void)=>{try{const s=clone(scene);mutate(s);const p=compositionScore(referenceComposition(s,obs,undefined,opt));rec['probe_'+name]={score:p.score,criticalMisses:p.criticalMisses,drop:(bs.score??0)-(p.score??0),targetFit:p.perRow.find((x:any)=>x.landmarkId===t.landmarkId&&x.referenceIndex===t.referenceIndex)?.fit??null};}catch(e){rec['probe_'+name]={error:String(e).slice(0,160)};}};
   rec.probeTarget={landmark:t.landmarkId,instances:[...ids]};
   rec.baseCriticalMisses=bs.criticalMisses;rec.probeTarget.baseFit=bs.perRow.find((x:any)=>x.landmarkId===t.landmarkId&&x.referenceIndex===t.referenceIndex)?.fit??null;
   probe('delete',s=>{for(const i of s.program.instances)if(ids.has(i.id))i.scale=[.001,.001,.001];});
   probe('move',s=>{for(const i of s.program.instances)if(ids.has(i.id))i.position=[i.position[0]+.25*diag,i.position[1],i.position[2]];});
   probe('shrink',s=>{for(const i of s.program.instances)if(ids.has(i.id))i.scale=i.scale.map((v:number)=>v*.5);});
   probe('camera',s=>{for(const c of s.cameras){const d=[0,1,2].map(k=>c.target[k]-c.position[k]),L=Math.hypot(d[0],d[1]);const side=[-d[1]/L,d[0]/L];const m=.15*Math.hypot(...d);c.target=[c.target[0]+side[0]*m,c.target[1]+side[1]*m,c.target[2]];}});
   probe('mirror',s=>{for(const i of s.program.instances)i.position=[-i.position[0],i.position[1],i.position[2]];});
  }
 }catch(e){rec.recomputeError=String(e).slice(0,200);}
 out.push(rec);console.error(n,r.job.slice(0,8),r.folder,rec.stored.score?.toFixed(1),rec.reproduced,rec.recomputeError??'');
}
writeFileSync(process.argv[3],JSON.stringify(out,null,1));
