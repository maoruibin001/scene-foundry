import { VOXEL_LIMITS } from "./limits";
import { validateScene, type SceneInput } from "../geometry/scene-contract";
import { compileGeometryProgram, type Part } from "../geometry/program";

export const VOXEL_VERSION = "voxel-scene-v1";
export const VOXEL_GRID_VERSION = "voxel-grid-v2";
export { VOXEL_LIMITS } from "./limits";
type V = [number, number, number];
export type VoxelOperation = { action: "fill" | "erase" | "paint"; shape: "box" | "ellipsoid" | "ramp"; min: V; size: V; palette: string | null; slopeAxis: "x" | "y"; reverse: boolean; overlap?:'reject'|'keep-existing'|'replace' };
export type VoxelEntity = { id: string; label: string; category: string; role: "subject" | "context" | "ground"; requirementIds: string[]; operations: VoxelOperation[] };
export type VoxelProgram = {
  version: typeof VOXEL_VERSION | typeof VOXEL_GRID_VERSION; name: string; size: V; cellSize: number;
  origin?: V; runs?: [number, number, number, number][]; sourceSceneSha256?: string;
  palette: { id: string; color: string }[]; entities: VoxelEntity[];
  cameras: { name: string; referenceIndex: number | null; position: V; target: V; projection: "perspective" | "orthographic"; fov: number; orthographicHeight: number | null }[];
  lighting: SceneInput["lighting"]; assumptions: string[];
};
export type VoxelGrid = { size: V; cellSize: number; colors: Uint8Array; owners: Uint8Array; filled: number; operations: number; composition:{keptCells:number;replacedCells:number} };
function assert(ok: unknown, reason: string): asserts ok { if (!ok) throw Error("VOXEL_CONTRACT: " + reason); }
const integer = (v: any, lo: number, hi: number) => Number.isSafeInteger(v) && v >= lo && v <= hi;
const vector = (v: any, lo: number, hi: number) => Array.isArray(v) && v.length === 3 && v.every(n => integer(n, lo, hi));
const id = (v: any) => typeof v === "string" && /^[a-zA-Z][a-zA-Z0-9_-]{0,48}$/.test(v);
const srgb = (v: number) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
export function paletteColor(hex: string): [number, number, number, number] {
  return [srgb(parseInt(hex.slice(1, 3), 16) / 255), srgb(parseInt(hex.slice(3, 5), 16) / 255), srgb(parseInt(hex.slice(5, 7), 16) / 255), 1];
}

