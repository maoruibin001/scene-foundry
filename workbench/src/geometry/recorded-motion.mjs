/** Unpaired camera observations describe motion, never pixels. A missing video gate stays failed. */
export function recordedMotion(videoFrames,receipt,observations,recordingStartedAt,expectedFrames){
 if(videoFrames.videoSha256!==receipt.sha256)throw Error('连续画面与原始录屏来源不符');
 const complete=videoFrames.status==='complete'&&videoFrames.frames.length===expectedFrames;
 const incomplete=videoFrames.status==='incomplete'&&videoFrames.issue?.code==='VIDEO_POSE_COVERAGE'&&videoFrames.frames.length===0;
 if(!complete&&!incomplete)throw Error('录屏取帧回执无效');
 const samples=complete?videoFrames.frames.map(frame=>{
  const observed=observations[frame.observationIndex];
  if(!observed||Math.abs((observed.at-recordingStartedAt)-frame.observationTimeMs)>.001||Math.abs(frame.videoTimeMs-frame.observationTimeMs)>250)throw Error('连续画面与实际相机观测不符');
  return {...observed,name:frame.name,kind:'continuous',videoTimeMs:frame.videoTimeMs,observationDeltaMs:frame.observationDeltaMs};
 }):observations.map((sample,index)=>({...sample,name:'camera-observation-'+(index+1),kind:'motion-observation'}));
 return {samples,issue:incomplete?videoFrames.issue:null,videoPassed:complete&&receipt.bytes>0};
}
