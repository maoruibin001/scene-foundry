import {type Complexity} from './complexity';
export type ModelSettings={model:string,reasoningEffort:string};
export type ModelOption={model:string,displayName:string,description:string,defaultReasoningEffort:string,supportedReasoningEfforts:{reasoningEffort:string,description:string}[]};
export const EFFORTS=['none','minimal','low','medium','high','xhigh','max','ultra'];
export function modelOptions(rows:any[]):ModelOption[]{
 return rows.filter(r=>!r.hidden&&(r.inputModalities??['text','image']).includes('image')).map(r=>({model:r.model,displayName:r.displayName??r.model,description:r.description??'',defaultReasoningEffort:r.defaultReasoningEffort,supportedReasoningEfforts:(r.supportedReasoningEfforts??[]).filter((e:any)=>EFFORTS.includes(e.reasoningEffort))})).filter(r=>typeof r.model==='string'&&r.supportedReasoningEfforts.length);
}
export function validateModelSettings(value:any,models:ModelOption[]):ModelSettings{
 if(!value||typeof value.model!=='string'||typeof value.reasoningEffort!=='string')throw Error('请选择模型和思考深度');
 const option=models.find(m=>m.model===value.model);
 if(!option)throw Error('本机 Codex 未提供支持图片验收的模型：'+value.model);
 if(!option.supportedReasoningEfforts.some(e=>e.reasoningEffort===value.reasoningEffort))throw Error(value.model+' 不支持思考深度 '+value.reasoningEffort);
 return {model:value.model,reasoningEffort:value.reasoningEffort};
}
export function settingsOf(record:any):ModelSettings|undefined{
 if(record.modelSettings)return {...record.modelSettings};
 const p=record.assessmentProfile??record.profile;
 return p?.provider==='codex-cli'?{model:p.model,reasoningEffort:p.reasoningEffort}:undefined;
}
export function modelTimeoutMs(effort:string,role?:string){
 // 质量优先：多图空间规划实测约 994 秒，表面步骤也被旧 480 秒计时器截断。
 // 生成步骤与高思考视觉验收保留 20 分钟绝对上限；需求提取仍用较短上限。
 if(['scene-observation','scene-blockout','scene-space-judge','scene-space','scene-surface','scene-refine','scene-spatial-refine','geometry-asset','judge'].includes(role??'')&&['xhigh','max','ultra'].includes(effort))return 1200000;
 return ({none:120000,minimal:120000,low:120000,medium:180000,high:300000,xhigh:480000,max:600000,ultra:900000} as Record<string,number>)[effort]??120000;
}

/** 活跃输出允许延长；恢复时给慢调用更多时间，但仍受单阶段总预算约束。 */
export function modelTimeoutPolicy(effort:string,role:string,attempt=0,remainingMs=3600000,toolsContract?:string){
 // Repair includes inspection and real Engine previews. The high-effort
 // token-only timeout used to kill active repairs at ten minutes and redo them.
 const preview=role==='scene-space'&&['graybox-space-preview-v2','graybox-space-preview-v3','graybox-space-preview-v4','graybox-space-preview-v5','graybox-space-preview-v6','graybox-space-preview-v7','graybox-space-preview-v8','graybox-space-preview-v9','graybox-space-preview-v10','graybox-space-preview-v11','graybox-space-preview-v12'].includes(toolsContract??'');
 const base=role==='judge'?900000:role==='scene-refine'||preview?Math.max(900000,modelTimeoutMs(effort,role)):modelTimeoutMs(effort,role),timeoutMs=Math.min(Math.round(base*(attempt?1.5:1)),remainingMs);
 return {timeoutMs,maxTimeoutMs:role==='judge'?timeoutMs:Math.min(timeoutMs*2,remainingMs,45*60*1000),activityWindowMs:Math.min(5*60*1000,timeoutMs),extensionMs:Math.min(5*60*1000,timeoutMs)};
}

export const COMPLEXITY_MODEL_DEFAULTS:Record<Complexity,Readonly<ModelSettings>>={
 simple:{model:process.env.PIPELINE_MODEL??'gpt-6-astra',reasoningEffort:'high'},
 medium:{model:process.env.PIPELINE_MODEL??'gpt-6-astra',reasoningEffort:'high'},
 complex:{model:process.env.PIPELINE_MODEL??'gpt-6-astra',reasoningEffort:'xhigh'},
};
export function recommendedModelSettings(level:Complexity='simple'):ModelSettings{return {...COMPLEXITY_MODEL_DEFAULTS[level]};}
