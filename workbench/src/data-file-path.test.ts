import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {resolveDataFile} from './data-file-path';

function fixture(run:(root:string)=>void){
 const root=mkdtempSync(join(tmpdir(),'scene-data-files-'));
 try{run(root);}finally{rmSync(root,{recursive:true,force:true});}
}
function file(root:string,path:string){const target=join(root,path);mkdirSync(join(target,'..'),{recursive:true});writeFileSync(target,'reference pixels');return target;}

test('普通文件保留请求路径；缺失文件和目录不作为文件提供',()=>fixture(root=>{
 const path=file(root,'uploads/reference.jpg');
 expect(resolveDataFile(root,'uploads/reference.jpg')).toBe(path);
 expect(resolveDataFile(root,'uploads/missing.jpg')).toBeNull();
 expect(resolveDataFile(root,'uploads')).toBeNull();
 expect(resolveDataFile(root,'')).toBeNull();
 expect(resolveDataFile(join(root,'missing'),'reference.jpg')).toBeNull();
}));

test('macOS /tmp 与 /private/tmp 别名的合法文件可读',()=>{
 if(process.platform!=='darwin')return;
 const root=mkdtempSync('/tmp/scene-data-files-alias-');
 try{
  const path=file(root,'uploads/reference.jpg');
  expect(realpathSync(root)).toStartWith('/private/tmp/');
  expect(resolveDataFile(root,'uploads/reference.jpg')).toBe(path);
  expect(resolveDataFile(realpathSync(root),'uploads/reference.jpg')).toBe(realpathSync(path));
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('显式符号链接 DATA 根可读，同根文件链接保留请求名称',()=>fixture(root=>{
 const data=join(root,'physical-data'),alias=join(root,'data-alias');
 const path=file(data,'uploads/reference.jpg');symlinkSync(data,alias,'dir');
 symlinkSync(path,join(data,'uploads/alias.jpg'));
 expect(resolveDataFile(alias,'uploads/reference.jpg')).toBe(join(alias,'uploads/reference.jpg'));
 expect(resolveDataFile(alias,'uploads/alias.jpg')).toBe(join(alias,'uploads/alias.jpg'));
}));

test('外部文件链接、同名前缀目录及逻辑路径穿越均拒绝',()=>fixture(root=>{
 const data=join(root,'data'),sibling=join(root,'data-extra');
 file(data,'uploads/reference.jpg');const outside=file(sibling,'outside.jpg');
 symlinkSync(outside,join(data,'uploads/external.jpg'));
 symlinkSync(sibling,join(data,'linked-directory'),'dir');
 for(const path of ['uploads/external.jpg','linked-directory/outside.jpg','../data-extra/outside.jpg',outside,'../../outside.jpg']){
  expect(resolveDataFile(data,path)).toBeNull();
 }
}));

test('逻辑与物理目标均拒绝 node_modules 和模型预算文件',()=>fixture(root=>{
 const data=join(root,'data');file(data,'uploads/reference.jpg');
 const blocked=['node_modules/package/index.js','nested/node_modules/secret.png','model-budget.json','model-budget-codex.json','nested/model-budget.json','nested/model-budget-codex.json'];
 for(const [index,path]of blocked.entries()){
  const target=file(data,path),alias='uploads/alias-'+index+'.jpg';symlinkSync(target,join(data,alias));
  expect(resolveDataFile(data,path)).toBeNull();expect(resolveDataFile(data,alias)).toBeNull();
 }
 const harmless=file(data,'uploads/model-budget-notes.json');
 expect(resolveDataFile(data,'uploads/model-budget-notes.json')).toBe(harmless);
}));

test('普通与体素 DATA 相互隔离，不从另一根解析同名或外链文件',()=>fixture(root=>{
 const ordinary=join(root,'ordinary'),voxel=join(root,'voxel');
 const a=file(ordinary,'uploads/reference.jpg'),b=file(voxel,'uploads/reference.jpg');
 symlinkSync(b,join(ordinary,'uploads/voxel.jpg'));symlinkSync(a,join(voxel,'uploads/ordinary.jpg'));
 expect(resolveDataFile(ordinary,'uploads/reference.jpg')).toBe(a);
 expect(resolveDataFile(voxel,'uploads/reference.jpg')).toBe(b);
 expect(resolveDataFile(ordinary,'uploads/voxel.jpg')).toBeNull();
 expect(resolveDataFile(voxel,'uploads/ordinary.jpg')).toBeNull();
 expect(resolveDataFile(ordinary,'../voxel/uploads/reference.jpg')).toBeNull();
 expect(resolveDataFile(voxel,'../ordinary/uploads/reference.jpg')).toBeNull();
}));

test('非法空字节请求不抛出并保持拒绝',()=>fixture(root=>{
 expect(resolveDataFile(root,'uploads/reference\0.jpg')).toBeNull();
}));
