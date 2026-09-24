export const MAX_ASSET_CONCURRENCY=6;
export const DEFAULT_EXECUTION_SETTINGS={assetConcurrency:6};
export function executionSettings(value:any=DEFAULT_EXECUTION_SETTINGS){
 const n=value?.assetConcurrency??DEFAULT_EXECUTION_SETTINGS.assetConcurrency;
 if(!Number.isInteger(n)||n<1||n>MAX_ASSET_CONCURRENCY)throw Error('资产并发数必须为 1–'+MAX_ASSET_CONCURRENCY);
 return {assetConcurrency:n};
}
