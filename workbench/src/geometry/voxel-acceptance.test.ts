import {test,expect} from 'bun:test';
import {readFileSync} from 'node:fs';
import {basename,join} from 'node:path';
import {objectiveAcceptance,objectiveBlockers,objectiveGateRule,objectiveMarginal,objectiveProgressScore,objectiveRepairFeedback,voxelAcceptanceRule,withObjectiveAcceptance,ORDINARY_ACCEPTANCE,VOXEL_ACCEPTANCE,OBJECTIVE_PROGRESS} from './voxel-acceptance';
import {scoreProgress,IMPROVEMENT_LIMITS} from '../improvement-governance';
import {selectSpatialCandidate} from './blockout-selection';
import {recordedRun} from '../recorded-runs';

// Shapes follow the recorded voxel rounds: judge 3.0 under the 3.5 threshold, critical rows at 2.5–3, measured landmark boxes within .05.
const space={voxelLattice:{version:'voxel-lattice-v1'},spatialRelations:[{id:'R1',critical:true},{id:'R2',critical:true},{id:'R3',critical:false}]};
const observation={landmarks:['a','b','c','d'].map(id=>({id,critical:true})).concat([{id:'e',critical:false}])};
const boxes:Record<string,number[]>={a:[.05,.5,.35,.9],b:[.6,.1,.9,.45],c:[.4,.4,.6,.7],d:[.1,.05,.3,.3]};
function composition(shift=.02,mirror=false,extent='partial'){
 return {rows:Object.entries(boxes).map(([landmarkId,expected])=>{const visible=mirror?[1-expected[2],expected[1],1-expected[0],expected[3]]:expected.map(v=>v+shift);
  const delta=visible.map((v,k)=>v-expected[k]);return {landmarkId,critical:true,referenceIndex:1,extent,expected,visible,edgeResidual:Math.sqrt(delta.reduce((s,d)=>s+d*d,0)/4),pixels:400,status:'measured-visible-extent'};})};
}
const gate=(scores=[3,2.5,2],verdicts=['partial','partial','partial'],score=3)=>({passed:false,failed:['R2'],protocol:'spatial-composition-v3',threshold:{space:3.5,critical:3,confidence:.6},
 review:{score,confidence:.9,relations:['R1','R2','R3'].map((id,i)=>({id,score:scores[i],verdict:verdicts[i],reason:'可见',frames:['reference-1.png']}))}});

test('only new voxel jobs under the policy accept on objective evidence',()=>{
 expect(voxelAcceptanceRule({voxelAcceptancePolicy:VOXEL_ACCEPTANCE})).toBe(true);
 expect(voxelAcceptanceRule({voxelAcceptancePolicy:null})).toBe(false);
 expect(voxelAcceptanceRule({})).toBe(false);
});

test('a runnable, complete and aligned graybox passes although the judge proportion score is 3.0',()=>{
 const g=withObjectiveAcceptance(gate(),space,composition(),observation);
 expect(g.passed).toBe(true);expect(g.vlmPassed).toBe(false);expect(g.failed).toEqual(['R2']);
 expect(g.objective.advisory).toMatchObject({score:3,threshold:3.5,passed:false});
 expect(g.objective.metrics.edgeResidual).toBeCloseTo(.02,4);
});

test('a missing or grossly wrong critical relation still blocks; non-critical rows do not',()=>{
 expect(objectiveAcceptance(gate([3,2.5,0],['partial','partial','missing']),space,composition(),observation).passed).toBe(true);
 const missing=objectiveAcceptance(gate([3,2.5,2],['missing','partial','partial']),space,composition(),observation);
 expect(missing.passed).toBe(false);expect(missing.reasons.join()).toContain('R1');
 const low=objectiveAcceptance(gate([3,2,2]),space,composition(),observation);
 expect(low.passed).toBe(false);expect(low.checks.find((c:any)=>c.id==='critical-floor').passed).toBe(false);
 const weak={...gate(),review:{...gate().review,confidence:.5}};
 expect(objectiveAcceptance(weak,space,composition(),observation).passed).toBe(false);
});

test('a left-right mirrored layout fails with the measured centre errors',()=>{
 const o=objectiveAcceptance(gate(),space,composition(0,true),observation);
 expect(o.passed).toBe(false);expect(o.metrics.mirror[0].mirroredLayout).toBe(true);
 expect(o.checks.find((c:any)=>c.id==='not-mirrored').passed).toBe(false);
});

