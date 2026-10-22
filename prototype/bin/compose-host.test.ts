import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { composeHost } from './compose-host';

const engine = resolve(import.meta.dirname, '../../engine');
const pinned = existsSync(join(engine, 'packages/engine/dist/facades/pack/guid.mjs'));
function game() {
  const root = mkdtempSync(join(tmpdir(), 'compose-host-')), assets = join(root, 'assets');mkdirSync(assets);
  writeFileSync(join(assets, 'reflection-components.plugin.ts'), "export default {name:'scene/reflection-components',inject:['world'],apply(ctx){}} satisfies Plugin;");
  writeFileSync(join(assets, 'camera.plugin.ts'), "export default {name:'scene/camera',inject:['world','gameHost'],apply(ctx){\n const root=ctx.gameHost.defaultSceneRoot;\n}} satisfies Plugin;");
  writeFileSync(join(assets, 'ui.plugin.ts'), "export default {name:'scene/ui',inject:['gameHost'],apply(ctx){}} satisfies Plugin;");
  writeFileSync(join(root, 'forge.json'), JSON.stringify({ id: 'scene-x', name: '场景', schemaVersion: '2.0.0', defaultScene: 'a87e5649-45ce-573f-85a4-0e0cf565b71c', plugins: [
    { id: 'reflection-components', name: './assets/reflection-components.plugin.ts', realm: 'engine', inject: [] },
    { id: 'camera', name: './assets/camera.plugin.ts', realm: 'engine', inject: ['world', 'gameHost'] },
    { id: 'ui', name: './assets/ui.plugin.ts', realm: 'frontend', inject: ['gameHost'] }] }));
  return root;
}

test.skipIf(!pinned)('a schema-2 plugin list becomes schema-3 roots with a scene owner that mounts the camera', async () => {
  const root = game(), roots = await composeHost(root, engine);
  const cfg = JSON.parse(readFileSync(join(root, 'forge.json'), 'utf8'));
  expect(cfg).toEqual({ id: 'scene-x', name: '场景', schemaVersion: '3.0.0', assetRoots: ['assets'], roots });
  expect(Object.keys(roots)).toEqual(['engine', 'frontend']);
  const camera = readFileSync(join(root, 'assets/camera.plugin.ts'), 'utf8');
  expect(camera).toContain("export const camera={name:'scene/camera',inject:['world','gameHost','gameScene']");
  expect(camera).toContain('const root=ctx.gameScene.root;');expect(camera).not.toContain('defaultSceneRoot');
  const pack = readFileSync(join(root, 'assets/host.pack.ts'), 'utf8'), entries = JSON.parse(pack.slice(pack.indexOf('ok(') + 3, pack.lastIndexOf(')})')));
  // Vocabulary bootstrap mounts before the scene owner; the camera mounts inside it, after gameScene exists.
  expect(entries['plugin/engine'].config.children.length).toBe(2);
  expect(entries['plugin/scene'].config).toEqual({ scene: { $asset: 'a87e5649-45ce-573f-85a4-0e0cf565b71c' }, children: [{ $asset: expect.any(String) }] });
  expect(entries['plugin/ui'].module).toEqual({ specifier: './ui.plugin.ts', export: 'ui' });
  expect(entries['plugin/reflection-components'].module.export).toBe('reflectionComponents');
  // A composed project is left alone.
  expect(await composeHost(root, engine)).toEqual(roots);
});

test.skipIf(!pinned)('a plugin without exactly one default export is refused', async () => {
  const root = game();writeFileSync(join(root, 'assets/ui.plugin.ts'), 'export const ui={};');
  await expect(composeHost(root, engine)).rejects.toThrow('must have one default plugin export');
});
