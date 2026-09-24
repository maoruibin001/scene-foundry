// 单帧与阶段预算来自同一计划，避免仍在逐帧推进时被较短的外层预算截断。
export function capturePlan(viewCount){
 if(!Number.isInteger(viewCount)||viewCount<1||viewCount>6)throw Error('采集视角数必须为1至6');
 const frameTimeoutMs=30000,continuousFrames=6,settleMs=400,movementWaitMs=3500;
 const captureCount=2+viewCount; // UI、全部静态机位、停止录屏后的响应检查。
 const stageTimeoutMs=60000+captureCount*frameTimeoutMs+viewCount*settleMs+continuousFrames*movementWaitMs+60000;
 return {viewCount,frameTimeoutMs,continuousFrames,settleMs,movementWaitMs,captureCount,stageTimeoutMs,continuousSource:'recording-pts'};
}
