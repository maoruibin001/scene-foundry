import {withNormalizedSky} from './sky-normalization';

/**
 * Deterministic fixes applied to a finished scene before it is rendered for the judge, the same way in the final export, in
 * repair previews and in the replay bench, so what the bench measures is what a job delivers. Across 59 recorded rounds every
 * ordinary round scored a composite of 70 or more, yet S13 (visible defects) stopped 21 of them; these steps target the
 * defect classes behind those failures that need no model judgement.
 */
export const PRE_JUDGE='pre-judge-v1';
export function preJudgeRule(job:any){return job?.preJudgePolicy===PRE_JUDGE;}

export function preJudgeScene(scene:any,textures:Record<string,any>){
 const steps:any[]=[];
 const sky=withNormalizedSky(scene,textures);scene=sky.scene;textures=sky.textures;steps.push(sky.report);
 return {scene,textures,report:{version:PRE_JUDGE,steps}};
}
