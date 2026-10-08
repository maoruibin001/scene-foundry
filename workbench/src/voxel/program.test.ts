import { test, expect } from "bun:test";
import { compileGeometryProgram } from "../geometry/program";
import { voxelGrid, voxelSurfaces, compileVoxelScene, voxelFile, paletteColor, type VoxelProgram, type VoxelOperation } from "./program";
import { sceneKind } from "../scene-kind";
const operation = (min: [number, number, number], size: [number, number, number], action: VoxelOperation["action"] = "fill"): VoxelOperation => ({ min, size, action, palette: action === "erase" ? null : "red", shape: "box", slopeAxis: "x", reverse: false });
const plan = { requirements: [{ id: "R1", critical: true, count: 1 }] };
function input(): VoxelProgram {
  return { version: "voxel-scene-v1", name: "体素实体", size: [8, 8, 8], cellSize: .25, palette: [{ id: "red", color: "#ff4020" }],
    entities: [{ id: "subject", label: "体素主体", category: "建筑", role: "subject", requirementIds: ["R1"], operations: [operation([1, 1, 1], [3, 4, 5])] }],
    cameras: [{ name: "原图机位", referenceIndex: 1, position: [-12, -20, 16], target: [4, 4, 3], projection: "orthographic", orthographicHeight: 12, fov: .785 }, { name: "后侧观察", referenceIndex: null, position: [20, 24, 16], target: [4, 4, 3], projection: "orthographic", orthographicHeight: 12, fov: .785 }],
    lighting: { direction: [-.4, -.6, -.8], color: [1, 1, 1], intensity: 2, ambientColor: [1, 1, 1], ambientIntensity: .7, points: [] }, assumptions: ["不可见背面属于推断"] };
}
test("solid voxels collapse to six outward faces, no interior geometry", () => {
  const p = input(), grid = voxelGrid(p), surfaces = voxelSurfaces(grid), model = compileVoxelScene(p, plan, 1);
  expect(grid.filled).toBe(60); expect(surfaces).toHaveLength(1); expect(surfaces[0].triangles).toHaveLength(12); expect(model.metrics.triangles).toBe(12);
  expect(model.scene.cameras[0].position).toEqual([-3, -5, 4]); expect((model.scene.cameras[0] as any).orthographicHeight).toBe(3);
  const { meshes } = compileGeometryProgram(model.scene.program), g = meshes[0].geometry;
  for (let i = 0; i < g.indices.length; i += 3) {
    const a = g.indices[i] * 3, center = [.625, .75, .875];
    const outward = [0, 1, 2].reduce((sum, axis) => sum + (g.positions[a + axis] - center[axis]) * g.normals[a + axis], 0);
    expect(outward).toBeGreaterThan(0);
  }
});
test("carving preserves a true passage instead of a painted door", () => {
  const p = input(); p.entities[0].operations = [operation([1, 1, 1], [6, 4, 6]), operation([2, 1, 1], [4, 4, 4], "erase")];
  const g = voxelGrid(p); expect(g.filled).toBe(80);
  for (let y = 1; y < 5; y++) expect(g.colors[3 + 8 * (y + 8 * 2)]).toBe(0);
  expect(voxelSurfaces(g)[0].triangles.length).toBeGreaterThan(12);
});
test("palette repaint changes existing cells without inventing geometry", () => {
  const p = input(); p.palette.push({ id: "blue", color: "#1040ff" });
  p.entities[0].operations.push({ ...operation([1, 1, 1], [3, 1, 5], "paint"), palette: "blue" });
  const g = voxelGrid(p); expect(g.filled).toBe(60); expect(new Set(g.colors)).toEqual(new Set([0, 1, 2])); expect(voxelSurfaces(g)).toHaveLength(2);
});
test("a shared opaque boundary has no internal face even across entities", () => {
  const p = input(); p.entities[0].operations = [operation([1, 1, 1], [1, 1, 1])];
  p.entities.push({ ...p.entities[0], id: "second", requirementIds: [], operations: [operation([2, 1, 1], [1, 1, 1])] });
  expect(voxelSurfaces(voxelGrid(p)).reduce((n, group) => n + group.triangles.length, 0)).toBe(20);
});
test("integer bounds, palette IDs and entity collisions fail before exporting", () => {
  const fraction = input(); fraction.entities[0].operations[0].min[0] = .5; expect(() => voxelGrid(fraction)).toThrow("整数");
  const outside = input(); outside.entities[0].operations[0].size[0] = 12; expect(() => voxelGrid(outside)).toThrow("网格内");
  const palette = input(); palette.entities[0].operations[0].palette = "invented"; expect(() => voxelGrid(palette)).toThrow("实际颜色");
  const overlap = input(); overlap.entities.push({ ...overlap.entities[0], id: "second" }); expect(() => voxelGrid(overlap)).toThrow("同一格");
});
test("critical requirements and exact counts remain enforced", () => {
  const p = input(); p.entities[0].requirementIds = []; expect(() => compileVoxelScene(p, plan, 1)).toThrow("关键需求");
  p.entities[0].requirementIds = ["R1"]; expect(() => compileVoxelScene(p, { requirements: [{ id: "R1", critical: true, count: 2 }] }, 1)).toThrow("明确数量");
});
test('solid composition is explicit, retains occupied volume and ownership; paint/erase never alter other entities',()=>{
 const p=input();p.entities[0].operations=[operation([1,1,1],[2,2,2])];p.entities.push({...p.entities[0],id:'second',requirementIds:[],operations:[{...operation([2,1,1],[2,2,2]),overlap:'keep-existing'}]});
 const combined=voxelGrid(p);expect(combined.filled).toBe(12);expect(combined.composition.keptCells).toBe(4);expect(combined.owners[2+8*(1+8)]).toBe(1);expect(combined.owners[3+8*(1+8)]).toBe(2);
 p.entities[1].operations[0].overlap='replace';const replaced=voxelGrid(p);expect(replaced.filled).toBe(12);expect(replaced.composition.replacedCells).toBe(4);expect(replaced.owners[2+8*(1+8)]).toBe(2);
 p.entities[1].operations.push(operation([1,1,1],[3,2,1],'erase'));const carved=voxelGrid(p);expect(carved.filled).toBe(8);expect(carved.owners[1+8*(1+8)]).toBe(1);
 const hidden=input();hidden.entities.push({...hidden.entities[0],id:'covers',operations:[{...hidden.entities[0].operations[0],overlap:'replace'}]});expect(()=>voxelGrid(hidden)).toThrow('没有实际体素');
});
test("ellipsoids and stair ramps remain occupied integer cells", () => {
  const p = input(); p.entities[0].operations = [{ ...operation([1, 1, 1], [6, 6, 6]), shape: "ellipsoid" }]; const round = voxelGrid(p); expect(round.filled).toBeLessThan(216); expect(round.filled).toBeGreaterThan(100);
  p.entities[0].operations = [{ ...operation([1, 1, 1], [6, 4, 6]), shape: "ramp" }]; const ramp = voxelGrid(p); expect(ramp.colors[1 + 8 * (2 + 8 * 5)]).toBe(0); expect(ramp.colors[6 + 8 * (2 + 8 * 5)]).toBe(1);
});
test("VOX binary independently round-trips coordinates and source palette bytes", () => {
  const p = input(), grid = voxelGrid(p), data = voxelFile(p, grid);
  expect(data.subarray(0, 4).toString()).toBe("VOX "); expect(data.readUInt32LE(4)).toBe(150); expect(data.subarray(8, 12).toString()).toBe("MAIN"); expect(data.readUInt32LE(16)).toBe(data.length - 20);
  let offset = 20; const chunks = new Map<string, Buffer>();
  while (offset < data.length) { const name = data.subarray(offset, offset + 4).toString(), bytes = data.readUInt32LE(offset + 4); chunks.set(name, data.subarray(offset + 12, offset + 12 + bytes)); offset += 12 + bytes; }
  expect([...chunks.keys()]).toEqual(["SIZE", "XYZI", "RGBA"]); expect(chunks.get("SIZE")!.readUInt32LE(0)).toBe(8);
  const xyzi = chunks.get("XYZI")!; expect(xyzi.readUInt32LE(0)).toBe(60); expect(xyzi.length).toBe(244);
  for (let i = 4; i < xyzi.length; i += 4) expect(grid.colors[xyzi[i] + 8 * (xyzi[i + 1] + 8 * xyzi[i + 2])]).toBe(xyzi[i + 3]);
  expect([...chunks.get("RGBA")!.subarray(0, 4)]).toEqual([255, 64, 32, 255]); expect(paletteColor("#808080")[0]).toBeCloseTo(.21586, 4);
});
test("legacy scene selection remains the default", () => { expect(sceneKind(undefined)).toBe("scene"); expect(sceneKind("scene")).toBe("scene"); expect(sceneKind("voxel")).toBe("voxel"); expect(() => sceneKind("other")).toThrow(); });
