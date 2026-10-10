import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const sidecars=['delivery-assessment.json','assessment-evidence.json','reconstruction-goal.json','image-reconstruction.json'];
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'output-package-'));
 const job={id:'job',status:'failed',stages:{build:{status:'passed'}},profile:{engineSha:'engine'}};
 writeFileSync(join(root,'job.json'),JSON.stringify(job));
 return {root,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
function run(script:string,root:string,descriptor?:any){
 const result=spawnSync('python3',[join(import.meta.dir,script),root],{input:descriptor?JSON.stringify(descriptor):undefined,encoding:'utf8'});
 expect(result.status,result.stderr).toBe(0);return JSON.parse(result.stdout);
}
function archive(path:string){
 const result=spawnSync('python3',['-c',`import sys,json,zipfile,hashlib
with zipfile.ZipFile(sys.argv[1]) as z:
 assert z.testzip() is None
 manifest=json.loads(z.read('manifest.sha256.json'))
 assert all(hashlib.sha256(z.read(p)).hexdigest()==h for p,h in manifest.items())
 names=z.namelist()
 print(json.dumps({'names':names,'sidecars':{p:json.loads(z.read(p)) for p in ${JSON.stringify(sidecars)} if p in names},'dist':z.read('project/game/dist/forgeax-dist.json').decode()}))`,path],{encoding:'utf8'});
 expect(result.status,result.stderr).toBe(0);return JSON.parse(result.stdout);
}
function output(root:string,folder:string,value:string){
 const base=join(root,folder);mkdirSync(join(base,'project/game/dist'),{recursive:true});
 writeFileSync(join(base,'project/game/dist/forgeax-dist.json'),value);return base;
}
test('当前下载包沿选定输出归档报告与70回执，不混入当前失败分支',()=>{
 const f=fixture();try{
  const selected=output(f.root,'iterations/1','selected-dist');output(f.root,'','unselected-dist');
  for(const name of sidecars){writeFileSync(join(selected,name),JSON.stringify({candidate:'selected'}));writeFileSync(join(f.root,name),JSON.stringify({candidate:'unselected'}));}
  const receipt=run('output-package.py',f.root,{best:{folder:'iterations/1',distManifestDigest:'a'.repeat(64),kind:'scene',qualityStatus:'not_met'}}),zip=archive(join(f.root,receipt.file));
  expect(zip.dist).toBe('selected-dist');for(const name of sidecars)expect(zip.sidecars[name]).toEqual({candidate:'selected'});
 }finally{f.cleanup();}
});
test('完整场景包包含根评审侧车，旧输出没有报告仍可下载且不凭空造报告',()=>{
 const f=fixture();try{
  output(f.root,'','root-dist');for(const name of sidecars)writeFileSync(join(f.root,name),JSON.stringify({candidate:'root'}));
  const full=archive(join(f.root,run('package.py',f.root).file));for(const name of sidecars)expect(full.sidecars[name]).toEqual({candidate:'root'});
  for(const name of sidecars)rmSync(join(f.root,name));
  const legacy=archive(join(f.root,run('output-package.py',f.root,{best:{folder:'',distManifestDigest:'b'.repeat(64),kind:'scene',qualityStatus:'not_assessed'}}).file));
  expect(legacy.dist).toBe('root-dist');expect(legacy.sidecars).toEqual({});
 }finally{f.cleanup();}
});
test('灰模下载带走选定候选的空间评审和冻结目标，保留未评范围且不造原图成品报告',()=>{
 const f=fixture();try{
  const selected=output(f.root,'generation/blockout/0','graybox-dist'),files=['space.json','gate.json','reference-composition.json','spatial-assessment-evidence.json','reconstruction-goal.json'];
  for(const file of files){writeFileSync(join(selected,file),JSON.stringify({candidate:'selected-graybox'}));writeFileSync(join(f.root,file),JSON.stringify({candidate:'different-root'}));}
  writeFileSync(join(f.root,'image-reconstruction.json'),JSON.stringify({status:'passed',candidate:'different-root'}));
  const receipt=run('output-package.py',f.root,{best:{folder:'generation/blockout/0',distManifestDigest:'c'.repeat(64),kind:'graybox',qualityStatus:'not_assessed',score:null}}),zip=archive(join(f.root,receipt.file));
  for(const file of files)expect(zip.names).toContain(file);expect(zip.names).not.toContain('image-reconstruction.json');expect(zip.dist).toBe('graybox-dist');
  const contents=spawnSync('python3',['-c',`import sys,json,zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
 print(json.dumps({p:json.loads(z.read(p)) for p in ${JSON.stringify(files)}}))`,join(f.root,receipt.file)],{encoding:'utf8'});
  expect(contents.status,contents.stderr).toBe(0);for(const file of files)expect(JSON.parse(contents.stdout)[file]).toEqual({candidate:'selected-graybox'});
 }finally{f.cleanup();}
});
