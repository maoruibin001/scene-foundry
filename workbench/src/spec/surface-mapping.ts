/** Detect absent/constant primary UVs without rewriting the source mesh. */
export function degeneratePrimaryUv(asset:any){
 const uv=asset.attributes?.uv??asset.attributes?.uv0;
 if(!uv?.length)return true;
 let loU=Infinity,hiU=-Infinity,loV=Infinity,hiV=-Infinity;
 for(let i=0;i<uv.length;i+=2){if(!Number.isFinite(uv[i])||!Number.isFinite(uv[i+1]))throw Error('SURFACE_UV_NONFINITE');loU=Math.min(loU,uv[i]);hiU=Math.max(hiU,uv[i]);loV=Math.min(loV,uv[i+1]);hiV=Math.max(hiV,uv[i+1]);}
 return hiU-loU<1e-5&&hiV-loV<1e-5;
}
export function bindWorldSurfaceVariants(meshes:any[],materials:any[],assetFor:(mesh:any)=>any){
 const changes:any[]=[];
 for(const mesh of meshes){const asset=assetFor(mesh);if(!asset||!degeneratePrimaryUv(asset))continue;
  for(const [slot,key] of Object.entries(mesh.slots)){
   const material=materials.find(m=>m.key===key);if(!material?.surface)continue;
   const variant=material.key+'-world-surface';
   if(!materials.some(m=>m.key===variant))materials.push({...material,key:variant,options:{...material.options,triplanar:{space:'world',scale:material.surface.tilesPerMeter,sharpness:4}}});
   mesh.slots[slot]=variant;changes.push({mesh:mesh.key,slot,sourceMaterial:key,material:variant,reason:'absent-or-constant-primary-uv',mapping:'world',tilesPerMeter:material.surface.tilesPerMeter});
  }
 }
 return changes;
}
