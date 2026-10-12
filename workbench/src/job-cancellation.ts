export type JobExecution={job:any;controller:AbortController};

/** Cancel the executing job object itself so later progress saves keep the request. */
export function cancelJob(id:string,executions:Map<string,JobExecution>,deps:{read:(id:string)=>any;dequeue:(id:string)=>void;event:(job:any,type:string,message:string)=>void;now?:()=>number}){
 const execution=executions.get(id),job=execution?.job??deps.read(id);
 if(!['queued','running'].includes(job.status))throw Error('任务已结束');
 deps.dequeue(id);execution?.controller.abort();
 job.status='cancelled';job.cancelRequestedAt=(deps.now??Date.now)();job.endedAt=job.cancelRequestedAt;
 deps.event(job,'cancel','用户取消');return job;
}
