import {test,expect} from 'bun:test';
import {optionalReport,specV2Outcome,approveSpecReview,specApprovalIssues} from './workflow-v2';
test('风格判分和量测不替代 owner 认可，运行错误仍失败',()=>{
 expect(specV2Outcome({hard:{runtime:true,noErrors:true,frameRate:false}})).toBe('needs_review');
 expect(specV2Outcome({hard:{runtime:true,noErrors:false}})).toBe('failed');
 expect(specV2Outcome({hard:{runtime:true}})).toBe('failed');
});
test('构建/资产核对证据明确失败时不能进入待确认',()=>{
 expect(specV2Outcome({hard:{runtime:true,noErrors:true,build:false}})).toBe('failed');
 expect(specV2Outcome({hard:{runtime:true,noErrors:true,catalog:false}})).toBe('failed');
 // 历史记录没有 build/catalog 字段时不追溯判定；性能指标仍由 owner 判断。
 expect(specV2Outcome({hard:{runtime:true,noErrors:true,frameRate:false}})).toBe('needs_review');
});
test('失败的硬检查和风格判分必须由 owner 逐项确认并写入回执',()=>{
 const job={specJob:'spec-job-v1',status:'needs_review',
  specGate:{ownerApproval:'pending',failed:['frameRate'],fps:10.9,hard:{runtime:true,noErrors:true,frameRate:false,build:true,catalog:true},verifyError:'asset check failed',styleReviewError:null,styleJudge:{overall:40,verdict:'partial',passed:false}},
  runtime:{hard:{runtime:true,noErrors:true},distManifestDigest:'dist',images:['inspection-1.png'],hashes:['image']},
  specExport:{unresolved:0,proxies:0,dropped:0}};
 const actual={distManifestDigest:'dist',images:{'inspection-1.png':'image'}};
 expect(specApprovalIssues(job)).toEqual(expect.arrayContaining(['frameRate','styleJudge','verifyError']));
 expect(()=>approveSpecReview(job,actual)).toThrow('未确认');
 const issues=specApprovalIssues(job),approval=approveSpecReview(job,actual,'time',issues);
 expect(approval.acknowledgedFailures).toEqual(issues);
 expect(approval.fps).toBe(10.9);
 expect(approval.styleJudge).toEqual({overall:40,verdict:'partial',passed:false});
 expect(()=>approveSpecReview(job,actual,'time',['frameRate'])).toThrow('styleJudge');
});
test('可选报告失败时保留已有场景，取消不被吞掉',async()=>{
 expect(await optionalReport(async()=>{throw Error('judge unavailable')})).toEqual({value:null,error:'Error: judge unavailable'});
 const ctl=new AbortController();ctl.abort();
 expect(optionalReport(async()=>{throw Error('cancelled')},ctl.signal)).rejects.toThrow('cancelled');
});
test('历史无效评审被作废后，owner 必须单独确认「证据无效需重评」',()=>{
 const job={specJob:'spec-job-v1',status:'needs_review',
  specGate:{ownerApproval:'pending',failed:[],fps:60,hard:{runtime:true,noErrors:true,build:true,catalog:true},
   styleJudge:{overall:40,verdict:'partial',passed:false},
   historicalReviewInvalidation:{version:'spec-history-migration-v1',scoreUsable:false,requiresStyleReReview:true}},
  runtime:{hard:{runtime:true,noErrors:true},distManifestDigest:'dist',images:['inspection-1.png'],hashes:['image']},
  specExport:{unresolved:0,proxies:0,dropped:0}};
 const actual={distManifestDigest:'dist',images:{'inspection-1.png':'image'}};
 expect(specApprovalIssues(job)).toContain('styleReviewInvalidated');
 // 只确认「分数低」不够，作废证据这一项必须也显式确认。
 expect(()=>approveSpecReview(job,actual,'time',['styleJudge'])).toThrow('styleReviewInvalidated');
 const approval=approveSpecReview(job,actual,'time',specApprovalIssues(job));
 expect(approval.acknowledgedFailures).toContain('styleReviewInvalidated');
});
test('只有用户明确认可且构建和截图摘要一致才可记录通过',()=>{
 const job={specJob:'spec-job-v1',status:'needs_review',specGate:{ownerApproval:'pending'},runtime:{hard:{runtime:true,noErrors:true},distManifestDigest:'dist',images:['inspection-front.png'],hashes:['image']}};
 expect(approveSpecReview(job,{distManifestDigest:'dist',images:{'inspection-front.png':'image'}},'time').method).toBe('explicit-ui');
 expect(()=>approveSpecReview(job,{distManifestDigest:'other',images:{'inspection-front.png':'image'}})).toThrow('构建证据');
 expect(()=>approveSpecReview(job,{distManifestDigest:'dist',images:{'inspection-front.png':'bad'}})).toThrow('截图证据');
 expect(()=>approveSpecReview({...job,status:'running'},{distManifestDigest:'dist',images:{}})).toThrow('待人工确认');
});