test('misaligned landmarks, an invisible critical landmark or no measurement fail',()=>{
 expect(objectiveAcceptance(gate(),space,composition(.15),observation).checks.find((c:any)=>c.id==='landmark-alignment').passed).toBe(false);
 expect(objectiveAcceptance(gate(),space,composition(.12,false,'complete'),observation).checks.find((c:any)=>c.id==='complete-extent').passed).toBe(true);
 expect(objectiveAcceptance(gate(),space,composition(.2,false,'complete'),observation).checks.find((c:any)=>c.id==='complete-extent').passed).toBe(false);
 const hidden=composition();hidden.rows=hidden.rows.filter(r=>r.landmarkId!=='d');
 const h=objectiveAcceptance(gate(),space,hidden,observation);expect(h.passed).toBe(false);expect(h.reasons.join()).toContain('d');
 // A landmark proven visible only through its bound instances still counts as visible.
 const bound=composition();bound.rows[3]={landmarkId:'d',critical:true,referenceIndex:1,status:'unverified',boundInstanceEvidence:{pixels:90}} as any;
 expect(objectiveAcceptance(gate(),space,bound,observation).checks.find((c:any)=>c.id==='critical-visible').passed).toBe(true);
 expect(objectiveAcceptance(gate(),space,{rows:[]},observation).passed).toBe(false);
 expect(objectiveAcceptance(gate(),space,composition(),null).passed).toBe(false);
});

test('re-review is spent only when the measured checks pass and a critical row is near the floor',()=>{
 expect(objectiveMarginal(withObjectiveAcceptance(gate([3,2.5,2]),space,composition(),observation),space)).toBe(true);
 expect(objectiveMarginal(withObjectiveAcceptance(gate([3,3.5,2]),space,composition(),observation),space)).toBe(false);
 expect(objectiveMarginal(withObjectiveAcceptance(gate([3,2.5,2]),space,composition(0,true),observation),space)).toBe(false);
});

test('a measured blocker the judge never scored reaches the repair input with its bound instances',()=>{
 const hidden=composition();hidden.rows[3]={landmarkId:'d',critical:true,referenceIndex:1,status:'unverified',extent:'occluded',pixels:0,expected:[.1,.05,.3,.3],instanceIds:['pool']} as any;
 // A measured non-critical row keeps four rows for the mirror check.
 hidden.rows.push({...hidden.rows[0],landmarkId:'e',critical:false});
 const f=objectiveRepairFeedback(withObjectiveAcceptance(gate([3,3,3]),space,hidden,observation),hidden)!;
 expect(f.failed.map((c:any)=>c.id)).toEqual(['critical-visible']);
 expect(f.hiddenLandmarks).toEqual([{landmarkId:'d',referenceIndex:1,instanceIds:['pool'],extent:'occluded',expected:[.1,.05,.3,.3],pixels:0}]);
 // Other measured blockers carry their detail without hidden landmarks; an accepted or judge-only round adds nothing.
 const flipped=objectiveRepairFeedback(withObjectiveAcceptance(gate(),space,composition(0,true),observation),composition(0,true))!;
 expect(flipped.failed.map((c:any)=>c.id)).toContain('not-mirrored');expect(flipped.hiddenLandmarks).toEqual([]);
 expect(objectiveRepairFeedback(withObjectiveAcceptance(gate(),space,composition(),observation),composition())).toBeNull();
 expect(objectiveRepairFeedback(gate(),composition())).toBeNull();
});

test.skipIf(!recordedRun('bbb70515'))('recorded temple round: the rear pool the judge never scored below 2.5 is named with its instance',()=>{
 // Read-only scan of the recorded 2026-10-18 round 1.
 const read=(f:string)=>JSON.parse(readFileSync(join(recordedRun('bbb70515')!,'generation/blockout/1',f),'utf8'));
 const f=objectiveRepairFeedback(read('gate.json'),read('reference-composition.json'))!;
 expect(f.failed.map((c:any)=>c.id)).toEqual(['critical-visible']);
 expect(f.hiddenLandmarks.map((h:any)=>[h.landmarkId,h.instanceIds,h.pixels])).toEqual([['rear_pool',['water_rear_pool'],0]]);
});

