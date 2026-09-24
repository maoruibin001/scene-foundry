import {Terminal} from './vendor/xterm.mjs';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const streams=[['log','实时执行日志'],['stdout','实时标准输出'],['input','调用输入'],['inputReceipt','输入附件与配置'],['response','最终结果'],['partial','未完成输出']];
let record='',selected='',stream='log',follow=true,panel=null,terminal=null,connection=null,resizeObserver=null,calls=[],nextKey='',nextCalls=[],request=0;
const $=id=>panel?.querySelector(id);
const live=()=>['log','stdout'].includes(stream);
export function consoleHTML(key,items){nextKey=key;nextCalls=items;return '<div id="call-console-slot"></div>';}
function disconnect(){connection?.close();connection=null;request++;}
export function hideConsole(){disconnect();}
function size(){if(!terminal||!panel?.isConnected)return;const width=$('#call-live-terminal').clientWidth;terminal.resize(Math.max(20,Math.floor((width-24)/7.9)),22);}
function makePanel(){
 const element=document.createElement('section');element.className='call-console';element.setAttribute('aria-label','模型调用只读终端');
 element.innerHTML=`<div class="console-heading"><h2>实时调用输出</h2><span class="pill">观察者 · 只读</span></div><p class="muted">查看本次调用的真实输出。连接到当前调用后，新增内容由服务端持续推送。</p><div class="console-controls"><label>选择模型调用<select id="console-call" aria-label="选择模型调用"></select></label><label>查看内容<select id="console-stream" aria-label="查看内容">${streams.map(([id,label])=>`<option value="${id}">${label}</option>`).join('')}</select></label><label class="console-follow"><input id="console-follow" type="checkbox" checked>跟随最新</label><button id="console-refresh">重新连接</button></div><p id="console-meta" class="muted" role="status">正在连接…</p><div id="call-live-terminal" aria-label="只读实时终端"></div><pre id="call-console-output" tabindex="0" aria-label="已保存调用内容" hidden></pre><p id="console-error" role="status"></p><p class="muted">只读订阅；关闭、刷新页面不会停止或重启生成。</p>`;
 return element;
}
export function mountConsole(){
 const slot=document.querySelector('#call-console-slot');if(!slot)return;
 const changed=record!==nextKey;
 if(changed||!panel){disconnect();resizeObserver?.disconnect();terminal?.dispose();terminal=null;panel=makePanel();record=nextKey;stream='log';follow=true;selected='';}
 calls=nextCalls;
 if(!calls.length){slot.textContent='该记录没有可订阅的模型调用。';disconnect();return;}
 const previous=selected;
 if(!calls.some(c=>c.id===selected))selected=calls.find(c=>c.status==='running')?.id??calls[0].id;
 slot.replaceWith(panel);
 $('#console-call').innerHTML=calls.map(c=>`<option value="${escape(c.id)}" ${c.id===selected?'selected':''}>${escape(c.id)} · ${escape(c.status)}</option>`).join('');
 $('#console-stream').value=stream;
 if(!terminal){
  terminal=new Terminal({disableStdin:true,convertEol:true,cols:90,rows:22,scrollback:4000,fontSize:13,fontFamily:'Menlo, monospace',minimumContrastRatio:7,
   theme:{background:'#f7f9f5',foreground:'#233e38',cursor:'#27604d',cursorAccent:'#f7f9f5',selectionBackground:'#bdd8ca',
    black:'#263b35',red:'#a3342b',green:'#25613c',yellow:'#795900',blue:'#285ca0',magenta:'#854580',cyan:'#1c666e',white:'#57675f',
    brightBlack:'#627168',brightRed:'#b03d32',brightGreen:'#2e7047',brightYellow:'#866400',brightBlue:'#336bb2',brightMagenta:'#92538a',brightCyan:'#28747b',brightWhite:'#65756c'},screenReaderMode:true});
  terminal.open($('#call-live-terminal'));
  terminal.onScroll(()=>{if(terminal.buffer.active.viewportY<terminal.buffer.active.baseY){follow=false;$('#console-follow').checked=false;}});
  resizeObserver=new ResizeObserver(size);resizeObserver.observe($('#call-live-terminal'));
 }
 requestAnimationFrame(size);
 if(changed||previous!==selected||(!connection&&live()))connect();
 else if(!live()&&!$('#call-console-output').textContent)void saved();
}
function resetView(){
 $('#console-error').textContent='';
 $('#call-live-terminal').hidden=!live();$('#call-console-output').hidden=live();
 $('#console-refresh').textContent=live()?'重新连接':'刷新内容';
}
function connect(){
 disconnect();if(!panel?.isConnected)return;
 resetView();if(!live()){void saved();return;}
 terminal.reset();$('#console-meta').textContent='正在连接当前调用输出…';
 const source=new EventSource('/api/process/live?'+new URLSearchParams({key:record,call:selected,stream}));connection=source;
 const active=()=>connection===source&&panel?.isConnected;
 let hasOutput=false,truncated=false;
 source.addEventListener('reset',event=>{if(!active())return;const data=JSON.parse(event.data);terminal.reset();hasOutput=false;truncated=data.truncated;});
 source.addEventListener('output',event=>{if(!active())return;const data=JSON.parse(event.data);hasOutput=true;terminal.write(data.text,()=>{if(follow)terminal.scrollToBottom();});});
 source.addEventListener('missing',()=>{if(active())$('#console-meta').textContent='尚未发现此输出文件，等待当前调用写入…';});
 source.addEventListener('state',event=>{if(!active())return;const data=JSON.parse(event.data);$('#console-meta').textContent=`${data.file} · ${data.terminal?'调用已结束，显示保留输出':'实时连接 · '+(data.status==='running'?'记录执行中':data.status)}${truncated?' · 初始画面保留末尾 128 KiB':''}`;});
 source.addEventListener('end',event=>{if(!active())return;const data=JSON.parse(event.data);source.close();$('#console-meta').textContent=`调用已结束 · ${data.status} · 当前没有运行中的此调用。${data.missing?'此输出未保存。':hasOutput?'显示已保留输出。':'输出文件为 0 字节。'}`;});
 source.addEventListener('observer-error',event=>{if(!active())return;source.close();$('#console-error').textContent='观察连接中断：'+JSON.parse(event.data).error+'。生成状态不受影响，可重新连接。';});
 source.onerror=()=>{if(active())$('#console-error').textContent='观察连接暂时断开，正在重新连接；不会重启模型。';};
 source.onopen=()=>{if(active())$('#console-error').textContent='';};
}
async function saved(){
 const token=++request;
 $('#console-meta').textContent='正在读取已保存内容…';$('#call-console-output').textContent='';
 try{
  const response=await fetch('/api/process/call?'+new URLSearchParams({key:record,call:selected,stream}),{signal:AbortSignal.timeout(8000)});
  const data=await response.json();if(!response.ok)throw Error(data.error);
  if(token!==request||!panel?.isConnected)return;
  $('#call-console-output').textContent=data.state==='missing'?'此调用未保存这项内容。':data.state==='empty'?'文件已创建，当前为 0 字节。':data.text;
  $('#console-meta').textContent=`${data.file} · ${data.bytes??'未知'} 字节 · 已保存工件${data.truncated?' · 仅显示开头 128 KiB':''}`;
 }catch(error){if(token===request&&panel?.isConnected)$('#console-error').textContent='读取失败：'+error.message;}
}
document.addEventListener('change',event=>{
 if(!panel?.contains(event.target))return;
 if(event.target.id==='console-follow'){follow=event.target.checked;if(follow)terminal?.scrollToBottom();return;}
 if(event.target.id==='console-call')selected=event.target.value;
 else if(event.target.id==='console-stream')stream=event.target.value;
 else return;
 follow=true;$('#console-follow').checked=true;connect();
});
document.addEventListener('click',event=>{if(panel?.contains(event.target)&&event.target.closest('#console-refresh'))connect();});
document.addEventListener('visibilitychange',()=>{if(document.hidden)disconnect();else if(panel?.isConnected)connect();});
window.addEventListener('pagehide',disconnect);
