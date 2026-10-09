import {test,expect} from 'bun:test';
import {GEOMETRY_SCOPES,STRICT_VOXEL_CONSTRUCTION,validateVoxelLandmarkCoverage} from './landmark-coverage';

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
