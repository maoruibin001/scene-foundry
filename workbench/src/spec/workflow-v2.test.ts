import {test,expect} from 'bun:test';
import {optionalReport,specV2Outcome,approveSpecReview} from './workflow-v2';
test('风格判分和量测不替代 owner 认可，运行错误仍失败',()=>{
 expect(specV2Outcome({hard:{runtime:true,noErrors:true,frameRate:false}})).toBe('needs_review');
 expect(specV2Outcome({hard:{runtime:true,noErrors:false}})).toBe('failed');
 expect(specV2Outcome({hard:{runtime:true}})).toBe('failed');
});
test('可选报告失败时保留已有场景，取消不被吞掉',async()=>{
 expect(await optionalReport(async()=>{throw Error('judge unavailable')})).toEqual({value:null,error:'Error: judge unavailable'});
 const ctl=new AbortController();ctl.abort();
 expect(optionalReport(async()=>{throw Error('cancelled')},ctl.signal)).rejects.toThrow('cancelled');
});
test('只有用户明确认可且构建和截图摘要一致才可记录通过',()=>{
 const job={specJob:'spec-job-v1',status:'needs_review',specGate:{ownerApproval:'pending'},runtime:{hard:{runtime:true,noErrors:true},distManifestDigest:'dist',images:['inspection-front.png'],hashes:['image']}};
 expect(approveSpecReview(job,{distManifestDigest:'dist',images:{'inspection-front.png':'image'}},'time').method).toBe('explicit-ui');
 expect(()=>approveSpecReview(job,{distManifestDigest:'other',images:{'inspection-front.png':'image'}})).toThrow('构建证据');
 expect(()=>approveSpecReview(job,{distManifestDigest:'dist',images:{'inspection-front.png':'bad'}})).toThrow('截图证据');
 expect(()=>approveSpecReview({...job,status:'running'},{distManifestDigest:'dist',images:{}})).toThrow('待人工确认');
});
