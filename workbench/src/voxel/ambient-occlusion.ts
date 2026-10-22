/**
 * Camp 384ac676 (2026-10-22) failed S06/S13 in all three rounds on a side window read as a solid pale board: the cross
 * frame and its four recessed cells were all voxelized, but each cell is 1-2 cells wide behind a 3-cell-deep reveal,
 * and every orthographic view shifts 0.25-0.6 m across that depth, so only the frame-coloured reveal faces show.
 * Same-colour reveals also flattened the log-wall grooves. Screen-space ambient occlusion darkens such crevices on the
 * fixed Engine camera; it adds no geometry, light or material, and applies only to orthographic (voxel) scenes.
 */
export const VOXEL_AMBIENT_OCCLUSION = { version: 'voxel-ambient-occlusion-v1', radius: .3, intensity: 1.6, directLightingStrength: .5 } as const;

export function bindVoxelAmbientOcclusion(world: string) {
  const renderImport = /import\s*\{([^}]+)\}\s*from\s*(['"])@forgeax\/engine\/render\2/, components = 'sceneComponents:[', camera = "camera:{components:{Name:{value:'Recording camera'},";
  if (!renderImport.test(world) || world.split(components).length !== 2 || world.split(camera).length !== 2) throw Error('固定 Engine 相机模板变化，未应用体素环境光遮蔽');
  const { radius, intensity, directLightingStrength } = VOXEL_AMBIENT_OCCLUSION;
  return world.replace(renderImport, (_match, symbols, quote) => `import {${symbols.trimEnd()}, AmbientOcclusion } from ${quote}@forgeax/engine/render${quote}`)
    .replace(components, components + 'AmbientOcclusion,')
    .replace(camera, camera + `AmbientOcclusion:${JSON.stringify({ radius, intensity, directLightingStrength }).replace(/"/g, '')},`);
}
