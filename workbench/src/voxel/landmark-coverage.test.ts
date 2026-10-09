import {test,expect} from 'bun:test';
import {GEOMETRY_SCOPES,STRICT_VOXEL_CONSTRUCTION,validateVoxelLandmarkCoverage,voxelComponentRequirements,VoxelLandmarkCoverageError} from './landmark-coverage';

const landmark=(id:string,geometryScope:any,critical=true)=>({id,label:id,geometryScope,critical,views:[{referenceIndex:1,box:[.1,.1,.4,.5],extent:'occluded',evidence:'原图可见轮廓'}]});
const template=(id:string)=>({id,bounds:{min:[0,0,0],max:[1,1,2]}});
const instance=(id:string,template:string)=>({id,template,position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]});
function fixture(){
 return {observation:{landmarks:[landmark('wall','object'),landmark('clusters','component'),landmark('opening','void'),landmark('ruin','group')]},
  space:{voxelLattice:{version:STRICT_VOXEL_CONSTRUCTION,cellSize:.1},program:{templates:[template('t_wall'),template('t_cluster')],instances:[instance('i_wall','t_wall'),instance('i_cluster_a','t_cluster'),instance('i_cluster_b','t_cluster')]},observedBindings:[
   {landmarkId:'wall',instanceIds:['i_wall']},{landmarkId:'clusters',instanceIds:['i_cluster_a','i_cluster_b']},{landmarkId:'opening',instanceIds:['i_wall']},{landmarkId:'ruin',instanceIds:['i_wall','i_cluster_a','i_cluster_b']}]} };
}
test('strict wall and repeated components own their instances; void and grouping may share them',()=>{
 const {space,observation}=fixture();
 observation.landmarks[1].views.push({...observation.landmarks[1].views[0],referenceIndex:2});
 const before=structuredClone({space,observation});
 const report=validateVoxelLandmarkCoverage(space,observation);
 expect(report.applicable).toBe(true);expect(report.quality).toBe('not-assessed');
 expect(report.rows!.find(r=>r.landmarkId==='clusters')!.exclusiveInstanceIds).toEqual(['i_cluster_a','i_cluster_b']);
 expect({space,observation}).toEqual(before);expect(observation.landmarks).toHaveLength(4);
});
test('actual five-view plant aliases cannot borrow whole walls even with one genuine platform cluster',()=>{
 const hosts=['left_wall','rear_wall','right_wall','portal','pavilion'],plant=landmark('green_attachments','component');
 plant.views=Array.from({length:5},(_,i)=>({...plant.views[0],box:[i*.1,.1,i*.1+.05,.5]}));
 const observation={landmarks:[...hosts.map(id=>landmark(id,'object')),plant]};
 const space={voxelLattice:{version:STRICT_VOXEL_CONSTRUCTION},program:{templates:[template('host'),template('cluster')],instances:[...hosts.map(id=>instance('i_'+id,'host')),instance('i_green','cluster')]},observedBindings:[...hosts.map(id=>({landmarkId:id,instanceIds:['i_'+id]})),{landmarkId:'green_attachments',instanceIds:[...hosts.map(id=>'i_'+id),'i_green']}]};
 expect(()=>validateVoxelLandmarkCoverage(space,observation)).toThrow('不能混入其他主体实例');
});
test('distinct names and labels do not legitimize a duplicate object/component alias',()=>{
 const {space,observation}=fixture();observation.landmarks[1].label='装饰分组';space.observedBindings[1].instanceIds=['i_wall'];
 expect(()=>validateVoxelLandmarkCoverage(space,observation)).toThrow('没有独立实例');
});
test('critical objects need an exclusive instance; all groups and void references are excluded from ownership',()=>{
 const {space,observation}=fixture();observation.landmarks.push(landmark('alias','object',false));space.observedBindings.push({landmarkId:'alias',instanceIds:['i_wall']});
 expect(()=>validateVoxelLandmarkCoverage(space,observation)).toThrow('wall');
});
test('a critical group may aggregate components but cannot alias a nonvoid set with reversed order',()=>{
 const {space,observation}=fixture();space.observedBindings[3].instanceIds=['i_cluster_b','i_cluster_a'];
 expect(()=>validateVoxelLandmarkCoverage(space,observation)).toThrow('相同绑定集合');
 space.observedBindings[3].instanceIds=['i_wall','i_cluster_a'];
 expect(validateVoxelLandmarkCoverage(space,observation).applicable).toBe(true);
});
test('a critical group may equal a void host set when no other nonvoid has that set',()=>{
 const {space,observation}=fixture();space.observedBindings[2].instanceIds=['i_wall','i_cluster_a'];space.observedBindings[3].instanceIds=['i_cluster_a','i_wall'];
 expect(validateVoxelLandmarkCoverage(space,observation).applicable).toBe(true);
});
test('strict scope is explicit and checked for noncritical rows, never inferred from wording',()=>{
 for(const scope of [undefined,null,'plant','OBJECT']){
  const {space,observation}=fixture();observation.landmarks[1].geometryScope=scope;observation.landmarks[1].critical=false;
  expect(()=>validateVoxelLandmarkCoverage(space,observation)).toThrow('geometryScope');
 }
 expect(GEOMETRY_SCOPES).toEqual(['object','component','void','group']);
});
test('legacy observations remain unchanged and are not silently upgraded; invalid lattice versions reject',()=>{
 const {space,observation}=fixture();for(const l of observation.landmarks)delete l.geometryScope;
 const legacy=structuredClone(space);delete legacy.voxelLattice;const before=JSON.stringify(observation);
 expect(validateVoxelLandmarkCoverage(legacy,observation).applicable).toBe(false);expect(JSON.stringify(observation)).toBe(before);
 expect(()=>validateVoxelLandmarkCoverage(space,observation)).toThrow('geometryScope');
 space.voxelLattice.version='voxel-lattice-v2';expect(()=>validateVoxelLandmarkCoverage(space,observation)).toThrow('版本');
});
test('independent component instances require their own existing template and finite positive bounds',()=>{
 for(const bad of ['missing','nonfinite','empty']){
  const {space,observation}=fixture();
  if(bad==='missing')space.program.instances[1].template='absent';
  if(bad==='nonfinite')space.program.templates[1].bounds.max[0]=Infinity;
  if(bad==='empty')space.program.templates[1].bounds.max[0]=0;
  expect(()=>validateVoxelLandmarkCoverage(space,observation)).toThrow('bounds');
 }
});
test('unknown instances, duplicate instance bindings and duplicate identity metadata reject',()=>{
 const mutations=[
  (space:any)=>space.observedBindings[1].instanceIds=['missing'],
  (space:any)=>space.observedBindings[1].instanceIds=['i_cluster_a','i_cluster_a'],
  (space:any)=>space.program.instances.push({...space.program.instances[0]}),
  (space:any)=>space.program.templates.push({...space.program.templates[0]}),
  (space:any)=>space.observedBindings[1].landmarkId='wall',
 ];
 for(const mutate of mutations){const {space,observation}=fixture();mutate(space);expect(()=>validateVoxelLandmarkCoverage(space,observation)).toThrow('VOXEL_LANDMARK_COVERAGE');}
});

