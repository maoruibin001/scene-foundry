import {readFileSync,copyFileSync,existsSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {PROMPT_CONTRACT} from '../prompts';
import {callValidated} from '../contracts';
import {ROOT,UPLOADS,save,read,digest,event} from '../store';
import {OBSERVATION_PROMPT,OBSERVATION_SCHEMA,validateObservations} from './reconstruction-schema';
import {CASE,sha} from './prepare';
import {fitLayout} from './fitting';
import {resolveTabletopItems} from './tabletop';
import preset from './diner-layout-seed.json';
export const OBSERVATION_INPUT='使用这两张原图完成餐厅场景生成管线的第一步：跨视角可见物体与结构标注。当前只做图像观测，三维拟合由后续步骤执行。';
const cache=join(CASE,'observation-cache');
export function observationKey(images:any[],settings:any){return digest(JSON.stringify({images:images.map(i=>i.id),settings,contract:PROMPT_CONTRACT,prompt:OBSERVATION_PROMPT,input:OBSERVATION_INPUT,schema:OBSERVATION_SCHEMA}));}
export async function reconstructionPlan(job:any,dir:string,signal:AbortSignal){
 for(const image of job.images)if(sha(join(UPLOADS,image.file))!==image.id)throw Error('原始参考图片摘要不符');
 const key=observationKey(job.images,job.modelSettings),checkpoint=join(cache,key);let value,receipt,reused=false;
 if(existsSync(join(checkpoint,'manifest.json'))){const manifest=read(join(checkpoint,'manifest.json'));if(manifest.key!==key||manifest.valueSha256!==sha(join(checkpoint,'observations.json')))throw Error('双图观察缓存摘要不符');for(const file of ['reference-observations-prompt.json','reference-observations-receipt.json','reference-observations-response.txt'])if(manifest.artifactSha256?.[file]!==sha(join(checkpoint,file)))throw Error('观察缓存来源文件摘要不符：'+file);const prompt=read(join(checkpoint,'reference-observations-prompt.json'));if(prompt.contract!==PROMPT_CONTRACT||prompt.system!==OBSERVATION_PROMPT||prompt.input!==OBSERVATION_INPUT)throw Error('观察缓存提示词契约不符');value=validateObservations(read(join(checkpoint,'observations.json')));receipt=read(join(checkpoint,'reference-observations-receipt.json'));if(receipt.requestedModel!==job.modelSettings.model||receipt.requestedReasoning!==job.modelSettings.reasoningEffort)throw Error('双图观察缓存的模型身份不符');reused=true;for(const name of ['reference-observations-prompt.json','reference-observations-receipt.json','reference-observations-response.txt'])if(existsSync(join(checkpoint,name)))copyFileSync(join(checkpoint,name),join(dir,name));}
 else{event(job,'progress','使用两张原图提取共同结构与物体对应');const r=await callValidated({role:'reference-observations',modelSettings:job.modelSettings,system:OBSERVATION_PROMPT,text:OBSERVATION_INPUT,images:job.images.map((i:any)=>({path:join(UPLOADS,i.file),mime:i.mime})),maxTokens:5000,signal},dir,validateObservations);value=r.value;receipt=r.receipt;mkdirSync(checkpoint,{recursive:true});save(join(checkpoint,'observations.json'),value);for(const name of ['reference-observations-prompt.json','reference-observations-receipt.json','reference-observations-response.txt'])copyFileSync(join(dir,name),join(checkpoint,name));save(join(checkpoint,'manifest.json'),{key,valueSha256:sha(join(checkpoint,'observations.json')),artifactSha256:Object.fromEntries(['reference-observations-prompt.json','reference-observations-receipt.json','reference-observations-response.txt'].map(f=>[f,sha(join(checkpoint,f))]))});}
 save(join(dir,'reference-observations.json'),value);
 const seed=structuredClone(preset);seed.interpretation=value.interpretation;seed.assumptions.push('建筑初值由本例辅助建立；模型观察与数值拟合尚不能保证完整空间正确。');seed.landmarks=value.items.flatMap((o:any)=>[1,2].filter(v=>o['reference'+v][2]>o['reference'+v][0]).map(v=>{const b=o['reference'+v];return {id:o.id+'_view'+v,referenceIndex:v,targetId:o.id,anchor:'center',uv:[(b[0]+b[2])/2,(b[1]+b[3])/2],confidence:o.confidence,description:o.description};}));
 const known=new Set([...seed.assets,...seed.architecture,...seed.architecture.flatMap(n=>n.openings)].map(n=>n.id));seed.landmarks=seed.landmarks.filter(l=>known.has(l.targetId));
 const {layout,report}=fitLayout(seed,value);resolveTabletopItems(layout);save(join(dir,'reference-layout.json'),layout);save(join(dir,'layout-fit.json'),report);
 job.reconstruction={observationKey:key,reusedObservation:reused,objectCorrespondences:value.items.length,meanEdgeErrorPx:report.afterMeanEdgeErrorPx,fitScope:report.limitations,modelReceipt:receipt,method:'模型双图观察、辅助建筑初值、约束拟合与原生资产构造'};
 event(job,'progress',(reused?'复用已校验的双图观察；':'双图观察完成；')+'共同布局拟合已保存，等待实际画面验收');
 return layout;
}
