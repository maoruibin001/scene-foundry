const timestamp=v=>typeof v==='number'&&Number.isFinite(v)?v:typeof v==='string'&&Number.isFinite(Date.parse(v))?Date.parse(v):null;
export function historyTiming(job,observer,now=Date.now()){
 const start=timestamp(job.createdAt)??timestamp(observer?.start),running=['queued','running'].includes(job.status);
 const rawEnd=running?timestamp(now):timestamp(job.endedAt)??timestamp(observer?.end);
 const end=start!==null&&rawEnd!==null&&rawEnd>=start?rawEnd:null;
 return {start,end,running};
}
