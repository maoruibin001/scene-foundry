"""Prepare exact local source dependencies without switching an existing checkout."""
import json,os,pathlib,subprocess
root=pathlib.Path(__file__).resolve().parents[1];brief=json.loads((root/'brief.json').read_text())
def run(args,cwd,env=None):
 print('+', ' '.join(args),flush=True);subprocess.run(args,cwd=cwd,env=env,check=True)
for name,url,key in [('engine','https://github.com/ForgeaXGame/forgeax-engine.git','engineSha'),('scene-generator','https://github.com/ForgeaXGame/forgeax-ex-scene-generator.git','generatorSha')]:
 path=root.parent/name
 if not path.exists():
  run(['git','clone','--filter=blob:none','--no-checkout',url,str(path)],root)
  run(['git','fetch','origin',brief[key]],path)
  run(['git','checkout','--detach',brief[key]],path)
 actual=subprocess.check_output(['git','rev-parse','HEAD'],cwd=path,text=True).strip()
 if actual!=brief[key]:raise SystemExit(f'{name}: wrong HEAD; existing checkout was not changed')
 run(['git','diff','--quiet','HEAD'],path)
 if name=='engine':
  env={**os.environ,'FORGEAX_SKIP_HARNESS_SYNC':'1','FORGEAX_PACKAGE_BUILD_CONCURRENCY':'2'}
  run(['corepack','pnpm','install','--frozen-lockfile'],path,env)
  run(['corepack','pnpm','build:engine'],path,env)
 else:
  run(['bun','install','--frozen-lockfile'],path)
  run(['bun','run','build:vendor'],path)
link=root/'game/node_modules/@forgeax/engine';link.parent.mkdir(parents=True,exist_ok=True)
expected=(root.parent/'engine/packages/engine').resolve()
if not link.exists():link.symlink_to(expected,target_is_directory=True)
if link.resolve()!=expected:raise SystemExit('Existing Engine type-resolution link points elsewhere; not modified')
print('Exact dependencies prepared. Run bun run generate, build, verify, preview.')
