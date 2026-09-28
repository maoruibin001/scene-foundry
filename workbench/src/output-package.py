from pathlib import Path
import json,sys,zipfile,hashlib,tempfile,os
root=Path(sys.argv[1]).resolve(); descriptor=json.loads(sys.stdin.read()); best=descriptor['best']; source=(root/best['folder']).resolve()
if not source.is_relative_to(root): raise SystemExit('output outside job')
output=root/('output-'+best['distManifestDigest'][:16]+'.zip')
fd,tmp=tempfile.mkstemp(prefix='.output-',suffix='.zip',dir=root);os.close(fd)
with zipfile.ZipFile(tmp,'w',zipfile.ZIP_DEFLATED,compresslevel=3) as z:
    for name in ['project/game/assets','project/game/dist','project/source','project/evidence','runtime','materials']:
        folder=source/name
        if not folder.is_dir():continue
        for f in folder.rglob('*'):
            if f.is_file() and not f.is_symlink() and f.resolve().is_relative_to(source):z.write(f,str(f.relative_to(source)))
    for name in ['project/game/forge.json','project/game/package.json','project/brief.json','generated-scene.json','quality.json','review.json','spec-report.json']:
        f=source/name
        if f.is_file() and not f.is_symlink():z.write(f,name)
    z.writestr('delivery.json',json.dumps(descriptor,ensure_ascii=False,indent=2))
    z.writestr('使用说明.txt','这是保存的 ForgeaX 场景输出，输出种类：'+best['kind']+'。质量状态：'+best['qualityStatus']+'。\n灰模和部分草稿未完成成品验收；请查看 delivery.json，不得把可运行当作达标。\n使用任务固定的 Engine CLI 运行 project preview --root project/game --port 19779 --json。必要时先执行 project engine use-local <engine目录> --root project/game --json。\n')
    checks={i.filename:hashlib.sha256(z.read(i.filename)).hexdigest() for i in z.infolist()}
    z.writestr('manifest.sha256.json',json.dumps(checks,indent=2))
os.replace(tmp,output)
print(json.dumps({'file':output.name,'bytes':output.stat().st_size}))
