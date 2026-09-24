from pathlib import Path
import sys, zipfile, hashlib, json
root=Path(sys.argv[1]).resolve()
job=json.loads((root/'job.json').read_text())
if job.get('stages',{}).get('build',{}).get('status')!='passed': raise SystemExit('build not passed')
output=root/'scene-project.zip'
with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
    archive.writestr('input/prompt.json',json.dumps({'prompt':job.get('prompt'),'image':job.get('image'),'images':job.get('images'),'generationMethod':job.get('generationMethod'),'generationModel':job.get('generationModel'),'complexity':job.get('complexity'),'modelSettings':job.get('modelSettings'),'pipelineProfile':job.get('profile'),'pipelineVersion':job.get('pipelineVersion'),'assessmentVersion':job.get('assessmentVersion'),'generationBrief':job.get('generationBrief'),'reusePlanFrom':job.get('reusePlanFrom'),'reuseSceneFrom':job.get('reuseSceneFrom')},ensure_ascii=False,indent=2))
    version=job.get('pipelineVersion')
    if version:
        folder=root.parent.parent/'versions'/version['id']
        for name in ['manifest.json','release.json']:
            if (folder/name).is_file(): archive.write(folder/name,'pipeline-version/'+name)
    if job.get('reuseSceneFrom'):
        previous=root.parent/job['reuseSceneFrom']
        for name in ['job.json','plan.json','scene-ir.json','generate-response.txt','generate-receipt.json','post-review.json']:
            f=previous/name
            if f.is_file(): archive.write(f,'lineage/'+name)
    for image in job.get('images', [job['image']] if job.get('image') else []):
        reference=root.parent.parent/'uploads'/image['file']
        if not reference.is_file(): raise SystemExit('reference image missing')
        archive.write(reference,'input/'+reference.name)
    for relative in ['project/game/assets','project/game/dist','project/source','project/evidence','runtime','iterations','assessments','materials','generation']:
        for file in sorted((root/relative).rglob('*')):
            if file.is_file() and not file.is_symlink(): archive.write(file,file.relative_to(root))
    for relative in ['project/game/forge.json','project/game/package.json','project/brief.json','job.json','generation-brief.json','complexity.json','plan.json','generated-scene.json','scene-generation-prompt.json','scene-generation-receipt.json','scene-generation-response.txt','recipe.json','review.json','quality.json','manual-audit.json','scene-ir.json','structure.json','spec-report.json','spec-snapshot.json','repair.json','structural-repair.json','structure-before-repair.json','scene-ir-before-repair.json','post-review.json','ui-acceptance.json','native-provenance.json','reference-layout.json','layout-fit.json','reference-observations.json','reference-observations-prompt.json','reference-observations-receipt.json','reference-observations-response.txt','project/reference-layout.json','judge-receipt.json','judge-prompt.json','spec.json']:
        file=root/relative
        if file.is_file(): archive.write(file,relative)
    archive.writestr('READ-ME.txt','ForgeaX runnable project and validation evidence.\nQuality status: '+job['status']+'\nA runnable build is not a passed quality result. See job.json and quality.json.\nUse the pinned Engine CLI: project engine use-local <engine-checkout> --root project/game; project preview --root project/game.\n')
# A self-contained integrity checker verifies extracted contents without the workbench.
with zipfile.ZipFile(output,'a',zipfile.ZIP_DEFLATED) as archive:
    files={i.filename:hashlib.sha256(archive.read(i.filename)).hexdigest() for i in archive.infolist()}
    archive.writestr('manifest.sha256.json',json.dumps(files,indent=2)+'\n')
    archive.writestr('verify-package.py',"from pathlib import Path\nimport hashlib,json\nr=Path(__file__).resolve().parent\nm=json.loads((r/'manifest.sha256.json').read_text())\nbad=[p for p,h in m.items() if not (r/p).is_file() or hashlib.sha256((r/p).read_bytes()).hexdigest()!=h]\nif bad: raise SystemExit('Integrity failed: '+', '.join(bad))\nprint('Verified '+str(len(m))+' packaged files')\n")
    archive.writestr('RUNNING.md',f"""# Run this candidate

Quality status: **{job['status']}**. This package is a candidate unless job.json says passed.

1. Extract this ZIP into a new directory and run `python3 verify-package.py`.
2. Use the Engine checkout pinned to `{job['profile']['engineSha']}`. The Engine must already have its CLI/runtime dependencies built.
3. From this extracted directory, run:

```sh
node /absolute/path/to/engine/packages/engine/dist/bin/forgeax.mjs project engine use-local /absolute/path/to/engine --root project/game --json
node /absolute/path/to/engine/packages/engine/dist/bin/forgeax.mjs project preview --root project/game --port 19779 --json
```

Open the Preview URL returned by the CLI. Space starts or pauses the camera; H hides or restores the HUD. The scene and recording are included. No workbench server or model request is needed for playback.

A fresh source build can use the same CLI's `project build --root project/game --json` command after binding the pinned Engine.
""")
receipt={'file':output.name,'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'bytes':output.stat().st_size,'qualityStatus':job['status']}
(root/'package-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt))
