"""Evidence shared by full-project and selected-output downloads. Never mix candidate reports."""
from pathlib import Path
import json,hashlib
SPEC_FILES=['scene-spec.json','source-scene-spec.json','spec-export.json','spec-gate.json','style-review.json','spec-owner-approval.json']
def write_spec_evidence(archive,root,source,script):
    job=json.loads((root/'job.json').read_text())
    references=(job.get('images') or ([job['image']] if job.get('image') else []))+(job.get('styleImages') or [])
    archive.writestr('input/style-references.json',json.dumps(job.get('styleImages',[]),ensure_ascii=False,indent=2))
    seen=set()
    for image in references:
        reference=root.parent.parent/'uploads'/image['file']
        if not reference.is_file() or reference.is_symlink(): raise SystemExit('reference image missing')
        reference.resolve().relative_to((root.parent.parent/'uploads').resolve())
        if reference.name in seen: continue
        seen.add(reference.name);archive.write(reference,'input/'+reference.name)
    for name in SPEC_FILES:
        file=source/name
        if file.is_file() and not file.is_symlink(): archive.write(file,name)
    for name in ['parameter-repair','visual-reviews']:
        for file in sorted((source/name).rglob('*.json')):
            if file.is_file() and not file.is_symlink() and file.resolve().is_relative_to(source): archive.write(file,file.relative_to(source))
    provenance=source/'parameter-repair/parameter-resolution.json'
    if provenance.is_file():
        origin=json.loads(provenance.read_text()).get('sourceCallDir')
        if origin:
            prior=Path(origin).resolve()
            if prior.is_relative_to(root.parent.resolve()) and prior.is_dir() and prior!=provenance.parent.resolve():
                for file in sorted(prior.glob('*.json')):
                    if file.is_file() and not file.is_symlink():archive.write(file,'lineage/parameter-call/'+file.name)
    if job.get('specJob'):
        archive.writestr('input/spec-lineage.json',json.dumps({k:job.get(k) for k in ['id','sourceJobId','retryRoot','executionRecoveryRoot','specId','nodeModels','normalizationTemplate','createdAt','pipelineVersion']},ensure_ascii=False,indent=2))
    archive.writestr('packaging.json',json.dumps({'version':'spec-evidence-v1','packagerSha256':hashlib.sha256(script.read_bytes()).hexdigest(),'evidenceHelperSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'producerVersion':job.get('pipelineVersion'),'distManifestDigest':job.get('runtime',{}).get('distManifestDigest')},indent=2))
