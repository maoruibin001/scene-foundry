import {realpathSync,statSync} from 'node:fs';
import {basename,resolve,sep} from 'node:path';

const restricted=(path:string)=>path.split(sep).includes('node_modules')||/^model-budget(?:-codex)?\.json$/.test(basename(path));

/** Resolve an already decoded /files path without exposing another data root. */
export function resolveDataFile(dataDir:string,relativePath:string):string|null {
 const root=resolve(dataDir),file=resolve(root,relativePath);
 if(!file.startsWith(root+sep)||restricted(file))return null;
 try{
  // Both physical paths must use the same coordinate system: on macOS /tmp
  // resolves to /private/tmp, and an explicit data-root symlink is also valid.
  const realRoot=realpathSync(root),realFile=realpathSync(file);
  if(!realFile.startsWith(realRoot+sep)||restricted(realFile)||!statSync(realFile).isFile())return null;
  // Retain the requested name for existing Content-Disposition semantics.
  return file;
 }catch{return null;}
}
