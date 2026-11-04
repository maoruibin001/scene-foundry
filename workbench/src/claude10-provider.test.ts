import {test,expect} from 'bun:test';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {claude10Message,parseClaude10Result,claude10Option,isClaude10,claude10Environment} from './claude10-provider';

test('选择只绑定claude10模型且只允许声明的思考深度',()=>{
 const option=claude10Option();expect(isClaude10(option.model)).toBe(true);expect(isClaude10('gpt-6-astra')).toBe(false);expect(option.supportedReasoningEfforts.map(x=>x.reasoningEffort)).toEqual(['high','xhigh']);
});
test('两张原图作为图像输入而非文件路径发送',()=>{
 const dir=mkdtempSync(join(tmpdir(),'claude10-input-'));try{const a=join(dir,'a.png'),b=join(dir,'b.jpg');writeFileSync(a,'image1');writeFileSync(b,'image2');const line=JSON.parse(claude10Message({system:'sys',text:'text',images:[{path:a,mime:'image/png'},{path:b,mime:'image/jpeg'}]}));expect(line.type).toBe('user');expect(line.message.content.map((x:any)=>x.type)).toEqual(['image','image','text']);expect(line.message.content[0].source.data).toBe(Buffer.from('image1').toString('base64'));expect(JSON.stringify(line)).not.toContain(a);}finally{rmSync(dir,{recursive:true,force:true});}
});
test('只接受明确报告目标模型且包含结构化结果的完成回执',()=>{
 const response={type:'result',subtype:'success',is_error:false,structured_output:{answer:'ok'},modelUsage:{'claude-opus-5-5':{inputTokens:1}},session_id:'s'};
 expect(JSON.parse(parseClaude10Result(JSON.stringify(response),'claude-opus-5-5').text)).toEqual({answer:'ok'});
 expect(()=>parseClaude10Result(JSON.stringify({...response,modelUsage:{other:{}}}),'claude-opus-5-5')).toThrow('MODEL_ROUTE_UNVERIFIED');
 expect(()=>parseClaude10Result(JSON.stringify({...response,structured_output:null}),'claude-opus-5-5')).toThrow('PROVIDER_EMPTY_OUTPUT');
 expect(()=>parseClaude10Result(JSON.stringify({...response,is_error:true}),'claude-opus-5-5')).toThrow('PROVIDER_CLAUDE_FAILED');
 expect(()=>parseClaude10Result(JSON.stringify({...response,is_error:true,subtype:'error_max_budget_usd'}),'claude-opus-5-5')).toThrow('MODEL_BUDGET_EXHAUSTED');
 expect(()=>parseClaude10Result(JSON.stringify({...response,modelUsage:{'claude-opus-5-5':{},other:{}}}),'claude-opus-5-5')).toThrow('MODEL_ROUTE_UNVERIFIED');
});

test('仅将 Claude 所需的原有认证环境传给启动器，其他供应商凭证隔离',()=>{const env=claude10Environment({HOME:'/home/test',ANTHROPIC_API_KEY:'fixture',ANTHROPIC_BASE_URL:'https://example.invalid',OPENAI_API_KEY:'not-allowed',OTHER_SECRET:'not-allowed'});expect(env).toEqual({HOME:'/home/test',ANTHROPIC_BASE_URL:'https://example.invalid',ANTHROPIC_API_KEY:'fixture'});});
