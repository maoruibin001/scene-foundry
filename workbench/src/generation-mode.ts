import {MAX_VISUAL_REPAIRS,MIN_MEANINGFUL_GAIN} from './geometry/iteration-policy';
export function generationMode(value:any='bounded'):'bounded'|'first-pass'{
 if(value!=='bounded'&&value!=='first-pass')throw Error('生成方式必须为自动修正或仅首轮验证');
 return value;
}
export function iterationPolicyFor(input:any){return {version:'bounded-visual-v1',minMeaningfulGain:MIN_MEANINGFUL_GAIN,maxVisualRepairs:input.nativeCase||generationMode(input.generationMode)==='first-pass'?0:MAX_VISUAL_REPAIRS};}
