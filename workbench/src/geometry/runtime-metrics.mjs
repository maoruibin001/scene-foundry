const dot=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0),sub=(a,b)=>a.map((v,i)=>v-b[i]),unit=a=>a.map(v=>v/Math.hypot(...a)),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export function analyzeSceneRun(samples,audit,width=1600,height=900){
 if(!samples.length||samples.some(s=>!s?.position?.every(Number.isFinite)||!s.target?.every(Number.isFinite)))throw Error('缺少真实相机位姿');
 const reference=samples.filter(s=>s.kind==='view'),continuous=samples.filter(s=>s.kind==='continuous'),first=continuous[0],last=continuous.at(-1);
 if(continuous.length<4||!reference.length)throw Error('缺少固定机位或连续观测证据');
 const frames=reference.map(s=>{
  const forward=unit(sub(s.target,s.position)),right=unit(cross(forward,[0,1,0])),up=cross(right,forward),f=height/(2*Math.tan(s.fov/2));
  const boxes=audit.landmarks.filter(l=>l.role==='subject').map(l=>{const d=sub(l.position,s.position),z=dot(d,forward),x=width/2+dot(d,right)*f/z,y=height/2-dot(d,up)*f/z,r=Math.max(...l.size)/2*f/z;return {id:l.id,z,x,y,r};}).filter(p=>p.z>.03&&p.x+p.r>0&&p.x-p.r<width&&p.y+p.r>0&&p.y-p.r<height);
  const lo=boxes.length?Math.max(0,Math.min(...boxes.map(p=>p.y-p.r))):0,hi=boxes.length?Math.min(height,Math.max(...boxes.map(p=>p.y+p.r))):0;
  return {frame:s.name,heightRatio:(hi-lo)/height,visibleCandidateParts:boxes.length,estimate:'实际相机投影的主体包围球范围；不等于可见像素，遮挡仍须视觉核验'};
 });
 const minHeightRatio=Math.min(...frames.map(f=>f.heightRatio)),movement=Math.max(...continuous.map(s=>Math.hypot(...sub(s.position,first.position))));
 const expected=audit.parts.map(p=>p.id),missing=[...new Set(samples.flatMap(s=>expected.filter(id=>s.parts?.filter(p=>p.id===id&&p.loaded===true).length!==1)))];
 const times=last.frameTimes.filter(n=>Number.isFinite(n)&&n>0),sorted=[...times].sort((a,b)=>a-b),p95=sorted[Math.floor(sorted.length*.95)]??Infinity;
 const windows=[];for(let i=0;i+60<=times.length;i+=60)windows.push(60000/times.slice(i,i+60).reduce((a,b)=>a+b,0));
 const fps=(last.frames-first.frames)/((last.at-first.at)/1000),depthRanges=continuous.map(s=>{const f=unit(sub(s.target,s.position)),depths=audit.landmarks.map(l=>dot(sub(l.position,s.position),f));return Math.max(...depths)-Math.min(...depths)});
 const allViews=reference.length===audit.views.length&&reference.every((s,i)=>s.selectedView===i);
 const checkedTour=continuous.some(s=>audit.views[s.selectedView]?.cruise),tourChecks=continuous.map(s=>{
  const c=audit.views[s.selectedView]?.cruise;if(!c)return {frame:s.name,verified:!checkedTour};
  const d=c.displacement,den=dot(d,d),t=den?dot(sub(s.position,c.origin),d)/den:0,deviation=Math.hypot(...sub(s.position,c.origin).map((v,i)=>v-d[i]*t));
  return {frame:s.name,verified:c.status==='ready'&&den>1e-8&&t>=-.0001&&t<=1.0001&&deviation<.0001,progress:t,deviation};
 }),tourValid=tourChecks.every(c=>c.verified);
 return {submittedFps:fps,subjectMeasurement:{frames,minHeightRatio,safeFraming:minHeightRatio>=.25,requiresVisualReview:true},composition:{method:'输入参考机位及独立检查机位，主体投影和 AI 遮挡核验'},cameraEvidence:{maxDisplacement:movement,depthRanges,positions:continuous.map(s=>s.position),source:'真实 Engine 相机 Transform',tourClearance:{status:checkedTour?(tourValid?'verified':'failed'):'not-recorded',checks:tourChecks}},performance:{p95FrameMs:p95,minWindowFps:windows.length?Math.min(...windows):0},missingParts:missing,hard:{framing:minHeightRatio>=.25,cameraMotion:movement>.05&&tourValid,nonFlat:Math.min(...depthRanges)>.5,multipleViews:allViews&&samples.length>=6,entitiesLoaded:expected.length>0&&missing.length===0&&samples.every(s=>!s.ambiguousSource),frameRate:fps>=10&&p95<100&&windows.length>0&&Math.min(...windows)>=10}};
}
