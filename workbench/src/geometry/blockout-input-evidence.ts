import {existsSync,readdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {read} from '../store';
import {assetContacts} from './contacts';

/** A saved space alone cannot prove that generation received its shared interfaces. */
export function blockoutContactInputRecorded(folder:string,space:any,brief:any,responseFile?:string){
 const expected=assetContacts(space,brief.id);if(!expected.length)return true;
 const prompts:string[]=[],batches=join(folder,'batches');
 if(responseFile)prompts.push(join(dirname(responseFile),'scene-blockout-prompt.json'));
 else{
  if(existsSync(batches))for(const batch of readdirSync(batches).filter(n=>/^\d+$/.test(n)))prompts.push(join(batches,batch,'scene-blockout-prompt.json'));
  prompts.push(join(folder,'templates',brief.id,'scene-blockout-prompt.json'),join(folder,'scene-blockout-prompt.json'));
 }
 for(const file of prompts){
  if(!existsSync(file))continue;
  try{const raw=read(file).input,request=typeof raw==='string'?JSON.parse(raw):raw;
   const items=request?.items??[request],item=items.find(x=>x?.brief?.id===brief.id),shared=request?.sharedInterfaces?.find(x=>x?.templateId===brief.id);
   if(JSON.stringify(item?.spatialContacts??shared?.spatialContacts)===JSON.stringify(expected))return true;
  }catch{/* Missing or invalid input evidence cannot prove the shared interface contract. */}
 }
 if(!responseFile){
  // A selected local repair can preserve geometry without an initial template request.
  // Prove the repair received derived points at its source poses; its preview proves the edited result separately.
  const file=join(folder,'graybox-parts-source.json');
  if(existsSync(file))try{
   const proof=read(file);if(proof.version!=='reviewed-graybox-geometry-v1')return false;
   const raw=read(join(proof.repairFolder,'scene-space-prompt.json')).input,request=typeof raw==='string'?JSON.parse(raw):raw;
   const recorded=request?.sharedInterfaces?.find(x=>x?.templateId===brief.id),source=request?.previousSpace;
   if(source?.program?.templates?.some(b=>b.id===brief.id)&&recorded&&JSON.stringify(recorded.spatialContacts)===JSON.stringify(assetContacts(source,brief.id)))return true;
  }catch{/* Old or incomplete repair records cannot prove the new input. */}
 }
 return false;
}
export function blockoutContactsRecorded(folder:string,space:any){if(!space.spatialContacts?.length)return true;return space.program.templates.every(brief=>{
 if(!assetContacts(space,brief.id).length)return true;
 if(existsSync(join(folder,'graybox-parts-source.json')))return blockoutContactInputRecorded(folder,space,brief);
 const local=join(folder,'templates',brief.id),batchFile=join(local,'batch-source.json');
 if(existsSync(batchFile))try{const batch=read(batchFile).batch;if(!Number.isInteger(batch)||batch<0)return false;return blockoutContactInputRecorded(folder,space,brief,join(folder,'batches',String(batch),'scene-blockout-parsed.json'));}catch{return false;}
 if(existsSync(join(local,'scene-blockout-prompt.json')))return blockoutContactInputRecorded(folder,space,brief,join(local,'geometry.json'));
 return blockoutContactInputRecorded(folder,space,brief,join(folder,'scene-blockout-parsed.json'));
});}
