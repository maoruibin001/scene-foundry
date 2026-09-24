from pathlib import Path
import hashlib, json, sys, zipfile

root = Path(sys.argv[1]).resolve()
manifest = json.loads((root / 'manifest.json').read_text())
if manifest['kind'] != 'snapshot':
    raise SystemExit('Historical source unavailable')
for name, expected in manifest['files'].items():
    if hashlib.sha256((root / 'snapshot' / name).read_bytes()).hexdigest() != expected:
        raise SystemExit('Snapshot integrity failed: ' + name)
output = root / 'pipeline-version.zip'
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
    for name in manifest['files']:
        archive.write(root / 'snapshot' / name, name)
    archive.write(root / 'manifest.json', 'pipeline-manifest.json')
    if (root / 'release.json').exists():
        archive.write(root / 'release.json', 'pipeline-release.json')
    archive.writestr('verify-snapshot.py', '''from pathlib import Path
import hashlib,json
r=Path(__file__).resolve().parent
m=json.loads((r/'pipeline-manifest.json').read_text())
bad=[p for p,h in m['files'].items() if not (r/p).is_file() or hashlib.sha256((r/p).read_bytes()).hexdigest()!=h]
if bad: raise SystemExit('Integrity failed: '+', '.join(bad))
print('Verified '+str(len(m['files']))+' snapshot files')
''')
    archive.writestr('RESTORE.md', f'''# Restore {manifest['candidateLabel']}

Immutable pipeline ID: `{manifest['id']}`. Check pipeline-release.json for stable publication; a candidate is not a stable release.

1. Extract to a new directory, leaving the current workbench intact. Run `python3 verify-snapshot.py`.
2. Place the prepared Engine checkout at `engine/`, SHA `{manifest['configuration']['engineSha']}`, and scene-generator checkout at `scene-generator/`, SHA `{manifest['configuration']['generatorSha']}`. Install/build their dependencies as required by each repository. Dependencies and provider availability remain external prerequisites.
3. In `workbench/`, run `bun install`. Restore the non-secret defaults from pipeline-manifest.json configuration with environment variables PIPELINE_PROVIDER, PIPELINE_MODEL, PIPELINE_JUDGE_MODEL, PIPELINE_CODEX_EFFORT, and choose PIPELINE_MAX_CALLS explicitly. Configure credentials separately through the existing provider login; no credentials are in this archive.
4. Choose an unused PORT, then run `bun src/server.ts`. Generated results persist in workbench/data/runs and version snapshots in workbench/data/versions. Those growing result directories are retained by the original workbench and are not copied into this source-only archive. Download individual scene packages separately.

Later changes create a new candidate, preserving the old manifest and files. This archive preserves source/configuration; generative models may produce different results on rerun.
''')
print(json.dumps({'file': str(output), 'bytes': output.stat().st_size, 'sha256': hashlib.sha256(output.read_bytes()).hexdigest()}))
