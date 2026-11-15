import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
test('规格包带齐风格原图、源/有效规格、补全/复评依据，并记录独立打包器身份',()=>{
 const data=mkdtempSync(join(tmpdir(),'spec-package-')),run=join(data,'runs','result');mkdirSync(run,{recursive:true});mkdirSync(join(data,'uploads'));writeFileSync(join(data,'uploads','ref.jpg'),'original-image');
 const job={status:'needs_review',stages:{build:{status:'passed'}},image:{file:'ref.jpg'},images:[],styleImages:[{file:'ref.jpg',caption:'reference'}],profile:{engineSha:'engine-fixed'},runtime:{distManifestDigest:'fixed-dist'}};writeFileSync(join(run,'job.json'),JSON.stringify(job));
 for(const f of ['scene-spec.json','source-scene-spec.json','spec-export.json','spec-gate.json','style-review.json','parameter-repair/parameter-resolution.json','visual-reviews/review/review.json']){mkdirSync(join(run,f,'..'),{recursive:true});writeFileSync(join(run,f),JSON.stringify({evidence:f}));}
 const code=join(import.meta.dir,'package.py'),p=Bun.spawnSync(['python3',code,run]);expect(p.exitCode).toBe(0);
 const check=Bun.spawnSync(['python3','-c',`import zipfile,json,hashlib,sys\nz=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None\nm=json.loads(z.read('manifest.sha256.json'));assert all(hashlib.sha256(z.read(k)).hexdigest()==v for k,v in m.items())\nprint(json.dumps({'names':z.namelist(),'packaging':json.loads(z.read('packaging.json'))}))`,join(run,'scene-project.zip')]);expect(check.exitCode).toBe(0);const result=JSON.parse(check.stdout.toString());expect(result.names.filter((x:string)=>x==='input/ref.jpg')).toHaveLength(1);
 for(const name of ['input/style-references.json','source-scene-spec.json','parameter-repair/parameter-resolution.json','visual-reviews/review/review.json'])expect(result.names).toContain(name);
 expect(result.packaging.packagerSha256).toBe(createHash('sha256').update(readFileSync(code)).digest('hex'));expect(result.packaging.distManifestDigest).toBe('fixed-dist');
});
