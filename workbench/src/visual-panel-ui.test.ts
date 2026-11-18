import {test,expect} from 'bun:test';
import {visualPanelHTML,visualReviewHistoryHTML} from '../public/visual-panel-ui.js';
test('panel exposes every judge, uncertainty, failure and immutable report links; old jobs still render',()=>{
 const file=(j:any,f:string)=>'/files/runs/'+j.id+'/'+f;
 expect(visualPanelHTML({id:'old'},file)).toBe('');
 const p={overall:76,winner:'codex2',validCount:2,expectedCount:3,median:65,min:54,max:76,complete:false,members:[{id:'codex2',model:'gpt-fixture',reasoningEffort:'medium',status:'completed',review:{overall:76,verdict:'partial',dimensions:[]},durationMs:1500,usage:{cliReportedTokens:321}},{id:'codex3',model:'gpt-other',status:'failed',error:'<bad>'}],basePath:'visual-reviews/round-1'};
 const html=visualPanelHTML({id:'job',styleReview:{panel:p}},file);expect(html).toContain('联合验收尚未通过');expect(html).toContain('321');expect(html).toContain('&lt;bad&gt;');expect(html).not.toContain('<bad>');expect(html).toContain('/files/runs/job/visual-reviews/round-1/codex2/review.json');expect(html).toContain('codex3/failure.json');expect(html).toContain('单次金额未计量');
 expect(visualReviewHistoryHTML({id:'job',visualReviews:[{id:'old',file:'visual-reviews/old/review.json',overall:45,diagnosticOnly:true},{id:'new',file:'visual-reviews/new/review.json',overall:76}]},file)).toContain('old/review.json');
});
