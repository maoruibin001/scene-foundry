/**
 * No judge has seen a failed capture, so one fresh capture on the same preview is not a second verdict.
 * A cancelled job never retries; a second failure keeps the typed CAPTURE_EVIDENCE_FAILED the planners recognise.
 */
export async function captureWithRetry<T>(capture:()=>Promise<T>,signal:AbortSignal,retry:(error:unknown)=>void):Promise<T>{
 try{return await capture();}catch(first){signal.throwIfAborted();retry(first);}
 try{return await capture();}catch(error){signal.throwIfAborted();throw Error('CAPTURE_EVIDENCE_FAILED：本地画面证据采集失败，空间几何尚未被视觉判否；'+String(error));}
}