test('an objectively accepted round becomes the retained candidate even when it opens judge rows below 3',()=>{
 const previous={jobId:'j',round:0,folder:'0',space,gate:withObjectiveAcceptance(gate([3,2,2],undefined,3.1),space,composition(),observation)};
 const current={jobId:'j',round:1,folder:'1',space,gate:{...withObjectiveAcceptance(gate([2.5,2.5,2],undefined,2.9),space,composition(),observation),failed:['R1','R2']}};
 expect(previous.gate.passed).toBe(false);expect(current.gate.passed).toBe(true);
 const s=selectSpatialCandidate(previous,current,{netClosure:true,swap:true});
 expect(s.candidate).toBe(current);expect(s.eligible).toBe(true);
});

test('objective blockers count what the gate itself still rejects, not the judge 3.0 row list',()=>{
 // A measured non-critical row keeps four rows for the mirror check.
 const hidden=composition();hidden.rows=hidden.rows.filter(r=>r.landmarkId!=='d');hidden.rows.push({...hidden.rows[0],landmarkId:'e',critical:false});
 const b=objectiveBlockers(withObjectiveAcceptance(gate([3,2,2]),space,hidden,observation),space)!;
 expect(b).toEqual({geometry:[],relations:['R2'],hidden:['d'],items:2});
 expect(objectiveBlockers(withObjectiveAcceptance(gate(),space,composition(0,true),observation),space)!.geometry).toEqual(['not-mirrored','landmark-alignment']);
 expect(objectiveBlockers(gate(),space)).toBeNull();
 // One closed item is a ledger gain whatever the judge did; the judge alone only ranks equal rounds.
 const two=objectiveProgressScore(withObjectiveAcceptance(gate([3,2,2],undefined,3.2),space,hidden,observation),space)!,one=objectiveProgressScore(withObjectiveAcceptance(gate([3,2.5,2],undefined,2.8),space,hidden,observation),space)!;
 expect(one-two).toBeGreaterThanOrEqual(IMPROVEMENT_LIMITS.minGain);
 const same=objectiveProgressScore(withObjectiveAcceptance(gate([3,2,2],undefined,4),space,hidden,observation),space)!;
 expect(same-two).toBeGreaterThan(0);expect(same-two).toBeLessThan(IMPROVEMENT_LIMITS.minGain);
});

test.skipIf(!recordedRun('a9b29207'))('recorded temple r7: 7 → 2 blockers becomes the next basis and a ledger gain instead of the second no-gain round',()=>{
 // Read-only replay of the recorded 2026-10-18 rounds 0 and 1.
 const root=recordedRun('a9b29207')!,run=basename(root);
 const at=(n:number)=>{const dir=join(root,'generation/blockout',String(n)),r=(f:string)=>JSON.parse(readFileSync(join(dir,f),'utf8'));return {jobId:run,round:n,folder:dir,space:r('space.json'),gate:r('gate.json')};};
 const [r0,r1]=[at(0),at(1)];
 expect([objectiveBlockers(r0.gate,r0.space)!.items,objectiveBlockers(r1.gate,r1.space)!.items]).toEqual([7,2]);
 // Recorded rule: the new 2.0 row kept round 0 and the ledger saw a non-eligible round.
 expect(selectSpatialCandidate(r0,r1,{netClosure:true,swap:true}).candidate).toBe(r0);
 const s=selectSpatialCandidate(r0,r1,{netClosure:true,swap:true,objective:true});
 expect(s.candidate).toBe(r1);expect(s.eligible).toBe(true);
 const row=(c:any)=>({kind:'space',comparison:c.gate.protocol,jobId:run,metric:OBJECTIVE_PROGRESS,score:objectiveProgressScore(c.gate,c.space),assessmentScope:'legacy-unknown'});
 expect(scoreProgress([row(r0)],{...row(r1),requiresDiagnosis:!s.eligible},IMPROVEMENT_LIMITS.minGain)).toMatchObject({improved:true,noGain:0});
});

