import {MAX_ASSET_CONCURRENCY} from '../execution-settings';
/** Bounded independent calls; any failure aborts active siblings and stops dispatch. */
export async function assetWorkers<T,R>(items:T[],concurrency:number,signal:AbortSignal,work:(item:T,index:number,signal:AbortSignal)=>Promise<R>):Promise<R[]>{
 if(!Number.isInteger(concurrency)||concurrency<1||concurrency>MAX_ASSET_CONCURRENCY)throw Error('资产并发数必须为 1–'+MAX_ASSET_CONCURRENCY);
 signal.throwIfAborted();const controller=new AbortController(),abort=()=>controller.abort(signal.reason);signal.addEventListener('abort',abort,{once:true});
 let next=0,failure:unknown;const result:R[]=[];
 const worker=async()=>{while(!controller.signal.aborted){const i=next++;if(i>=items.length)return;try{result[i]=await work(items[i],i,controller.signal);}catch(error){if(failure===undefined)failure=error;controller.abort(error);return;}}};
 try{await Promise.all(Array.from({length:Math.min(concurrency,items.length)},worker));signal.throwIfAborted();if(failure!==undefined)throw failure;return result;}finally{signal.removeEventListener('abort',abort);}
}
