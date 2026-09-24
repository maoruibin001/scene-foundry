import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {read,digest,runDir} from '../store';
import {cameraChangeFeedback} from './camera-change';
import type {SceneInput} from './scene-contract';
import type {Texture} from './program';

/** 只消费与当前产物及修正来源摘要相符的历史；没有修正的首稿不制造反事实。 */
export function cameraChangeHistory(sourceDir:string,current:SceneInput,textures:Record<string,Texture>,locate=runDir){
 const snapshot=existsSync(join(sourceDir,'candidate.json'))?read(join(sourceDir,'candidate.json')):null;
 const job=snapshot?null:read(join(sourceDir,'job.json'));
 const history=snapshot?.fields.visualRefinement??job?.visualRefinement;
 if(!history)return null;
 const sourceJobId=snapshot?.jobId??job.id,index=snapshot?.cycle.index??job.selectedIteration??0;
 if(!Number.isInteger(index)||index<0||index>2)throw Error('机位历史轮次无效');
 // 旧相机对齐器没有增量修正 receipt，不能用其结果冒充同一契约的来源。
 const folder=index===0?'generation/refinement':`generation/iteration-${index}/refinement`;
 const receiptPath=join(locate(sourceJobId),folder,'receipt.json');
 if(!existsSync(receiptPath))return null;
 const receipt=read(receiptPath),previousIndex=history.sourceIteration;
 if(previousIndex!=null&&(!Number.isInteger(previousIndex)||previousIndex<0||previousIndex>2))throw Error('机位历史来源轮次无效');
 const previousDir=previousIndex==null?locate(history.sourceJobId):join(locate(history.sourceJobId),'iterations',String(previousIndex));
 const previous=read(join(previousDir,'generated-scene.json')) as SceneInput;
 if(receipt.sourceJobId!==history.sourceJobId||(receipt.sourceIteration??null)!==(previousIndex??null)||receipt.sourceDigest!==digest(JSON.stringify(previous))||receipt.sceneDigest!==digest(JSON.stringify(current)))throw Error('机位历史来源或场景摘要不一致');
 const feedback=cameraChangeFeedback(previous,current,textures);
 return feedback?{...feedback,sourceJobId,sourceIteration:index,previousJobId:history.sourceJobId,previousIteration:previousIndex??null}:null;
}