test('objective selection keeps the source when blockers rise and defers to the judge rule when they are equal',()=>{
 // A measured non-critical row keeps four rows for the mirror check.
 const hidden=composition();hidden.rows=hidden.rows.filter(r=>r.landmarkId!=='d');hidden.rows.push({...hidden.rows[0],landmarkId:'e',critical:false});
 const one={jobId:'j',round:0,folder:'0',space,gate:withObjectiveAcceptance(gate([3,3,3],undefined,3),space,hidden,observation)};
 const two={jobId:'j',round:1,folder:'1',space,gate:{...withObjectiveAcceptance(gate([3,2,3],undefined,3.4),space,hidden,observation),failed:['R2']}};
 const worse=selectSpatialCandidate(one,two,{netClosure:true,swap:true,objective:true});
 expect(worse.candidate).toBe(one);expect(worse.eligible).toBe(false);expect(worse.reason).toContain('客观阻断增加');
 const even={...one,round:1,folder:'1',gate:{...one.gate,review:{...one.gate.review,score:3.2}}};
 expect(selectSpatialCandidate(one,even,{objective:true}).reason).toBe('空间分提高且没有新增关键阻断');
});

test('detail-scale critical rows do not hold the graybox gate; untagged rows keep the old floor',()=>{
 const tiered={...space,spatialRelations:[{id:'R1',critical:true,scale:'layout'},{id:'R2',critical:true,scale:'detail'},{id:'R3',critical:false,scale:'layout'}]};
 const low=gate([3,1.5,2],['partial','missing','partial']);
 expect(objectiveAcceptance(low,space,composition(),observation).passed).toBe(false);
 const o=objectiveAcceptance(low,tiered,composition(),observation);
 expect(o.passed).toBe(true);expect(o.metrics.criticalMinimum).toBe(3);
 expect(o.deferredDetail.relations).toEqual([{id:'R2',score:1.5,verdict:'missing'}]);
 expect(objectiveAcceptance(low,space,composition(),observation).deferredDetail).toBeUndefined();
 const g=withObjectiveAcceptance(low,tiered,composition(),observation);
 expect(objectiveBlockers(g,tiered)).toMatchObject({relations:[],items:0});expect(objectiveMarginal(g,tiered)).toBe(false);
 expect(objectiveAcceptance(gate([2,1.5,3]),tiered,composition(),observation).passed).toBe(false);
});

test.skipIf(!recordedRun('c086a0b9'))('recorded cyberpunk street: with facade rows tagged detail, round 0 passes on the same review and measurement',()=>{
 const dir=join(recordedRun('c086a0b9')!,'generation/blockout/0'),g=JSON.parse(readFileSync(join(dir,'gate.json'),'utf8')),s=JSON.parse(readFileSync(join(dir,'space.json'),'utf8'));
 const c=JSON.parse(readFileSync(join(dir,'reference-composition.json'),'utf8')),obs=JSON.parse(readFileSync(join(dir,'../../reference-observations.json'),'utf8'));
 expect(withObjectiveAcceptance(g,s,c,obs).objective.passed).toBe(false);
 const detail=new Set(['rel_left_balcony_openings','rel_right_balcony_openings','rel_left_sign_layout','rel_right_sign_layout','rel_left_shop','rel_left_ac_distribution','rel_right_ac_distribution','rel_pipe_distribution','rel_lamp_foreground']);
 const tiered={...s,spatialRelations:s.spatialRelations.map((r:any)=>({...r,scale:detail.has(r.id)?'detail':'layout'}))};
 const o=withObjectiveAcceptance(g,tiered,c,obs).objective;
 expect(o.passed).toBe(true);expect(o.deferredDetail.relations.map((r:any)=>r.id)).toContain('rel_left_balcony_openings');
});

test('ordinary jobs under the ordinary policy use the objective gate; voxel still needs its lattice; older jobs keep the judge threshold',()=>{
 const ordinary={spatialRelations:[]},voxel={voxelLattice:{version:'voxel-lattice-v1'},spatialRelations:[]};
 expect(objectiveGateRule({grayboxAcceptancePolicy:ORDINARY_ACCEPTANCE},ordinary)).toBe(true);
 expect(objectiveGateRule({grayboxAcceptancePolicy:null},ordinary)).toBe(false);
 expect(objectiveGateRule({},ordinary)).toBe(false);
 expect(objectiveGateRule({voxelAcceptancePolicy:VOXEL_ACCEPTANCE},voxel)).toBe(true);
 expect(objectiveGateRule({voxelAcceptancePolicy:VOXEL_ACCEPTANCE},ordinary)).toBe(false);
});
