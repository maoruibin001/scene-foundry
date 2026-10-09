import {test,expect} from 'bun:test';
import {join} from 'node:path';
import {DATA} from '../store';
import {evidenceFileURL} from './visibility-evidence';
test('诊断图片沿当前普通或体素命名空间解析，中文路径编码且不能引用DATA外文件',()=>{
 const folder=join(DATA,'runs','case','generation','repair'),path=join(DATA,'runs','case','generation','baseline','runtime','参考.png'),href=evidenceFileURL(path,folder);
 for(const prefix of ['/files/','/voxel/files/'])expect(new URL(href,'http://127.0.0.1:19774'+prefix+'runs/case/generation/repair/visibility.html').pathname).toBe(prefix+'runs/case/generation/baseline/runtime/'+encodeURIComponent('参考.png'));
 expect(()=>evidenceFileURL('/private/example.png',folder)).toThrow('数据目录外');expect(()=>evidenceFileURL(path,'/private/example')).toThrow('数据目录外');
});
