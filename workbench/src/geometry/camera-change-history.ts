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
 if(!Number.isSafeInteger(index)||index<0)throw Error('机位历史轮次无效');
 // 旧相机对齐器没有增量修正 receipt，不能用其结果冒充同一契约的来源。
 const folder=index===0?'generation/refinement':`generation/iteration-${index}/refinement`;
 // 普通生成、轮次快照和辅助修复的产物目录不同，但来源验证契约相同。
 // 不能把已保存的顶层 refinement 回执静默当作没有历史。
 const receiptPaths=[join(locate(sourceJobId),folder,'receipt.json'),join(sourceDir,'refinement','receipt.json')].filter(existsSync);
 if(!receiptPaths.length)return null;
 const previousIndex=history.sourceIteration;
 if(previousIndex!=null&&(!Number.isSafeInteger(previousIndex)||previousIndex<0))throw Error('机位历史来源轮次无效');
 const previousDir=previousIndex==null?locate(history.sourceJobId):join(locate(history.sourceJobId),'iterations',String(previousIndex));
 const previous=read(join(previousDir,'generated-scene.json')) as SceneInput;
 const sourceDigest=digest(JSON.stringify(previous)),sceneDigest=digest(JSON.stringify(current));
 const matches=receiptPaths.map(read).filter(receipt=>receipt.sourceJobId===history.sourceJobId&&(receipt.sourceIteration??null)===(previousIndex??null)&&receipt.sourceDigest===sourceDigest&&receipt.sceneDigest===sceneDigest);
 if(!matches.length)throw Error('机位历史来源或场景摘要不一致');
 const feedback=cameraChangeFeedback(previous,current,textures);
 return feedback?{...feedback,sourceJobId,sourceIteration:index,previousJobId:history.sourceJobId,previousIteration:previousIndex??null}:null;
}
