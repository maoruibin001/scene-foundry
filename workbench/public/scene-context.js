/** One UI, with explicit worker/file namespaces. A mode switch loads a new page. */
export function currentSceneKind(pathname=globalThis.location?.pathname??'/'){
 return pathname==='/voxel'||pathname.startsWith('/voxel/')?'voxel':'ordinary';
}
export function scenePath(path,kind=currentSceneKind()){
 if(kind!=='voxel'||typeof path!=='string')return path;
 if(path.startsWith('/api/voxel/')||path.startsWith('/voxel/'))return path;
 if(path.startsWith('/api/'))return '/api/voxel/'+path.slice(5);
 if(path.startsWith('/files/')||path.startsWith('/process/'))return '/voxel'+path;
 return path;
}
/** Only URL attributes are scoped; prompts, reports and external previews stay intact. */
export function sceneHTML(html,kind=currentSceneKind()){
 return html.replace(/\b(href|src|data-src|poster)=(['"])(\/(?:api|files|process)\/[^'"<>]*)\2/g,(_,attr,quote,path)=>`${attr}=${quote}${scenePath(path,kind)}${quote}`);
}
export function sceneGenerationSettings(settings,kind=currentSceneKind()){
 const result={...settings};
 if(kind==='voxel'){delete result.pipelinePreset;delete result.scoreWeights;result.sceneKind='voxel';}
 return result;
}
