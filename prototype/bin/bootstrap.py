"""Prepare the pinned Engine release and exact scene-generator checkout without changing an existing one."""
import base64,hashlib,json,pathlib,subprocess
root=pathlib.Path(__file__).resolve().parents[1];brief=json.loads((root/'brief.json').read_text())
def run(args,cwd,env=None):
 print('+', ' '.join(args),flush=True);subprocess.run(args,cwd=cwd,env=env,check=True)
def engine_release(path,release):
 """Install the pinned npm Engine release; its tarball must match the brief's integrity. No native build runs."""
 stage=path.with_name(path.name+'.staging')
 if stage.exists():raise SystemExit(f'{stage} exists from an interrupted bootstrap; remove it and retry')
 stage.mkdir()
 spec=release['package']+'@'+release['version']
 tarball=subprocess.check_output(['npm','pack',spec,'--silent'],cwd=stage,text=True).strip().splitlines()[-1]
 actual='sha512-'+base64.b64encode(hashlib.sha512((stage/tarball).read_bytes()).digest()).decode()
 if actual!=release['integrity']:raise SystemExit(f'{spec}: tarball integrity {actual} does not match the brief; nothing installed')
 (stage/'package.json').write_text(json.dumps({'name':'forgeax-engine-release','private':True},indent=1)+'\n')
 run(['npm','install','--no-audit','--no-fund','./'+tarball],stage)
 (stage/tarball).unlink()
 (stage/'packages').mkdir();(stage/'packages/engine').symlink_to('../node_modules/'+release['package'],target_is_directory=True)
 (stage/'engine-release.json').write_text(json.dumps({**release,'engineCommit':brief['engineSha']},indent=1)+'\n')
 stage.rename(path)
for name,url,key in [('engine',None,'engineSha'),('scene-generator','https://github.com/ForgeaXGame/forgeax-ex-scene-generator.git','generatorSha')]:
 path=root.parent/name
 if name=='engine':
  release=brief['engineRelease']
  if not path.exists():engine_release(path,release)
  recorded=json.loads((path/'engine-release.json').read_text()) if (path/'engine-release.json').exists() else {}
  installed=json.loads((path/'packages/engine/package.json').read_text())
  if recorded.get('engineCommit')!=brief['engineSha'] or recorded.get('integrity')!=release['integrity'] or installed.get('version')!=release['version']:
   raise SystemExit('engine: existing directory is not the pinned release; not modified')
  continue
 if not path.exists():
  run(['git','clone','--filter=blob:none','--no-checkout',url,str(path)],root)
  run(['git','fetch','origin',brief[key]],path)
  run(['git','checkout','--detach',brief[key]],path)
 actual=subprocess.check_output(['git','rev-parse','HEAD'],cwd=path,text=True).strip()
 if actual!=brief[key]:raise SystemExit(f'{name}: wrong HEAD; existing checkout was not changed')
 run(['git','diff','--quiet','HEAD'],path)
 run(['bun','install','--frozen-lockfile'],path)
 run(['bun','run','build:vendor'],path)
link=root/'game/node_modules/@forgeax/engine';link.parent.mkdir(parents=True,exist_ok=True)
expected=(root.parent/'engine/packages/engine').resolve()
if not link.exists():link.symlink_to(expected,target_is_directory=True)
if link.resolve()!=expected:raise SystemExit('Existing Engine type-resolution link points elsewhere; not modified')
print('Exact dependencies prepared. Run bun run generate, build, verify, preview.')
