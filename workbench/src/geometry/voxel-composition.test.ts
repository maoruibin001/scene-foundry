import {test,expect} from 'bun:test';
import {project} from './camera-fit';
import {transformPoint} from './program';
import {existsSync,readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {assertSubjectFraming,checkVoxelComposition,compositionRows,voxelCompositionRule,VOXEL_COMPOSITION} from './voxel-composition';

// Square reference, isometric orthographic camera like the voxel references; +Y lies on screen right from this side.
const sizes=[{referenceIndex:1,width:1200,height:1200}];
const camera={name:'原图斜俯视',referenceIndex:1,projection:'orthographic',position:[20,16,17],target:[4,4,2],fov:.8,orthographicHeight:12};
const blocks=[[0,0,0],[8,0,0],[0,8,0],[8,8,0],[4,4,3],[2,6,1]];
const space={cameras:[camera,{name:'检查',referenceIndex:null,projection:'orthographic',position:[-10,4,8],target:[4,4,2],fov:.8,orthographicHeight:12}],
 program:{templates:[{id:'block',bounds:{min:[0,0,0],max:[1,1,1]}}],instances:blocks.map((position,i)=>({id:'b'+i,template:'block',position,rotation:[0,0,0],scale:[1,1,1]}))},
 observedBindings:blocks.map((_,i)=>({landmarkId:'l'+i,instanceIds:['b'+i]})),entities:blocks.map((_,i)=>({instanceId:'b'+i,role:'subject',category:'block'}))};
/** Observation boxes as a camera would see each whole block; mirror flips them left-right. */
function observed(view:any,mirror=false){
 return {landmarks:blocks.map((p,i)=>{const lo=[Infinity,Infinity],hi=[-Infinity,-Infinity];
  for(let c=0;c<8;c++){const uv=project(view,transformPoint([c&1,c&2?1:0,c&4?1:0],{position:p,rotation:[0,0,0],scale:[1,1,1]}),1);for(let k=0;k<2;k++){lo[k]=Math.min(lo[k],uv[k]);hi[k]=Math.max(hi[k],uv[k]);}}
  const box=mirror?[1-hi[0],lo[1],1-lo[0],hi[1]]:[lo[0],lo[1],hi[0],hi[1]];return {id:'l'+i,views:[{referenceIndex:1,box,extent:'complete'}]};})};
}

test('only new voxel jobs under the policy check composition',()=>{
 expect(voxelCompositionRule({voxelCompositionPolicy:VOXEL_COMPOSITION})).toBe(true);
 expect(voxelCompositionRule({voxelCompositionPolicy:null})).toBe(false);
 expect(voxelCompositionRule({})).toBe(false);
});

test('a plan whose camera matches the observation is kept as planned',()=>{
 const r=checkVoxelComposition(space,observed(camera),sizes);
 expect(r.space.cameras).toEqual(space.cameras);expect(r.report.cameras[0]).toMatchObject({status:'kept',rows:6});
 expect(r.report.cameras[0].before).toBeLessThan(1e-9);
});

test('a camera that frames the scene too low and too tight is moved in its image plane onto the observation',()=>{
 // The reference view sits 1.5 m lower and covers 15% more height; instances, templates and lattice stay frozen.
 const truth={...camera,position:camera.position.map((v,i)=>v-[0,0,1.5][i]),target:camera.target.map((v,i)=>v-[0,0,1.5][i]),orthographicHeight:13.8};
 const obs=observed(truth),r=checkVoxelComposition(space,obs,sizes),fitted=r.space.cameras[0],row=r.report.cameras[0];
 expect(row.status).toBe('fitted');expect(row.before).toBeGreaterThan(.05);expect(row.after).toBeLessThan(.005);
 expect(fitted.orthographicHeight).toBeCloseTo(13.8,1);
 // Only the camera moved; its viewing direction is unchanged.
 const dir=(c:any)=>{const d=c.target.map((v:number,i:number)=>v-c.position[i]),n=Math.hypot(...d);return d.map((v:number)=>v/n);};
 dir(fitted).forEach((v:number,i:number)=>expect(v).toBeCloseTo(dir(camera)[i],9));
 expect(r.space.program).toEqual(space.program);expect(r.space.cameras[1]).toEqual(space.cameras[1]);
 for(const x of compositionRows(r.space,obs,fitted,1))for(let k=0;k<2;k++)expect(Math.abs(x.projected[k]-x.observed[k])).toBeLessThan(.01);
 // Re-running on the fitted plan is a no-op.
 expect(checkVoxelComposition(r.space,obs,sizes).space.cameras[0]).toEqual(fitted);
});

test('a left-right mirrored layout is rejected with the camera screen axes and the worst landmarks',()=>{
 expect(()=>checkVoxelComposition(space,observed(camera,true),sizes)).toThrow(/VOXEL_LAYOUT_MIRRORED[\s\S]*画面右方的世界方向为\[[\s\S]*l\d /);
});

test('perspective reference cameras are not measured by box projection',()=>{
 const perspective={...space,cameras:[{...camera,projection:'perspective',orthographicHeight:null}]};
 const r=checkVoxelComposition(perspective,observed(camera,true),sizes);
 expect(r.space).toEqual(perspective);expect(r.report.cameras[0].status).toBe('skipped');
});

test('too few comparable landmarks leave the camera alone',()=>{
 const obs=observed(camera,true);obs.landmarks=obs.landmarks.slice(0,3);
 const r=checkVoxelComposition(space,obs,sizes);expect(r.space.cameras[0]).toEqual(camera);expect(r.report.cameras[0]).toMatchObject({status:'skipped',rows:3});
});

test('a plan whose subjects cover too little of a reference view is returned before any Engine capture',()=>{
 expect(()=>assertSubjectFraming(space,sizes)).not.toThrow();
 // Only the smallest block as subject, the way the 2026-10-18 temple plan named a lone chest.
 const lone={...space,entities:space.entities.map((e,i)=>({...e,role:i===5?'subject':'context'}))};
 expect(()=>checkVoxelComposition(lone,observed(camera),sizes)).toThrow(/VOXEL_SUBJECT_FRAMING[\s\S]*b5[\s\S]*至少25%[\s\S]*b\d \d+%/);
});

test('recorded plans: the lone-chest temple plan fails, every plan whose rounds passed framing passes',()=>{
 // Read-only scan of the 2026-10-18 isolated rigs; runtime framing is the measured outcome for each round.
 const rows=['/tmp/sf-vx-r6/data/runs','/tmp/sf-vx-r7/data/runs'].filter(existsSync).flatMap(runs=>readdirSync(runs).flatMap(id=>{const b=join(runs,id,'generation/blockout');
  return existsSync(b)?readdirSync(b).filter(r=>existsSync(join(b,r,'space.json'))&&existsSync(join(b,r,'runtime/runtime.json'))).map(r=>({space:JSON.parse(readFileSync(join(b,r,'space.json'),'utf8')),framing:JSON.parse(readFileSync(join(b,r,'runtime/runtime.json'),'utf8')).hard.framing})):[];}));
 for(const row of rows){const check=()=>assertSubjectFraming(row.space,row.space.cameras.filter((c:any)=>c.referenceIndex).map((c:any)=>({referenceIndex:c.referenceIndex,width:1200,height:1200})));
  if(row.framing)expect(check).not.toThrow();else expect(check).toThrow('VOXEL_SUBJECT_FRAMING');}
});