// Small portable topology extracted from the failed initial plan: frame/steps,
// middle terrace/pier and geographically distinct green regions share aliases.
function failedAliasCore(){
 const specs=[['left_stone_frame','object','left_frame'],['left_recess_steps','component','left_frame'],['left_middle_landing','component','left_landing'],['central_terrace','component','left_landing'],['front_right_stone_pier','component','left_landing'],['green_left_front','component','green_regions'],['green_rear_top','component','green_regions'],['frame_opening','void','left_frame']];
 return {observation:{landmarks:specs.map(([id,scope])=>landmark(id,scope))},space:{voxelLattice:{version:STRICT_VOXEL_CONSTRUCTION},program:{templates:[template('frame'),template('landing'),template('green')],instances:[instance('left_frame','frame'),instance('left_landing','landing'),instance('green_regions','green')]},observedBindings:specs.map(([id,,owner])=>({landmarkId:id,instanceIds:[owner]}))}};
}
function semanticError(space:any,observation:any){
 try{validateVoxelLandmarkCoverage(space,observation);}catch(error){expect(error).toBeInstanceOf(VoxelLandmarkCoverageError);return error as VoxelLandmarkCoverageError;}
 throw Error('fixture must fail semantic coverage');
}
test('one error enumerates all independent component aliases with owners and a concrete repair action',()=>{
 const {space,observation}=failedAliasCore(),before=structuredClone({space,observation}),error=semanticError(space,observation);
 expect(error.violations.map(v=>v.landmarkId).sort()).toEqual(['left_stone_frame','left_recess_steps','left_middle_landing','central_terrace','front_right_stone_pier','green_left_front','green_rear_top'].sort());
 expect(error.violations.find(v=>v.landmarkId==='left_recess_steps')).toMatchObject({geometryScope:'component',instanceIds:['left_frame'],otherOwners:{left_frame:['left_stone_frame']}});
 expect(error.violations.find(v=>v.landmarkId==='green_left_front')!.otherOwners).toEqual({green_regions:['green_rear_top']});
 for(const violation of error.violations){expect(error.message).toContain(violation.landmarkId);if(violation.geometryScope==='component')expect(violation.requiredAction).toContain('create-independent-component');}
 expect(error.message).toContain('没有独立实例');expect({space,observation}).toEqual(before);
});
test('moving the first bad binding to another host still reports the remaining full workload',()=>{
 const {space,observation}=failedAliasCore();space.observedBindings.find(b=>b.landmarkId==='left_recess_steps')!.instanceIds=['left_landing'];
 const error=semanticError(space,observation);
 expect(error.violations).toHaveLength(6);
 expect(error.violations.find(v=>v.landmarkId==='left_recess_steps')!.otherOwners).toEqual({left_landing:['left_middle_landing','central_terrace','front_right_stone_pier']});
 expect(error.violations.some(v=>v.landmarkId==='green_rear_top')).toBe(true);expect(error.violations.some(v=>v.landmarkId==='left_stone_frame')).toBe(false);
});
test('bounds and duplicate group sets are included alongside component ownership errors',()=>{
 const {space,observation}=fixture();space.observedBindings[1].instanceIds=['i_cluster_a','i_wall'];space.program.templates[1].bounds.max[0]=0;space.observedBindings[3].instanceIds=['i_wall'];
 const error=semanticError(space,observation);
 expect(error.violations.map(v=>v.landmarkId)).toEqual(['clusters','wall','ruin']);
 expect(error.violations[0].reason).toContain('不能混入其他主体实例');expect(error.violations[0].reason).toContain('bounds');
 expect(error.violations[2].otherOwners).toEqual({i_wall:['wall']});expect(error.message).toContain('相同绑定集合');
});
test('independent requirements retain target identities and list the full minimum workload without synthetic IDs',()=>{
 const {observation}=failedAliasCore();observation.landmarks.push(landmark('noncritical','component',false),landmark('assembly','group'));
 observation.landmarks.find(l=>l.id==='green_left_front')!.views.push({...observation.landmarks[0].views[0],referenceIndex:2});
 const before=structuredClone(observation),requirements=voxelComponentRequirements(observation);
 expect(requirements).toHaveLength(7);expect(requirements.every(r=>r.minimumIndependentInstances===1)).toBe(true);
 expect(requirements.find(r=>r.landmarkId==='left_recess_steps')).toEqual({landmarkId:'left_recess_steps',label:'left_recess_steps',geometryScope:'component',minimumIndependentInstances:1,exclusiveRule:'all-bound-instances-exclusive'});
 expect(requirements.find(r=>r.landmarkId==='left_stone_frame')!.exclusiveRule).toBe('at-least-one-exclusive-instance');
 expect(requirements.some(r=>['frame_opening','assembly','noncritical'].includes(r.landmarkId))).toBe(false);
 expect(requirements.every(r=>!Object.hasOwn(r,'instanceId')&&!Object.hasOwn(r,'position')&&!Object.hasOwn(r,'templateId'))).toBe(true);expect(observation).toEqual(before);
});
test('requirement extraction rejects missing scopes, duplicate targets, unclear criticality and missing labels',()=>{
 const mutations=[(o:any)=>delete o.landmarks[0].geometryScope,(o:any)=>o.landmarks.push({...o.landmarks[0]}),(o:any)=>delete o.landmarks[0].critical,(o:any)=>o.landmarks[0].label=''];
 for(const mutate of mutations){const {observation}=failedAliasCore();mutate(observation);expect(()=>voxelComponentRequirements(observation)).toThrow('VOXEL_LANDMARK_COVERAGE');}
});
