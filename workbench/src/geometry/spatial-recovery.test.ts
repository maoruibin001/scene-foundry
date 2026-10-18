import {test,expect} from 'bun:test';
import {sameSpatialRecovery,sameSpatialCompiler} from './spatial-recovery';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {digest} from '../store';
function fixture(){
 const scene={program:{templates:[{id:'t',parts:[{id:'p',material:'paint',shape:{type:'box'}}]}],instances:[{id:'i',template:'t',position:[0,0,0],surfaceOverrides:{p:{}}}]},cameras:[{position:[0,2,4]}]};
 const space={program:{instances:[{id:'i',template:'t',position:[0,0,0]}]},cameras:scene.cameras,spatialRelations:[{id:'R1',critical:true,instanceIds:['i']}]};
 const gate={passed:true,runtimeDigest:'d',frames:['reference-1.png'],review:{score:4,confidence:.9,relations:[{id:'R1',score:4,verdict:'met',reason:'实际画面可见',frames:['reference-1.png']}]}};
 const source={id:'s',executionRecoveryRoot:'root',prompt:'p',baselineId:'b',complexity:'complex',matchingLevel:'standard',images:[{id:'sha'}],policy:{score:80},profile:{engineSha:'e',generatorSha:'g'},optimizationPolicy:{spatialPreflight:'coarse-v2'},blockout:{status:'passed',rounds:[gate],space}};
 const target={...structuredClone(source),id:'next',reuseSceneFrom:'s',recoverySourceJobId:'prior',refineScene:false};
 const grayScene={program:{templates:[{id:'t',parts:[{id:'p',material:'blockout',shape:{type:'box'}}]}],instances:space.program.instances},cameras:scene.cameras};
 return {target,source,scene,savedScene:structuredClone(scene),plan:{requirements:['R1']},savedPlan:{requirements:['R1']},grayScene,gate};
}
const accepts=(f:ReturnType<typeof fixture>)=>sameSpatialRecovery(f.target,f.source,f.scene,f.savedScene,f.plan,f.savedPlan,f.grayScene,f.gate);
test('同一技术恢复根的确切灰模空间证据可复用，不制造新评分',()=>expect(accepts(fixture())).toBe(true));
test('编译与灰模呈现源码变化或缺失时，旧空间证据不得自动复用',()=>{
 const names=['program.ts','voxel-volume.ts','branch-crown.ts','prepare.ts','curved-surfaces.ts','surface-mapping.ts','mesh.ts','constraints.ts','distribution.ts','texture-bundle.ts','surface-detail.ts','material-emission.ts','camera-tour.ts','lighting.ts','blockout-presentation.ts','reference-framing.ts','reference-frame.mjs','spatial-order.ts'];
 const files=Object.fromEntries(names.map(file=>[file,digest(readFileSync(join(import.meta.dirname,file)))]));
 expect(sameSpatialCompiler(files,files)).toBe(true);expect(sameSpatialCompiler({...files,'program.ts':'changed'},files)).toBe(false);expect(sameSpatialCompiler({},files)).toBe(false);expect(sameSpatialCompiler({...files,'material-emission.ts':'changed'},files)).toBe(false);
});
test('新输入、质量重做、场景/机位/规则/参考/引擎变化必须重新验收',()=>{
 const changes=[(f:any)=>f.target.recoverySourceJobId=null,(f:any)=>f.target.executionRecoveryRoot='other',(f:any)=>f.target.refineScene=true,(f:any)=>f.target.reuseRefinementOutput={},(f:any)=>f.target.reuseSceneFrom='other',(f:any)=>f.target.images[0].id='other',(f:any)=>f.target.prompt='changed',(f:any)=>f.target.policy.score=70,(f:any)=>f.target.profile.engineSha='other',(f:any)=>f.target.optimizationPolicy.spatialPreflight='changed',(f:any)=>f.scene.cameras[0].position[0]=4,(f:any)=>f.scene.program.templates[0].parts[0].shape.type='sphere',(f:any)=>f.grayScene.program.templates[0].parts[0].shape.type='sphere',(f:any)=>f.savedPlan.requirements.push('R2'),(f:any)=>f.source.blockout.status='failed',(f:any)=>f.gate.review.score=1];
 for(const mutate of changes){const f=fixture();mutate(f);expect(accepts(f)).toBe(false);}
});
test('体素客观验收轮次按保存的构图测量重新判定，不信任记录中的结论',async()=>{
 const {withObjectiveAcceptance,VOXEL_ACCEPTANCE}=await import('./voxel-acceptance');
 const f=fixture(),space=f.source.blockout.space as any;space.voxelLattice={version:'voxel-lattice-v1'};
 const observation={landmarks:['a','b','c','d'].map(id=>({id,critical:true}))};
 const composition={rows:['a','b','c','d'].map((landmarkId,i)=>({landmarkId,critical:true,referenceIndex:1,extent:'partial',expected:[i*.2,.2,i*.2+.15,.6],visible:[i*.2+.02,.22,i*.2+.17,.62],edgeResidual:.02,pixels:300,status:'measured-visible-extent'}))};
 const judged={...f.gate,review:{...f.gate.review,score:3,relations:[{...f.gate.review.relations[0],score:2.5,verdict:'partial'}]}};
 const {spatialGate}=await import('./blockout');f.source.optimizationPolicy.spatialPreflight='composition-v3';f.target.optimizationPolicy.spatialPreflight='composition-v3';
 const gate=withObjectiveAcceptance(spatialGate(judged.review,space,judged.frames,f.target.optimizationPolicy),space,composition,observation);
 expect(gate.vlmPassed).toBe(false);
 Object.assign(gate,{runtimeDigest:'d',frames:['reference-1.png']});
 for(const j of [f.source,f.target])(j as any).voxelAcceptancePolicy=VOXEL_ACCEPTANCE;f.source.blockout.rounds=[gate];
 const check=(g:any,c:any=composition,target:any=f.target)=>sameSpatialRecovery(target,f.source,f.scene,f.savedScene,f.plan,f.savedPlan,f.grayScene,g,{composition:c,observation});
 expect(gate.passed).toBe(true);expect(check(gate)).toBe(true);
 // Missing or changed measurement, a forged objective verdict, or a target without the policy all re-review.
 expect(check(gate,null)).toBe(false);
 expect(check(gate,{rows:composition.rows.map(r=>({...r,edgeResidual:.3}))})).toBe(false);
 const forged={...gate,objective:{...gate.objective,passed:true,checks:[]}};f.source.blockout.rounds=[forged];expect(check(forged)).toBe(false);f.source.blockout.rounds=[gate];
 expect(check(gate,composition,{...f.target,voxelAcceptancePolicy:null})).toBe(false);
});
