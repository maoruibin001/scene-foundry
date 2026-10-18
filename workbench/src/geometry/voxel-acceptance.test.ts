import {test,expect} from 'bun:test';
import {objectiveAcceptance,objectiveMarginal,voxelAcceptanceRule,withObjectiveAcceptance,VOXEL_ACCEPTANCE} from './voxel-acceptance';
import {selectSpatialCandidate} from './blockout-selection';

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

test('an objectively accepted round becomes the retained candidate even when it opens judge rows below 3',()=>{
 const previous={jobId:'j',round:0,folder:'0',space,gate:withObjectiveAcceptance(gate([3,2,2],undefined,3.1),space,composition(),observation)};
 const current={jobId:'j',round:1,folder:'1',space,gate:{...withObjectiveAcceptance(gate([2.5,2.5,2],undefined,2.9),space,composition(),observation),failed:['R1','R2']}};
 expect(previous.gate.passed).toBe(false);expect(current.gate.passed).toBe(true);
 const s=selectSpatialCandidate(previous,current,{netClosure:true,swap:true});
 expect(s.candidate).toBe(current);expect(s.eligible).toBe(true);
});
