import { mergedVoxelBoxes, VOXEL_GRID_VERSION, type VoxelGrid, type VoxelProgram, type voxelSurfaces } from '../voxel/program';

export type Vec3 = [number, number, number];
export type Bounds = { min: Vec3; max: Vec3 };
export type Placement = { pivotSourceMeters: Vec3; worldAnchorEngine: Vec3 };
export type WetBinding = { partId: string; materialId: string; hostMaterialKey: string };

export function worldPoint(point: Vec3, placement: Placement): Vec3 {
  const [x, y, z] = point;
  const [px, py, pz] = placement.pivotSourceMeters;
  const [ax, ay, az] = placement.worldAnchorEngine;
  return [x - px + ax, z - pz + ay, -(y - py) + az];
}

export function worldBounds(bounds: Bounds, placement: Placement): Bounds {
  const a = worldPoint(bounds.min, placement), b = worldPoint(bounds.max, placement);
  return { min: [a[0], a[1], b[2]], max: [b[0], b[1], a[2]] };
}

export function voxelDerivatives(
  program: VoxelProgram,
  grid: VoxelGrid,
  surfaces: ReturnType<typeof voxelSurfaces>,
  placement: Placement,
  colliderLimit: number,
  coverParts: readonly string[],
) {
  const origin = program.version === VOXEL_GRID_VERSION ? program.origin! : [0, 0, 0];
  const toSource = (x: number, y: number, z: number): Vec3 => [
    origin[0] + x * grid.cellSize,
    origin[1] + y * grid.cellSize,
    origin[2] + z * grid.cellSize,
  ];
  const colliders: { partId: string; bounds: Bounds }[] = [];
  for (const {owner, min: [x, y, z], size: [w, d, h]} of mergedVoxelBoxes(grid, false)) {
    if (colliders.length === colliderLimit) throw Error(`Voxel collision box limit exceeded (${colliderLimit}); simplify the source or set a host-supported limit.`);
    colliders.push({
      partId: program.entities[owner - 1].id,
      bounds: worldBounds({min: toSource(x, y, z), max: toSource(x + w, y + d, z + h)}, placement),
    });
  }

  // Use the same exposed quads that become render meshes. Hosts resolve
  // the highest applicable rectangle for vertical rain at their sample point.
  const cover = new Set(coverParts);
  const rainCover: {partId: string; materialId: string; bounds: Bounds}[] = [];
  for (const {owner, color, positions} of surfaces) {
    const partId = program.entities[owner - 1].id;
    if (!cover.has(partId)) continue;
    for (let i = 0; i < positions.length; i += 4) {
      const a = positions[i], b = positions[i + 1], c = positions[i + 2];
      if (a[2] !== b[2] || a[2] !== c[2]) continue;
      const normalZ = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (normalZ <= 0) continue;
      rainCover.push({
        partId,
        materialId: program.palette[color - 1].id,
        bounds: worldBounds({min: toSource(...a), max: toSource(...c)}, placement),
      });
    }
  }
  return { cellSizeMeters: grid.cellSize, occupiedCells: grid.filled, colliders, rainCover };
}
