import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CheckpointStore} from './checkpoints';
import {digest,save} from '../store';
import {validateGroundedPlan} from '../grounding';
const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};
export function checkpointFixture(){
 const root=mkdtempSync(join(tmpdir(),'scene-checkpoint-')),generationDir=join(root,'generation');mkdirSync(join(generationDir,'assets/shape'),{recursive:true});
 const job={id:'source-job',prompt:'两个凹形支架',complexity:'simple',images:[{id:'a'.repeat(64),mime:'image/png'},{id:'b'.repeat(64),mime:'image/png'}],modelSettings:{model:'gpt-6-astra',reasoningEffort:'high'},profile:{provider:'codex-cli',engineSha:'engine',generatorSha:'generator'},pipelineVersion:{id:'candidate-a'}};
 const plan=validateGroundedPlan({name:'凹形支架',summary:'两个支架',capabilities:['mapping'],requirements:[{id:'shape',text:'两个凹形支架',critical:true,weight:1,count:2,source:'prompt',evidence:'两个凹形支架'}]},job.prompt);
 const layout={version:'scene-layout-v1',program:{version:'geometry-v1',name:'凹形支架',materials:[{id:'mat',color:[.5,.4,.3,1],roughness:.8,metallic:0,textureId:null}],templates:[{id:'shape',label:'支架',origin:'左下角',description:'带缺口',bounds:{min:[0,0,0],max:[3,3,.4]},materialIds:['mat'],maxParts:8}],instances:[{...pose,id:'one',label:'第一支架',template:'shape',requirementIds:['shape']},{...pose,id:'two',label:'第二支架',template:'shape',position:[5,0,0],requirementIds:['shape']}]},entities:[{instanceId:'one',role:'subject',category:'支架'},{instanceId:'two',role:'subject',category:'支架'}],cameras:[{name:'参考一',referenceIndex:1,position:[8,-6,4],target:[4,1,0],fov:1},{name:'参考二',referenceIndex:2,position:[-4,6,3],target:[4,1,0],fov:1}],textures:[],lighting:{direction:[0,.5,-1],color:[1,1,1],intensity:1,ambientColor:[1,1,1],ambientIntensity:.5,points:[]},assumptions:['背面为推断']};
 const geometry={version:'asset-geometry-v1',template:{id:'shape',parts:[{...pose,id:'body',material:'mat',uvScale:[1,1],shape:{type:'extrusion',outline:[[0,0],[3,0],[3,1],[1,1],[1,3],[0,3]],depth:.4}}]}};
 const checkpoint={status:'passed',pipelineVersion:job.pipelineVersion,modelSettings:job.modelSettings,layoutSha256:digest(JSON.stringify(layout)),planSha256:digest(JSON.stringify(plan)),referenceSha256:job.images.map(i=>i.id),geometrySha256:digest(JSON.stringify(geometry))};
 const planFile=join(root,'plan.json'),textureFile=join(root,'textures.json');save(planFile,plan);save(textureFile,{});save(join(generationDir,'layout.json'),layout);save(join(generationDir,'assets/shape/geometry.json'),geometry);save(join(generationDir,'assets/shape/checkpoint.json'),checkpoint);
 return {root,job,geometry,checkpoint,registration:{job,planFile,generationDir,textureFile},store:new CheckpointStore(join(root,'store'))};
}
