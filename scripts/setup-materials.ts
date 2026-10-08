import {mkdirSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {digest,save} from '../workbench/src/store';
import {MATERIAL_CATALOG,loadCatalogResource} from '../workbench/src/geometry/material-catalog';
import {importPbrCatalog} from '../workbench/src/geometry/import-pbr-catalog';
import sources from '../workbench/src/geometry/material-catalog-sources.json';

/** Prepare exact source-pinned materials; no model requests or historical scene inputs. */
for(const resource of sources.resources){
  if(existsSync(join(MATERIAL_CATALOG,resource.expectedId+'.json'))){
    loadCatalogResource(resource.expectedId);
    console.log('Verified material '+resource.assetId);
    continue;
  }
  const folder=join(MATERIAL_CATALOG,'sources',resource.assetId);
  mkdirSync(folder,{recursive:true});
  const files:Record<string,any>={};
  for(const source of resource.files){
    const path=join(folder,source.channel+'.png');
    if(!existsSync(path)){
      const response=await fetch(source.url,{signal:AbortSignal.timeout(60000)});
      if(!response.ok)throw Error('Material download failed: '+resource.assetId+' '+source.channel+' HTTP '+response.status);
      const bytes=new Uint8Array(await response.arrayBuffer());
      if(digest(bytes)!==source.sha256)throw Error('Material download checksum mismatch: '+resource.assetId+' '+source.channel);
      writeFileSync(path,bytes);
    }
    if(digest(readFileSync(path))!==source.sha256)throw Error('Existing source material checksum mismatch: '+path);
    files[source.channel]={path,url:source.url,sha256:source.sha256,md5:source.md5};
  }
  const request=join(folder,'request.json');
  const {expectedId,files:sourceFiles,...metadata}=resource;
  save(request,{...metadata,files});
  const result=await importPbrCatalog(request,MATERIAL_CATALOG);
  if(result.id!==expectedId)throw Error('Converted material differs from the pinned catalog: '+resource.assetId);
  loadCatalogResource(result.id);
  console.log('Prepared material '+resource.assetId+' '+result.id);
}
