import {MAX_VISUAL_REPAIRS,MIN_MEANINGFUL_GAIN} from './geometry/iteration-policy';
export function generationMode(value:any='bounded'):'bounded'|'first-pass'|'qualified'{
 if(!['bounded','first-pass','qualified'].includes(value))throw Error('生成方式必须为自动修正、仅首轮验证或生成到验收通过');
 return value;
}
export function iterationPolicyFor(input:any){const mode=generationMode(input.generationMode);return {version:mode==='qualified'?'qualified-visual-v1':'bounded-visual-v1',minMeaningfulGain:MIN_MEANINGFUL_GAIN,maxVisualRepairs:input.nativeCase||mode==='first-pass'?0:mode==='qualified'?null:MAX_VISUAL_REPAIRS};}
