import {readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {resolve,relative,isAbsolute,join} from 'node:path';
import {createHash} from 'node:crypto';
const [root]=process.argv.slice(2);if(!root)throw Error('Explicit isolated SDK root required');
const base=realpathSync(root),patch=resolve(import.meta.dir,'../patches/engine-volume-depth-v1'),manifest=JSON.parse(readFileSync(join(patch,'manifest.json'),'utf8'));
const admission=JSON.parse(readFileSync(join(base,'.scene-foundry-isolated-sdk.json'),'utf8'));
if(admission.source===base||admission.purpose!=='engine-volume-depth-validation')throw Error('Isolated SDK admission required');
const sha=(b:string|Buffer)=>createHash('sha256').update(b).digest('hex');
const changes=manifest.files.map((f:any)=>{const file=realpathSync(join(base,f.path)),rel=relative(base,file);if(rel.startsWith('..')||isAbsolute(rel))throw Error('Patch target escapes isolated SDK');const before=readFileSync(file,'utf8');if(sha(before)!==f.before)throw Error('Pinned shader/runtime differs: '+f.path);if(f.old&&!before.includes(f.old))throw Error('Runtime patch anchor missing');return {path:f.path,file,before:f.before,source:f.replacement?readFileSync(join(patch,f.replacement),'utf8'):before.replace(f.old,f.new)};});
// Validate every target before changing either file.
for(const f of changes)writeFileSync(f.file,f.source);
const receipt={id:manifest.id,base:manifest.base,root:base,files:changes.map(f=>({path:f.path,before:f.before,after:sha(f.source)}))};
writeFileSync(join(base,'engine-volume-depth-patch.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
