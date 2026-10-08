export type SceneKind = "scene" | "voxel";
export function sceneKind(value: unknown): SceneKind {
  if (value === undefined || value === null || value === "scene") return "scene";
  if (value === "voxel") return "voxel";
  throw Error("未知场景类型");
}
