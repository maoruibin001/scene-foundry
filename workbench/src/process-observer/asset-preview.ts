import { compileGeometryProgram, type GeometryProgram } from "../geometry/program";

// A read-only shape projection of the saved geometry. Textures are shown separately
// in the inventory; this deliberately does not claim to be an Engine render.
export function assetPreviewSvg(template: any, materials: any[] = []) {
  const used = new Set((template?.parts ?? []).map((part: any) => part.material));
  const known = materials.filter((material) => used.has(material.id));
  const missing = [...used].filter((id) => !known.some((material) => material.id === id));
  const neutral = (id: string) => ({
    id, color: [0.55, 0.65, 0.59, 1], roughness: 1, metallic: 0, textureId: null,
  });
  const program: GeometryProgram = {
    version: "geometry-v1",
    name: "资产几何预览",
    templates: [template],
    materials: [...known.map((material) => ({ ...material, textureId: null })), ...missing.map(neutral)],
    instances: [{
      id: "preview", label: "资产", template: template.id, requirementIds: [],
      position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
    }],
  };
  const compiled = compileGeometryProgram(program);
  const project = ([x, y, z]: number[]) => [
    (x - y) * 0.7071068,
    (x + y) * 0.4082483 - z * 0.8164966,
    (x + y + z) * 0.5773503,
  ];
  const min = [Infinity, Infinity], max = [-Infinity, -Infinity];
  const faces: { points: number[][]; depth: number; color: number[] }[] = [];
  for (const mesh of compiled.meshes) {
    const { positions, indices, material } = mesh.geometry;
    const base = material.surface.baseColor as number[];
    const stride = Math.max(1, Math.ceil(indices.length / 3 / 3500));
    for (let i = 0; i < indices.length; i += 3 * stride) {
      const points = [0, 1, 2].map((offset) => project(positions.slice(indices[i + offset] * 3, indices[i + offset] * 3 + 3)));
      if (points.some((p) => p.some((n) => !Number.isFinite(n)))) continue;
      for (const p of points) for (let k = 0; k < 2; k++) {
        min[k] = Math.min(min[k], p[k]);
        max[k] = Math.max(max[k], p[k]);
      }
      const cross = (points[1][0] - points[0][0]) * (points[2][1] - points[0][1]) -
        (points[1][1] - points[0][1]) * (points[2][0] - points[0][0]);
      const shade = cross < 0 ? 0.94 : 0.7;
      faces.push({ points, depth: points.reduce((sum, p) => sum + p[2], 0) / 3,
        color: base.slice(0, 3).map((value) => Math.round(255 * Math.pow(Math.max(0, Math.min(1, value)), 1 / 2.2) * shade)) });
    }
  }
  if (!faces.length) throw Error("资产没有可预览的几何面");
  const span = Math.max(max[0] - min[0], max[1] - min[1], 0.01);
  const scale = 284 / span;
  const center = [(max[0] + min[0]) / 2, (max[1] + min[1]) / 2];
  const xy = (p: number[]) => `${(160 + (p[0] - center[0]) * scale).toFixed(2)},${(160 + (p[1] - center[1]) * scale).toFixed(2)}`;
  faces.sort((a, b) => a.depth - b.depth);
  const polygons = faces.map((face) =>
    `<polygon points="${face.points.map(xy).join(" ")}" fill="rgb(${face.color.join(",")})" stroke="#294137" stroke-opacity=".09" stroke-width=".45"/>`,
  ).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" role="img" aria-label="已保存资产几何的等轴投影"><rect width="320" height="320" fill="#f1f5ef"/>${polygons}</svg>`;
}
