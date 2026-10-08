import {statfsSync} from 'node:fs';
import {pipelineDataDir} from './runtime-paths.mjs';

const GiB=1024**3;
export const STORAGE_RESERVE_BYTES=4*GiB;
/** Check the actual output volume, not the source checkout or an unrelated temp volume. */
export function assertStorageAvailable(path=pipelineDataDir(),requiredBytes=STORAGE_RESERVE_BYTES,inspect:typeof statfsSync=statfsSync){
 const s=inspect(path),availableBytes=Number(s.bavail)*Number(s.bsize);
 if(!Number.isFinite(availableBytes)||availableBytes<requiredBytes)throw Error('STORAGE_CAPACITY_BLOCKED：输出磁盘可用 '+(availableBytes/GiB).toFixed(2)+' GiB，需至少 '+(requiredBytes/GiB).toFixed(2)+' GiB 写入余量；已有场景、评分和完成的模型修改保留，释放空间后继续，不重新生成。');
 return {version:'storage-preflight-v1',availableBytes,requiredBytes,checkedAt:new Date().toISOString()};
}
