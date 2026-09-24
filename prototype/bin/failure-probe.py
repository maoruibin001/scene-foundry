"""Exercise a real over-budget export and check last-good files survive."""
import hashlib,json,pathlib,shutil,subprocess,tempfile
root=pathlib.Path(__file__).resolve().parents[1]
fixture=pathlib.Path(tempfile.mkdtemp(prefix='budget-probe-',dir=root.parent))
def digest(folder):
 h=hashlib.sha256()
 for p in sorted(folder.rglob('*')):
  if p.is_file():h.update(str(p.relative_to(folder)).encode());h.update(p.read_bytes())
 return h.hexdigest()
try:
 shutil.copytree(root/'bin',fixture/'bin');shutil.copytree(root/'source',fixture/'source')
 target=fixture/'game/assets/generated';shutil.copytree(root/'game/assets/generated',target)
 b=json.loads((root/'brief.json').read_text());b['budget']['maxTriangles']=1;(fixture/'brief.json').write_text(json.dumps(b))
 before=digest(target)
 run=subprocess.run(['bun','bin/pipeline.ts','generate'],cwd=fixture,text=True,capture_output=True,timeout=30)
 after=digest(target)
 report=json.loads((fixture/'evidence/run-report.json').read_text())
 passed=run.returncode!=0 and before==after and report['stages']['generation-budget']['status']=='failed' and 'publish-assets' not in report['stages']
 evidence={'passed':passed,'exitCode':run.returncode,'before':before,'after':after,'stages':report['stages'],'purpose':'Actual over-budget generation must not replace last-good generated assets.'}
 (root/'evidence/failure-probe.json').write_text(json.dumps(evidence,indent=2)+'\n')
 print(json.dumps(evidence,indent=2));assert passed
finally:shutil.rmtree(fixture)
