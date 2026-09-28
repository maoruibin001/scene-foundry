/** 显式冻结候选时只开放观察；独立项目默认沿用正常生成流程。 */
export function executionHeld(env:Record<string,string|undefined>=process.env){const value=env.PIPELINE_EXECUTION_ENABLED;return value!==undefined&&value!=='1';}
export function assertExecutionEnabled(env:Record<string,string|undefined>=process.env){if(executionHeld(env))throw Error('ACCEPTANCE_CONFIRMATION_REQUIRED：当前配置已冻结执行；生成、自动恢复和模型请求尚未启用。完成本地确认后将 PIPELINE_EXECUTION_ENABLED 设置为 1');}
