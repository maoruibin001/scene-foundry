import {test,expect,afterEach} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,appendFileSync,readFileSync,symlinkSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Source} from './source';
import {TEXT_LIMIT} from './call-log';
const roots:string[]=[];
const id='00000000-0000-0000-0000-000000000000';
function fixture(){const root=mkdtempSync(join(tmpdir(),'call-log-test-'));roots.push(root);const dir=join(root,'runs',id);mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'job.json'),JSON.stringify({id,status:'running',stages:{},events:[]}));writeFileSync(join(dir,'plan-execution.json'),JSON.stringify({status:'running'}));return {root,dir,source:new Source(root),key:'run:'+id};}
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
test('observer follows appended content without mutating source, distinguishes missing and empty',()=>{
 const {dir,source,key}=fixture();const before=readFileSync(join(dir,'job.json'),'utf8');
 expect(source.call(key,'plan','log').state).toBe('missing');
 writeFileSync(join(dir,'plan-cli.log'),'');expect(source.call(key,'plan','log').state).toBe('empty');
 appendFileSync(join(dir,'plan-cli.log'),'第一步\n');expect(source.call(key,'plan','log').text).toBe('第一步\n');
 appendFileSync(join(dir,'plan-cli.log'),'第二步\n');expect(source.call(key,'plan','log').text).toBe('第一步\n第二步\n');
 expect(readFileSync(join(dir,'job.json'),'utf8')).toBe(before);
});
test('bounded tail preserves UTF-8 and reports truncation; input uses head',()=>{
 const {dir,source,key}=fixture();writeFileSync(join(dir,'plan-cli.log'),'中'.repeat(TEXT_LIMIT)+'\n最后一行');
 const log=source.call(key,'plan','log');expect(log.readBytes).toBe(TEXT_LIMIT);expect(log.truncated).toBe(true);expect(log.text.endsWith('最后一行')).toBe(true);expect(log.text).not.toContain('\ufffd');
 writeFileSync(join(dir,'plan-prompt.json'),'开始'+'.'.repeat(TEXT_LIMIT)+'结束');
 const input=source.call(key,'plan','input');expect(input.window).toBe('head');expect(input.text.startsWith('开始')).toBe(true);expect(input.text).not.toContain('结束');
});
test('call and stream selection cannot read other records, arbitrary paths, or escaped symlinks',()=>{
 const {root,dir,source,key}=fixture();writeFileSync(join(root,'private.json'),'private');
 expect(()=>source.call(key,'../private','log')).toThrow();expect(()=>source.call(key,'plan','../../private.json')).toThrow();
 expect(()=>source.call(key,'plan','constructor')).toThrow();
 const other=fixture();writeFileSync(join(other.dir,'plan-cli.log'),'outside');symlinkSync(join(other.dir,'plan-cli.log'),join(dir,'plan-cli.log'));
 expect(()=>source.call(key,'plan','log')).toThrow();
});
test('terminal control sequences are inert but source evidence stays unchanged',()=>{
 const {dir,source,key}=fixture();const raw='\x1b[31merror\x1b[0m\n<script>alert(1)</script>\x1b]0;title\x07';writeFileSync(join(dir,'plan-cli.log'),raw);
 expect(source.call(key,'plan','log').text).toBe('error\n<script>alert(1)</script>');expect(readFileSync(join(dir,'plan-cli.log'),'utf8')).toBe(raw);
});
