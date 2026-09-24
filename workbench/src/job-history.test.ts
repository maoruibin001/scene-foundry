import {test,expect} from 'bun:test';
import {queryJobHistory} from './job-history';
const job=(id:string,extra:any={})=>({id,createdAt:'2026-09-22T08:00:00.000Z',prompt:'红白 Lighthouse 灯塔',mode:'prompt',complexity:'simple',status:'passed',profile:{id:'f'.repeat(64),model:'luna',reasoningEffort:'low'},pipelineVersion:{id:'version-a',label:'v1-rc.1'},stages:{build:{status:'passed',durationMs:1000},judge:{durationMs:2000}},quality:{score:90},runtime:{images:['view-1.png'],video:'scene-tour.webm'},...extra});
const jobs=Array.from({length:45},(_,i)=>job(String(i).padStart(3,'0'),{createdAt:new Date(Date.UTC(2026,8,22,8,i)).toISOString()}));
const query=(p:string,rows=jobs)=>queryJobHistory(rows,new URLSearchParams(p),[{id:'version-a',label:'v1'}],[{id:'batch-a',name:'回归批次'}]);
test('server pagination is bounded, deterministic, and contains every row exactly once',()=>{
 const pages=[1,2,3].map(p=>query('page='+p));expect(pages.map(p=>p.items.length)).toEqual([20,20,5]);expect(pages[0].items[0].id).toBe('044');expect(new Set(pages.flatMap(p=>p.items.map(j=>j.id))).size).toBe(45);
 expect(query('page=999').page).toBe(3);expect(query('sort=oldest&pageSize=10').items[0].id).toBe('000');
 expect(queryJobHistory([job('b'),job('a')],new URLSearchParams()).items.map(j=>j.id)).toEqual(['b','a']);
 for(const p of ['page=0','page=-1','page=NaN','pageSize=101','pageSize=2.5','status=wrong'])expect(()=>query(p)).toThrow();
});
test('prompt, version, status, batch, model and complexity filters combine before pagination',()=>{
 const rows=[job('a',{batchId:'batch-a',caseId:'c01',attempt:2}),job('b',{status:'failed',prompt:'大花盆',modelSettings:{model:'terra'},complexity:'complex'}),job('c',{pipelineVersion:{id:'version-b',label:'v1.1'},status:'running'})];
 const result=query('q=LIGHTHOUSE&version=version-a&status=passed&batch=batch-a&model=luna&complexity=simple',rows);expect(result.total).toBe(1);expect(result.items[0].batch).toEqual({id:'batch-a',name:'回归批次',caseId:'c01'});expect(result.items[0].attempt).toBe(2);expect(result.items[0].version.label).toBe('v1');
 expect(query('batch=none',rows).total).toBe(2);expect(query('status=not_passed',rows).items.map(j=>j.id)).toEqual(['b']);expect(query('q=%E4%B8%8D%E5%AD%98%E5%9C%A8&page=4',rows)).toMatchObject({total:0,page:1,pages:1,from:0,to:0});
});
test('time filtering uses inclusive UTC boundaries and rejects inverted or ambiguous dates',()=>{
 const params=new URLSearchParams({from:'2026-09-22T16:05:00+08:00',to:'2026-09-22T16:10:00+08:00'});expect(query(params.toString()).total).toBe(6);
 expect(()=>query('from=2026-09-22')).toThrow('时区');expect(()=>query(new URLSearchParams({from:'2026-09-23T00:00:00Z',to:'2026-09-22T00:00:00Z'}).toString())).toThrow('开始时间');
});
test('compact output keeps exact inputs and evidence links, without exposing full execution payloads',()=>{
 const row=query('',[job('a',{prompt:'<script>alert(1)</script>\n完整描述',image:{id:'image-a',file:'a.png',name:'原图.png'},mode:'image_prompt',events:[{private:'large'}],sceneIR:{entities:[1]},error:'failure detail'})]).items[0];
 expect(row.prompt).toBe('<script>alert(1)</script>\n完整描述');expect(row.image?.name).toBe('原图.png');expect(row.durationMs).toBe(3000);expect(row.thumbnail).toContain('view-1.png');expect(row.downloadable).toBe(true);expect('events' in row).toBe(false);expect('sceneIR' in row).toBe(false);
 expect(query('',[job('b',{status:'running'})]).items[0].downloadable).toBe(false);
});
