/** 资产及成品组装必须使用实际灰模验收通过的空间和机位，不以阶段开始或代码合法代替。 */
export function assertSpatialAccepted(job:any,layout:any){
 const gate=job.blockout,last=gate?.rounds?.at(-1);
 if(gate?.status!=='passed'||!last?.passed||!gate.space||!last.runtimeDigest||!last.frames?.length)throw Error('SPATIAL_GATE_REQUIRED：灰模画面验收通过前不能生成详细资产或组装成品');
 if(JSON.stringify(gate.space.program.instances)!==JSON.stringify(layout?.program?.instances)||JSON.stringify(gate.space.cameras)!==JSON.stringify(layout?.cameras))throw Error('SPATIAL_GATE_CHANGED：空间或机位与已验收灰模不一致，必须重新验收');
}
