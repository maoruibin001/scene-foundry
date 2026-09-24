const REQUIRED_STAGES=['candidate','generate-export','generation-budget','publish-assets','engine-binding','project-check','engine-build','catalog','asset-verify','asset-ready','engine-status'];
const sha=(v:any,length=64)=>typeof v==='string'&&new RegExp('^[a-f0-9]{'+length+'}$').test(v);
/** 把实际构建和浏览器身份交给视觉评分器；不由图片猜测引擎，也不替代视觉质量判断。 */
export function verifiedRuntimeEvidence(report:any,runtime:any,expected:{engineSha:string;generatorSha:string},actualDistDigest:string,minimumSubmittedFps:number){
 const require=(ok:any,reason:string)=>{if(!ok)throw Error('RUNTIME_EVIDENCE_INVALID：'+reason);};
 require(sha(expected.engineSha,40)&&sha(expected.generatorSha,40)&&report?.engineSha===expected.engineSha&&report?.generatorSha===expected.generatorSha,'引擎或生成器与冻结版本不一致');
 require(REQUIRED_STAGES.every(stage=>report.stages?.[stage]?.status==='passed'),'构建、资源或引擎检查证据不完整');
 require(sha(actualDistDigest)&&report.distManifestDigest===actualDistDigest&&runtime?.distManifestDigest===actualDistDigest,'浏览器与当前构建产物不一致');
 require(sha(report.buildInputDigest)&&sha(report.catalog?.sha256),'构建或资源目录摘要缺失');
 require(runtime.hard?.runtime===true&&runtime.hard?.entitiesLoaded===true&&runtime.hard?.noErrors===true&&Array.isArray(runtime.images)&&runtime.images.length>0,'缺少真实运行画面或资源加载证据');
 require(Number.isFinite(minimumSubmittedFps)&&minimumSubmittedFps>0&&runtime.hard.frameRate===true&&Number.isFinite(runtime.submittedFps)&&runtime.submittedFps>=minimumSubmittedFps,'帧率记录缺失、与检查矛盾或未达到本任务门槛');
 const measured=(value:any,label:string)=>{if(value==null)return null;require(Number.isFinite(value)&&value>0,label+'记录无效');return value;};
 const performance={submittedFps:runtime.submittedFps,minimumSubmittedFps,frameRateCheckPassed:true,p95FrameMs:measured(runtime.performance?.p95FrameMs,'95分位帧间隔'),minWindowFps:measured(runtime.performance?.minWindowFps,'最小采样窗口帧率'),recordedVideoFps:measured(runtime.recording?.decodedFps,'录屏解码帧率'),measurement:'submittedFps来自观测期间Engine更新帧计数和时间差；录屏帧率来自PTS解码，二者分别列出。缺少的历史测量值为null，不伪造为零。',scope:'只证明该观测时段的测量及既有帧率检查，不证明所有时刻无卡顿、闪烁或视觉缺陷。'};
 return {source:'project/evidence/run-report.json + runtime/runtime.json + project/game/dist/forgeax-dist.json',engine:'ForgeaX Engine',engineSha:report.engineSha,generatorSha:report.generatorSha,buildInputDigest:report.buildInputDigest,distManifestDigest:actualDistDigest,catalogSha256:report.catalog.sha256,verifiedStages:[...REQUIRED_STAGES],runtime:{loaded:true,noErrors:true,frames:[...runtime.images],performance},scope:'仅证明固定引擎构建、资源检查与当前浏览器运行身份及观测期帧率；不证明画面还原、材质质量或需求全部实现。'};
}