/** Execute integer-grid solids. Cross-entity composition must be explicitly authored. */
export function voxelGrid(program: VoxelProgram): VoxelGrid {
  if(program?.version===VOXEL_GRID_VERSION)return decodedVoxelGrid(program);
  assert(program?.version === VOXEL_VERSION, "体素数据版本无效");
  assert(typeof program.name === "string" && program.name.trim(), "场景名称缺失");
  assert(vector(program.size, 1, VOXEL_LIMITS.dimension), "网格尺寸须为 1–192 的整数");
  const [width, depth, height] = program.size, cells = width * depth * height;
  assert(cells <= VOXEL_LIMITS.gridCells, "网格超过 200 万格上限");
  assert(Number.isFinite(program.cellSize) && program.cellSize >= .02 && program.cellSize <= 1, "体素边长须为 .02–1 米");
  assert(Array.isArray(program.palette) && program.palette.length > 0 && program.palette.length <= VOXEL_LIMITS.palette &&
    program.palette.every(p => id(p.id) && /^#[a-fA-F0-9]{6}$/.test(p.color)) && new Set(program.palette.map(p => p.id)).size === program.palette.length, "颜色表须为 1–64 个唯一英文 ID（英文字母开头、仅字母数字下划线横线、最多49字符）与 #RRGGBB");
  assert(Array.isArray(program.entities) && program.entities.length > 0 && program.entities.length <= VOXEL_LIMITS.entities &&
    program.entities.every(e => id(e.id) && typeof e.label === "string" && e.label.trim()) && new Set(program.entities.map(e => e.id)).size === program.entities.length, "体素实体 ID 无效或数量超限");
  const colors = new Uint8Array(cells), owners = new Uint8Array(cells), palette = new Map(program.palette.map((p, i) => [p.id, i + 1]));
  const paletteHex=program.palette.map(p=>p.color.toLowerCase());
  let work = 0, operations = 0, filled = 0;const composition={keptCells:0,replacedCells:0};
  for (const [index, entity] of program.entities.entries()) {
    const owner = index + 1;
    assert(Array.isArray(entity.operations) && entity.operations.length > 0, "每个实体须有体素构造");
    for (const [operationIndex,op] of entity.operations.entries()) {
      assert(++operations <= VOXEL_LIMITS.operations, "构造操作超过 512 项");
      assert(["fill", "erase", "paint"].includes(op.action) && ["box", "ellipsoid", "ramp"].includes(op.shape), "构造操作类型无效");
      assert(vector(op.min, 0, VOXEL_LIMITS.dimension - 1) && vector(op.size, 1, VOXEL_LIMITS.dimension) && op.min.every((n, axis) => n + op.size[axis] <= program.size[axis]), "操作须在网格内，坐标和尺寸须为整数");
      assert(["x", "y"].includes(op.slopeAxis) && typeof op.reverse === "boolean", "斜坡方向无效");
      const overlap=op.overlap??'reject';assert(['reject','keep-existing','replace'].includes(overlap),'实体组合策略无效');
      const color = op.palette === null ? 0 : palette.get(op.palette);
      assert(op.action === "erase" ? op.palette === null : color, "填充与着色须引用实际颜色，挖空的 palette 须为 null");
      work += op.size[0] * op.size[1] * op.size[2];
      assert(work <= VOXEL_LIMITS.operationCells, "累计操作范围超过 800 万格");
      let shapeCells=0,blockedSubjectCells=0;const blockedBy=new Set<string>();
      for (let z = 0; z < op.size[2]; z++) for (let y = 0; y < op.size[1]; y++) for (let x = 0; x < op.size[0]; x++) {
        if (op.shape === "ellipsoid" && [x, y, z].reduce((sum, n, axis) => sum + ((n + .5) / op.size[axis] * 2 - 1) ** 2, 0) > 1) continue;
        if (op.shape === "ramp") { const axis = op.slopeAxis === "x" ? 0 : 1, n = axis === 0 ? x : y, t = (n + .5) / op.size[axis]; if ((z + .5) / op.size[2] > (op.reverse ? 1 - t : t)) continue; }
        shapeCells++;
        const key = op.min[0] + x + width * (op.min[1] + y + depth * (op.min[2] + z));
        if(owners[key]&&owners[key]!==owner){
          if(op.action!=='fill')continue; // paint/erase address this entity's cells only.
          if(overlap==='keep-existing'){
            composition.keptCells++;
            const other=program.entities[owners[key]-1];
            if(entity.role==='subject'&&other.role!=='ground'&&paletteHex[colors[key]-1]!==paletteHex[color!-1]){blockedSubjectCells++;blockedBy.add(other.id);}
            continue;
          }
          assert(overlap==='replace',`不同实体占用同一格：${entity.id} 第${operationIndex+1}项 fill 与 ${program.entities[owners[key]-1].id} 在 [${op.min[0]+x},${op.min[1]+y},${op.min[2]+z}] 冲突；修正范围或显式选择 keep-existing/replace，不能默默删除其他主体`);
          composition.replacedCells++;
        }
        if (op.action === "erase") { if (owners[key]) { colors[key] = 0; owners[key] = 0; filled--; } }
        else if (op.action === "paint") { if (owners[key]) colors[key] = color!; }
        else { if (!owners[key]) filled++; colors[key] = color!; owners[key] = owner; }
      }
      assert(!(entity.role==='subject'&&op.action==='fill'&&shapeCells>0&&blockedSubjectCells===shapeCells),`主体 ${entity.id} 第${operationIndex+1}项 fill 的 ${shapeCells} 格全部被异色实体 ${[...blockedBy].join(',')} 的已有格挡住；keep-existing 实际没有生成这个部件。修正构造范围或明确使用 replace 保留主体部件，不能仅凭实体底座仍存在判定完整`);
    }
  }
  assert(filled > 0 && filled <= VOXEL_LIMITS.filledCells, "实体体素为空或超过 50 万格");
  const used = new Set(owners); assert(program.entities.every((_, i) => used.has(i + 1)), "存在没有实际体素的实体");
  return { size: program.size, cellSize: program.cellSize, colors, owners, filled, operations,composition };
}

/** Explicit occupied cells from validated geometry; never infer occupancy from entity labels. */
export function decodedVoxelGrid(program:VoxelProgram):VoxelGrid {
 assert(program.version===VOXEL_GRID_VERSION&&vector(program.size,1,VOXEL_LIMITS.dimension),'体素网格版本或尺寸无效');
 const cells=program.size.reduce((a,b)=>a*b,1);
 assert(cells<=VOXEL_LIMITS.gridCells&&Number.isFinite(program.cellSize)&&program.cellSize>0&&program.cellSize<=1,'体素网格范围或格尺寸超限');
 assert(program.origin?.length===3&&program.origin.every(n=>Number.isFinite(n)&&Math.abs(n)<=1000),'体素网格原点无效');
 assert(/^[a-f0-9]{64}$/.test(program.sourceSceneSha256??''),'体素化缺少冻结几何来源');
 assert(program.palette.length>0&&program.palette.length<=VOXEL_LIMITS.palette&&new Set(program.palette.map(p=>p.id)).size===program.palette.length&&program.palette.every(p=>id(p.id)&&/^#[a-fA-F0-9]{6}$/.test(p.color)),'体素颜色表无效');
 assert(program.entities.length>0&&program.entities.length<=VOXEL_LIMITS.entities&&new Set(program.entities.map(e=>e.id)).size===program.entities.length&&program.entities.every(e=>/^[A-Za-z][A-Za-z0-9_-]{0,55}$/.test(e.id)&&['subject','context','ground'].includes(e.role)),'体素实体身份无效');
 assert(Array.isArray(program.runs)&&program.runs.length>0&&program.runs.length<=VOXEL_LIMITS.filledCells,'体素格记录为空或超限');
 const colors=new Uint8Array(cells),owners=new Uint8Array(cells),counts=new Uint32Array(program.entities.length+1);let filled=0,end=0;
 for(const run of program.runs){assert(Array.isArray(run)&&run.length===4,'体素格编码无效');const [start,length,owner,color]=run;
  assert(integer(start,end,cells-1)&&integer(length,1,cells-start)&&integer(owner,1,program.entities.length)&&integer(color,1,program.palette.length),'体素格越界、重叠或引用无效');
  filled+=length;assert(filled<=VOXEL_LIMITS.filledCells,'占用格超过50万');end=start+length;owners.fill(owner,start,end);colors.fill(color,start,end);counts[owner]+=length;
 }
 assert(program.entities.every((_,i)=>counts[i+1]>0),'体素化丢失了实体；不能交付只保留标签的场景');
 return {size:program.size,cellSize:program.cellSize,colors,owners,filled,operations:program.runs.length,composition:{keptCells:0,replacedCells:0}};
}

/** Merge only equal-color, equal-owner cells; the result exactly preserves occupied volume. */
export function voxelBoxes(grid: VoxelGrid) {
  const [width, depth, height] = grid.size, visited = new Uint8Array(grid.colors.length);
  const boxes: { owner: number; color: number; min: V; size: V }[] = [], counts = new Map<number, number>();
  const key = (x: number, y: number, z: number) => x + width * (y + depth * z);
  for (let z = 0; z < height; z++) for (let y = 0; y < depth; y++) for (let x = 0; x < width; x++) {
    const start = key(x, y, z), color = grid.colors[start], owner = grid.owners[start];
    if (!color || visited[start]) continue;
    const match = (a: number, b: number, c: number) => { const i = key(a, b, c); return !visited[i] && grid.colors[i] === color && grid.owners[i] === owner; };
    let w = 1, d = 1, h = 1;
    while (x + w < width && match(x + w, y, z)) w++;
    while (y + d < depth && Array.from({ length: w }, (_, a) => match(x + a, y + d, z)).every(Boolean)) d++;
    outer: while (z + h < height) {
      for (let b = 0; b < d; b++) for (let a = 0; a < w; a++) if (!match(x + a, y + b, z + h)) break outer;
      h++;
    }
    for (let c = 0; c < h; c++) for (let b = 0; b < d; b++) for (let a = 0; a < w; a++) visited[key(x + a, y + b, z + c)] = 1;
    boxes.push({ owner, color, min: [x, y, z], size: [w, d, h] }); counts.set(owner, (counts.get(owner) ?? 0) + 1);
    assert(boxes.length <= VOXEL_LIMITS.boxes && counts.get(owner)! <= VOXEL_LIMITS.boxesPerEntity, "合并后几何超过预算；须简化冗余色块，保留主要轮廓与空隙");
  }
  return boxes;
}

export function compileVoxelScene(program: VoxelProgram, plan: any, referenceCount: number) {
  const grid = voxelGrid(program), surfaces = voxelSurfaces(grid), unit = program.cellSize;
  const origin=program.version===VOXEL_GRID_VERSION?program.origin!:[0,0,0];
  const materials = program.palette.map(p => ({ id: p.id, color: paletteColor(p.color), roughness: 1, metallic: 0, textureId: null }));
  const templates = program.entities.map((entity, index) => ({ id: "tpl_" + entity.id, parts: surfaces.filter(surface => surface.owner === index + 1).map((surface): Part => ({
    id: "color_" + surface.color, material: program.palette[surface.color - 1].id,
    position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
    shape: { type: "indexedMesh", positions: surface.positions.map(p => p.map((n,k) => origin[k]+n * unit) as V), triangles: surface.triangles }, smoothAngle: 0,
  })) }));
  const scene: SceneInput = {
    version: "scene-v1", program: { version: "geometry-v1", name: program.name, materials, templates,
      instances: program.entities.map(e => ({ id: e.id, label: e.label, template: "tpl_" + e.id, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], requirementIds: e.requirementIds })) },
    entities: program.entities.map(e => ({ instanceId: e.id, role: e.role, category: e.category })),
    cameras: program.cameras.map(c => {
      assert(["perspective", "orthographic"].includes(c.projection), "相机投影类型无效");
      assert(c.projection !== "orthographic" || Number.isFinite(c.orthographicHeight) && c.orthographicHeight! > 0 && c.orthographicHeight! <= 500, "正交相机须有有效的垂直覆盖格数");
      return program.version===VOXEL_GRID_VERSION?{...c}:{ ...c, position: c.position.map(n => n * unit), target: c.target.map(n => n * unit), orthographicHeight: c.orthographicHeight === null ? null : c.orthographicHeight * unit };
    }),
    lighting: program.lighting, textures: [], textureReuse: [], assumptions: program.assumptions,
  };
  validateScene(scene, plan, referenceCount);
  const compiled = compileGeometryProgram(scene.program);
  return { scene, grid, metrics: { version: "voxel-metrics-v1", cells: grid.filled, gridSize: grid.size, cellSize: unit, operations: grid.operations,composition:grid.composition, mergedSurfaceQuads: surfaces.reduce((n, s) => n + s.triangles.length / 2, 0), triangles: compiled.triangles, entities: program.entities.length, palette: materials.length, representation: "integer-grid voxels with hidden-face removal and equal-color surface merging" } };
}

/** Greedy exposed-face meshing, grouped by semantic entity and palette. No internal faces. */
export function voxelSurfaces(grid: VoxelGrid) {
  const groups = new Map<number, { owner: number; color: number; positions: V[]; triangles: [number, number, number][] }>();
  const dimensions = grid.size;
  const key = (p: number[]) => p[0] + dimensions[0] * (p[1] + dimensions[1] * p[2]);
  const inside = (p: number[]) => p.every((n, axis) => n >= 0 && n < dimensions[axis]);
  let triangles = 0;
  for (let axis = 0; axis < 3; axis++) {
    const u = (axis + 1) % 3, v = (axis + 2) % 3, width = dimensions[u], height = dimensions[v];
    for (let plane = 0; plane <= dimensions[axis]; plane++) {
      const mask = new Int32Array(width * height);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const a = [0, 0, 0], b = [0, 0, 0]; a[axis] = plane - 1; b[axis] = plane; a[u] = b[u] = x; a[v] = b[v] = y;
        const ai = inside(a) ? key(a) : -1, bi = inside(b) ? key(b) : -1, ac = ai < 0 ? 0 : grid.colors[ai], bc = bi < 0 ? 0 : grid.colors[bi];
        if (Boolean(ac) === Boolean(bc)) continue;
        const i = ac ? ai : bi, code = grid.owners[i] * 256 + grid.colors[i]; mask[x + width * y] = ac ? code : -code;
      }
      for (let y = 0; y < height; y++) for (let x = 0; x < width;) {
        const code = mask[x + width * y]; if (!code) { x++; continue; }
        let w = 1, h = 1; while (x + w < width && mask[x + w + width * y] === code) w++;
        outer: while (y + h < height) { for (let a = 0; a < w; a++) if (mask[x + a + width * (y + h)] !== code) break outer; h++; }
        const identity = Math.abs(code), owner = Math.floor(identity / 256), color = identity % 256;
        let group = groups.get(identity); if (!group) { group = { owner, color, positions: [], triangles: [] }; groups.set(identity, group); }
        const origin: V = [0, 0, 0]; origin[axis] = plane; origin[u] = x; origin[v] = y;
        const a = [...origin] as V, b = [...origin] as V, c = [...origin] as V, d = [...origin] as V;
        b[u] += w; c[u] += w; c[v] += h; d[v] += h;
        const points = code > 0 ? [a, b, c, d] : [d, c, b, a], n = group.positions.length;
        group.positions.push(...points); group.triangles.push([n, n + 1, n + 2], [n, n + 2, n + 3]); triangles += 2;
        assert(triangles <= 250000 && groups.size <= 2048, "体素表面超过原有网格预算");
        for (let row = 0; row < h; row++) for (let col = 0; col < w; col++) mask[x + col + width * (y + row)] = 0;
        x += w;
      }
    }
  }
  assert(groups.size > 0, "体素没有可见表面");
  return [...groups.values()];
}

/** MagicaVoxel v150 SIZE/XYZI/RGBA. Source colors stay sRGB; Engine colors use linear RGB. */
export function voxelFile(program: VoxelProgram, grid: VoxelGrid) {
  const chunk = (name: string, bytes: Buffer) => { const h = Buffer.alloc(12); h.write(name, 0, "ascii"); h.writeUInt32LE(bytes.length, 4); return Buffer.concat([h, bytes]); };
  const size = Buffer.alloc(12); grid.size.forEach((n, axis) => size.writeUInt32LE(n, axis * 4));
  const cells = Buffer.alloc(4 + grid.filled * 4); cells.writeUInt32LE(grid.filled, 0);
  let at = 4; const [w, d, h] = grid.size;
  for (let z = 0; z < h; z++) for (let y = 0; y < d; y++) for (let x = 0; x < w; x++) {
    const color = grid.colors[x + w * (y + d * z)]; if (!color) continue;
    cells.set([x, y, z, color], at); at += 4;
  }
  const rgba = Buffer.alloc(1024); for (const [i, p] of program.palette.entries()) rgba.set([parseInt(p.color.slice(1, 3), 16), parseInt(p.color.slice(3, 5), 16), parseInt(p.color.slice(5, 7), 16), 255], i * 4);
  const children = Buffer.concat([chunk("SIZE", size), chunk("XYZI", cells), chunk("RGBA", rgba)]), main = Buffer.alloc(12), header = Buffer.alloc(8);
  header.write("VOX ", 0, "ascii"); header.writeUInt32LE(150, 4); main.write("MAIN", 0, "ascii"); main.writeUInt32LE(children.length, 8);
  return Buffer.concat([header, main, children]);
}
