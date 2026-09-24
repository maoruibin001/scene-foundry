import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(process.argv[2]),generated=join(root,'game/assets/generated');
const {generateScene}=await import(pathToFileURL(join(generated,'build-scene.ts')).href);
const {projectScene}=await import(pathToFileURL(join(generated,'platform/engineBridge.ts')).href);
const entities=projectScene(await generateScene()).entities;
const path=join(root,'game/assets/scene-audit.json'),audit=JSON.parse(readFileSync(path,'utf8'));
for(const part of audit.parts){
 const matches=entities.filter((e:any)=>e.name===part.id);
 if(matches.length!==1||!matches[0].mesh)throw Error('Missing or ambiguous native binding for '+part.id);
 part.bindingKey=matches[0].slug;
}
writeFileSync(path,JSON.stringify(audit,null,2));
console.log(JSON.stringify({mappedParts:audit.parts.length,source:'official exported projectScene binding slugs'}));
