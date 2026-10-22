import {scenePath} from './scene-context.js';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const GROUPS=[['material','材质'],['lighting','光照'],['shape','形体'],['spatial','空间布局'],['coverage','需求覆盖'],['readability','可读性'],['other','需求与规则']];
const VERDICTS=[['confirmed','确认'],['dismissed','不是问题'],['unsure','不确定']];
const SOURCE={dimension:'评分维度',criterion:'验收标准',requirement:'需求',spec:'规则',measurement:'客观测量'};
const groupOf=i=>i.source==='measurement'?'spatial':i.source==='requirement'||i.source==='spec'||!i.dimension?'other':i.dimension;
const scoreText=i=>Number.isFinite(i.score)?`${i.score}/${i.scale}`:({partial:'部分满足',unmet:'未满足',needs_review:'待复核',failed:'未通过'})[i.verdict]??i.verdict??'';

/** Judge issues of the delivered round with each person's verdict; verdicts never change the score. */
export function judgeIssuesCard(j){return j.review?`<section class="card" data-judge-issues="${esc(j.id)}"><h2>评委问题核对</h2><div data-issues-body>正在读取评委问题…</div></section>`:'';}
function frameLinks(job,issue){
 return issue.frames.map(f=>{const n=f.match(/reference-(\d+)\.png$/)?.[1],input=n&&job.images?.[n-1];
  return `<a href="${scenePath('/files/runs/')+esc(job.id)}/${esc(f)}" target="_blank"><img src="${scenePath('/files/runs/')+esc(job.id)}/${esc(f)}" alt="${esc(f.split('/').pop())}" style="height:54px;border-radius:6px"></a>${input?`<a href="${scenePath('/files/uploads/')+esc(input.file)}" target="_blank" title="参考输入 ${n}"><img src="${scenePath('/files/uploads/')+esc(input.file)}" alt="参考输入 ${n}" style="height:54px;border-radius:6px;outline:2px solid #c9b48a"></a>`:''}`;}).join(' ');
}
function issueRow(job,issue,v){
 return `<div class="issue" data-issue="${esc(issue.id)}" style="padding:10px 0;border-top:1px solid var(--line)">
  <p><span class="badge">${esc(SOURCE[issue.source])}</span> ${issue.critical?'<span class="badge failed">关键</span> ':''}<b>${esc(scoreText(issue))}</b> ${esc(issue.title)}</p>
  <p>${esc(issue.reason)}</p><p>${frameLinks(job,issue)}</p>
  <div class="actions">${VERDICTS.map(([k,label])=>`<button data-verdict="${k}" aria-pressed="${v?.verdict===k}" style="${v?.verdict===k?'background:#2f5d46;color:white;border-color:#2f5d46':''}">${label}</button>`).join('')}${v?'<button data-verdict="">清除</button>':''}
  <input data-note placeholder="补充说明（可选），例如：皮椅应为深棕哑光" value="${esc(v?.note??'')}" style="flex:1;min-width:220px"></div></div>`;
}
export function judgeIssuesHTML(job,report){
 if(!report.issues.length)return `<p class="hint">${esc(report.reason??'本轮评审没有低于阈值的问题。')}</p>`;
 const v=report.verdicts,count=k=>report.issues.filter(i=>v[i.id]?.verdict===k).length,open=report.issues.filter(i=>!v[i.id]).length;
 const groups=GROUPS.map(([key,label])=>{const items=report.issues.filter(i=>groupOf(i)===key);if(!items.length)return '';
  const head=items.find(i=>i.source==='dimension'),rest=items.filter(i=>i!==head).sort((a,b)=>(a.score??0)-(b.score??0));
  return `<details ${head&&head.score<3?'open':''}><summary><b>${label}</b>${head?` · ${head.score}/5`:''} · ${items.length} 条${items.some(i=>!v[i.id])?` · ${items.filter(i=>!v[i.id]).length} 条未核对`:''}</summary>${[head,...rest].filter(Boolean).map(i=>issueRow(job,i,v[i.id])).join('')}</details>`;}).join('');
 return `<p>本轮（${esc(report.folder)}）评分 ${esc(report.score??'未评分')}。已确认 <b>${count('confirmed')}</b> · 不是问题 ${count('dismissed')} · 不确定 ${count('unsure')} · 未核对 ${open}</p>${groups}
 <p class="hint">问题来自交付轮的评委评审、规则报告和管线客观测量；核对结论单独保存，不修改评分、门槛或原报告。点缩略图可查看原图，金色边框为对应的参考输入。</p>`;
}
export async function refreshJudgeIssues(job){
 const root=document.querySelector('[data-judge-issues]');if(!root)return;
 const url=scenePath('/api/jobs/'+root.dataset.judgeIssues);
 const load=async()=>{const r=await fetch(url+'/judge-issues',{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('评委问题暂不可读取');return r.json();};
 const render=report=>{if(root.isConnected)root.querySelector('[data-issues-body]').innerHTML=judgeIssuesHTML(job,report);};
 const save=async(row,verdict)=>{const r=await fetch(url+'/issue-verdicts',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({issueId:row.dataset.issue,verdict,note:row.querySelector('[data-note]').value})});
  if(!r.ok)throw Error((await r.json().catch(()=>({}))).error??'保存失败');report={...report,verdicts:(await r.json()).verdicts};render(report);};
 let report;
 try{report=await load();render(report);}catch(error){if(root.isConnected)root.querySelector('[data-issues-body]').textContent=error.message;return;}
 root.onclick=e=>{const b=e.target.closest('[data-verdict]');if(!b)return;const row=b.closest('[data-issue]');save(row,b.dataset.verdict||null).catch(error=>alert(error.message));};
 // A note alone keeps the current verdict, or marks the issue unsure when none was chosen yet.
 root.onchange=e=>{if(!e.target.matches('[data-note]'))return;const row=e.target.closest('[data-issue]');save(row,report.verdicts[row.dataset.issue]?.verdict??'unsure').catch(error=>alert(error.message));};
}
