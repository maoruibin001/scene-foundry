export type ReuseMode='auto'|'fresh';
export function reuseMode(value:unknown='auto'):ReuseMode{
 if(value!=='auto'&&value!=='fresh')throw Error('未知复用方式');return value;
}
/** Fresh runs may resume their own saved work, but never read another run's caches. */
export function crossTaskReuse(job:any){return job.reuseMode!=='fresh'&&job.optimizationPolicy?.reuse!==false&&!job.batchId;}
export function freshCheckpointScope(job:any){
 if(job.reuseMode!=='fresh')return {};
 const root=job.executionRecoveryRoot??job.id;
 if(!root)throw Error('从头生成的检查点缺少原始任务标识');
 return {freshRoot:root};
}
