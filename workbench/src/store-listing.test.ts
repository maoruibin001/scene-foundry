import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {listJobs,save} from './store';
test('unpublished job directories do not crash or hide published jobs',()=>{
 const root=mkdtempSync(join(tmpdir(),'job-publication-'));
 try{
  const a=crypto.randomUUID(),b=crypto.randomUUID();mkdirSync(join(root,a));mkdirSync(join(root,b));
  save(join(root,a,'job.json'),{id:a,createdAt:'2026-10-03T10:00:00Z'});
  expect(listJobs(root).map(j=>j.id)).toEqual([a]);
  save(join(root,b,'job.json'),{id:b,createdAt:'2026-10-03T11:00:00Z'});
  expect(listJobs(root).map(j=>j.id)).toEqual([b,a]);
  rmSync(join(root,b,'job.json'));expect(listJobs(root).map(j=>j.id)).toEqual([a]);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('corrupt published records are reported, not silently treated as absent',()=>{
 const root=mkdtempSync(join(tmpdir(),'job-corruption-'));
 try{const id=crypto.randomUUID();mkdirSync(join(root,id));writeFileSync(join(root,id,'job.json'),'{invalid');expect(()=>listJobs(root)).toThrow();}
 finally{rmSync(root,{recursive:true,force:true});}
});
