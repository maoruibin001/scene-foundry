// usage: bun render_gt.ts <scene.json> <out dir> — render a ground-truth scene through the repair-preview path (export, build, capture)
const REPO=process.env.SF_REPO!;const {renderRepairPreview}=await import(REPO+'/workbench/src/geometry/repair-engine-preview.ts');
const [p,out]=process.argv.slice(2);const scene=await Bun.file(p).json();
await renderRepairPreview(scene,[],[],out,new AbortController().signal,{preJudge:false});console.log('rendered',out);
