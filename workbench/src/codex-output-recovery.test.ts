import {test,expect} from 'bun:test';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseFinalJson,recoverCodexOutput} from './codex-output-recovery';
import {PROMPT_CONTRACT} from './prompts';
import {CODEX_WORKER_INSTRUCTIONS} from './codex-provider';
import {digest,save} from './store';
test('只接受明确最终块中的完整JSON，推理样例、截断和尾随内容不恢复',()=>{expect(parseFinalJson('thinking\n{}\ncodex\n{"ok":true}\n')).toEqual({ok:true});for(const s of ['thinking\n{}','\ncodex\n{"ok":','\ncodex\n{}\nunknown'])expect(()=>parseFinalJson(s)).toThrow();});
test('恢复校验输入、图片和模型，保留中断事实且不伪造usage',()=>{const dir=mkdtempSync(join(tmpdir(),'codex-recovery-')),input={role:'scene-alignment',system:'中文规则',text:'输入',images:[],modelSettings:{model:'gpt-6-astra',reasoningEffort:'xhigh'}},prefix=join(dir,input.role+'-');try{
 const receipt={requestedModel:'gpt-6-astra',requestedReasoning:'xhigh',workerInstructionsSha256:digest(CODEX_WORKER_INSTRUCTIONS),images:[],executable:'codex'};save(prefix+'failure.json',{error:'timeout'});save(prefix+'execution.json',{status:'timed_out',endedAt:'2026-09-23',durationMs:480000});save(prefix+'prompt.json',{contract:PROMPT_CONTRACT,language:'zh-CN',engine:'ForgeaX Engine',system:input.system,input:input.text});save(prefix+'input-receipt.json',receipt);writeFileSync(prefix+'cli.log','OpenAI Codex v0.156.1\nmodel: gpt-6-astra\nprovider: openai\nreasoning effort: xhigh\ncodex\n{"ok":true}\n');
 const result=recoverCodexOutput(input,dir);expect(result.value).toEqual({ok:true});expect(result.receipt.stopReason).toBe('recovered-final-output');expect(result.receipt.originalProcessStatus).toBe('timed_out');expect(result.receipt.usage).toBeNull();expect(()=>recoverCodexOutput({...input,text:'另一个输入'},dir)).toThrow('提示词');save(prefix+'input-receipt.json',{...receipt,images:[{sha256:'wrong',mime:'image/png',bytes:1}]});expect(()=>recoverCodexOutput(input,dir)).toThrow('图片');save(prefix+'input-receipt.json',{...receipt,requestedModel:'other'});expect(()=>recoverCodexOutput(input,dir)).toThrow('模型');
 }finally{rmSync(dir,{recursive:true,force:true})}});
