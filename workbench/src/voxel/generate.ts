import { join } from "node:path";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { callValidated } from "../contracts";
import { save, read, saveJob, event, runDir } from "../store";
import { compileVoxelScene, voxelFile, type VoxelProgram } from "./program";
import { VOXEL_PROMPT } from "./schema";

/** One frozen voxel program drives geometry, palette, inspection cameras and editable export. */
export async function generateVoxelScene(ctx: any, revision?: { folder: string; runtime: any; review: any; source: VoxelProgram }) {
  const { job, plan, dir, images, signal } = ctx;
  mkdirSync(dir, { recursive: true });
  const sourceFile = job.reuseSceneFrom ? join(runDir(job.reuseSceneFrom), "voxel-program.json") : null;
  if (sourceFile && !existsSync(sourceFile)) throw Error("VOXEL_SOURCE_REQUIRED：来源没有完整体素数据，不能把普通网格称为体素复用");
  const returned = sourceFile && !job.refineScene && !revision ? { value: read(sourceFile) } : await callValidated({
    role: "voxel-scene", modelSettings: job.modelSettings, signal, maxTokens: 18000, images: [...images, ...(revision?.runtime?.images ?? []).slice(0, 5).map((file: string) => ({ path: join(revision!.folder, "runtime", file), mime: "image/png" }))],
    schemaContext: { requirementIds: plan.requirements.map((r: any) => r.id) }, system: VOXEL_PROMPT,
    text: JSON.stringify({ prompt: job.prompt, plan, referenceCount: images.length, ...(revision ? { repair: { previousProgram: revision.source, feedback: revision.review, generatedFramesAfterReferences: true, instructions: "只按真实差距修改体素操作、颜色与机位；原始参考图和需求保持不变。生成画面仅是反馈，不是新的目标。" } } : {}) }),
  }, dir, (program: VoxelProgram) => { compileVoxelScene(program, plan, images.length); return program; });
  const program = returned.value as VoxelProgram, model = compileVoxelScene(program, plan, images.length), root = ctx.root;
  save(join(root, "voxel-program.json"), program); save(join(root, "voxel-metrics.json"), model.metrics);
  writeFileSync(join(root, "scene.vox"), voxelFile(program, model.grid));
  job.voxel = { ...model.metrics, program: "voxel-program.json", editable: "scene.vox", palette: program.palette };
  const generation = join(root, "generation"), materials = join(root, "materials"); mkdirSync(generation, { recursive: true }); mkdirSync(materials, { recursive: true });
  const steps = model.scene.program.templates.map((template, index) => {
    const entity = program.entities[index], folder = join(generation, "assets", template.id); mkdirSync(folder, { recursive: true });
    save(join(folder, "geometry.json"), { version: "asset-geometry-v1", template });
    save(join(folder, "checkpoint.json"), { id: template.id, status: "passed", source: "voxel-grid", triangles: template.parts.reduce((n, p) => n + (p.shape.type === "indexedMesh" ? p.shape.triangles.length : 0), 0) });
    return { id: template.id, label: entity.label, status: "passed" };
  });
  save(join(generation, "checkpoints.json"), { version: "voxel-checkpoints-v1", steps });
  save(join(generation, "layout.json"), model.scene);
  save(join(materials, "texture-registry.json"), {});
  const provenance = { version: "voxel-palette-provenance-v1", source: "model-estimated reference palette", palette: program.palette, referenceImages: job.images.map((image: any) => image.id), measuredColorRecovery: false, note: "体素实体使用声明的纯色表，颜色由参考图估计；没有捏造照片纹理或第三方素材" };
  save(join(materials, "texture-provenance.json"), provenance);
  job.generationProgress = { phase: "体素结构已生成", completed: steps.length, total: steps.length, current: null };
  saveJob(job); event(job, "voxel-generated", `${model.metrics.cells} 个体素、${model.metrics.triangles} 个表面三角形；参考图还原效果等待真实画面验收`);
  return { scene: model.scene, provenance };
}
