// pairwise-reference-compare-v1: compare two candidate scenes against the same reference photos and
// ask the judge which is CLOSER (relative, not absolute). Pairwise comparison is more reliable and
// less noisy than absolute 0–5 scoring for A/B verification of a change (cf. GPTEval3D, Chatbot Arena).
export const PAIRWISE_COMPARE='pairwise-reference-compare-v1';
export const PAIRWISE_DIMENSIONS=['coverage','spatial','shape','material','readability'] as const;

export const PAIRWISE_PROMPT='pairwise-reference-compare-v1 你在对同一组参考原图，比较两个候选场景的真实运行画面，判断哪个更接近原图。图片顺序：先全部原始参考图，再候选甲（标记 A）的运行帧，最后候选乙（标记 B）的运行帧。对 overall 以及五个维度（coverage 需求实现、spatial 空间与构图、shape 主体形态、material 材质与色彩、readability 画面可读性）分别判断：甲更接近填 "A"，乙更接近填 "B"，难分或证据不足填 "tie"；每条给出简短中文理由并在 frames 引用用到的真实帧名。只依据与原图的接近程度判断，不因为某个候选画面更多、更长或排在前面而偏向它；不声称像素完全一致。这是相对比较，不要输出绝对分数。';

const str={type:'string'};
const winner={type:'string',enum:['A','B','tie']};
const o=(p:Record<string,any>)=>({type:'object',properties:p,required:Object.keys(p),additionalProperties:false});
export function pairwiseSchema(){
 return o({
  overall:o({winner,reason:str}),
  dimensions:{type:'array',items:o({id:{type:'string',enum:[...PAIRWISE_DIMENSIONS]},winner,reason:str,frames:{type:'array',items:str}})},
  summary:str,
 });
}

export type PairwiseOrder='ab'|'ba';
/** Build a pairwise judge request. order 'ba' swaps which real candidate is shown as A/B to counter
 *  position bias; normalizePairwise maps the verdict back to the real candidates. frames are {path,mime}. */
export function buildPairwiseRequest(opts:{modelSettings:any;referenceImages:any[];aFrames:any[];bFrames:any[];order?:PairwiseOrder;maxTokens?:number}){
 const order=opts.order??'ab';
 const first=order==='ba'?opts.bFrames:opts.aFrames,second=order==='ba'?opts.aFrames:opts.bFrames;
 return {modelSettings:opts.modelSettings,role:'scene-pairwise',schemaContext:{},maxTokens:opts.maxTokens??4000,
  images:[...opts.referenceImages,...first,...second],system:PAIRWISE_PROMPT,
  text:JSON.stringify({referenceImages:opts.referenceImages.length,candidateFrames:{A:first.length,B:second.length},
   note:'A 是画面中“候选甲”的帧，B 是“候选乙”的帧；只比较与原图的接近程度，不给绝对分。'})};
}

export function validatePairwise(v:any){
 if(!v||typeof v!=='object')throw Error('两两对比结果无效');
 const win=(w:any)=>['A','B','tie'].includes(w);
 if(!v.overall||!win(v.overall.winner)||typeof v.overall.reason!=='string')throw Error('两两对比缺少总体结论');
 if(!Array.isArray(v.dimensions))throw Error('两两对比缺少维度结论');
 const ids=new Set(v.dimensions.map((d:any)=>d.id));
 for(const id of PAIRWISE_DIMENSIONS)if(!ids.has(id))throw Error('两两对比缺少维度：'+id);
 for(const d of v.dimensions){if(!win(d.winner)||typeof d.reason!=='string'||!Array.isArray(d.frames))throw Error('两两对比维度条目无效：'+d.id);}
 return v;
}

const flip=(w:string)=>w==='A'?'B':w==='B'?'A':'tie';
/** Map the model's A/B verdict (as it saw the frames) back to the real candidates. With order 'ba' the
 *  model's A was real candidate B, so flip. Keeps per-dimension reasons/frames intact. */
export function normalizePairwise(result:any,order:PairwiseOrder='ab'){
 const map=(w:string)=>order==='ba'?flip(w):w;
 return {version:PAIRWISE_COMPARE,order,
  overall:{winner:map(result.overall.winner),reason:result.overall.reason},
  dimensions:(result.dimensions??[]).map((d:any)=>({...d,winner:map(d.winner)})),
  summary:result.summary};
}
