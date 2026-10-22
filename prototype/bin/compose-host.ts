import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Engine 0.4.18 dropped forge.json `defaultScene`/`plugins`: a project names one engine and one frontend PluginAsset
 * root, and a scene owner plugin instantiates the scene and provides its root as `gameScene`. Prepare steps keep
 * writing the schema-2 plugin list; this turns it into the schema-3 roots, in the order the list gives (vocabulary
 * bootstraps such as reflection-components before the scene owner; camera inside the owner).
 */
export const HOST_PACKAGE_ID = '5ce7e000-0000-7000-8000-000000000001';
const camel = (id: string) => id.replace(/-(\w)/g, (_, c) => c.toUpperCase());

export async function composeHost(game: string, engineRoot: string) {
  const configPath = join(game, 'forge.json'), cfg = JSON.parse(readFileSync(configPath, 'utf8'));
  if (cfg.schemaVersion === '3.0.0') return cfg.roots;
  if (cfg.schemaVersion !== '2.0.0' || !/^[0-9a-f-]{36}$/.test(cfg.defaultScene ?? '') || !Array.isArray(cfg.plugins)) throw new Error('compose-host: schema-2 defaultScene and plugins required');
  const facade = (name: string) => import(join(engineRoot, 'packages/engine/dist/facades/pack', name + '.mjs'));
  const [{ AssetGuid }, { definePackageId }] = await Promise.all([facade('guid'), facade('source')]);
  const guid = (key: string) => AssetGuid.format(AssetGuid.derive(definePackageId(HOST_PACKAGE_ID), key));
  const assets = join(game, 'assets'), entries: Record<string, any> = {}, children: string[] = [];
  let frontend: string | null = null, camera: string | null = null;
  for (const p of cfg.plugins) {
    const file = join(game, p.name), name = camel(p.id);
    let source = readFileSync(file, 'utf8');
    if ((source.match(/^export default \{/gm) ?? []).length !== 1) throw new Error('compose-host: ' + p.name + ' must have one default plugin export');
    source = source.replace(/^export default \{/m, `export const ${name}={`);
    if (/defaultSceneRoot/.test(source)) {
      source = source.replace(/(?:ctx\.gameHost|host)\??\.defaultSceneRoot/g, 'ctx.gameScene.root').replace(/inject:\[([^\]]*)\]/, (_, l) => `inject:[${l},'gameScene']`);
      source = "import type {} from './scene-refs.ts';\n" + source;
    }
    writeFileSync(file, source);
    entries['plugin/' + p.id] = { kind: 'plugin', module: { specifier: './' + relative(assets, file), export: name } };
    if (p.realm === 'frontend') frontend = guid('plugin/' + p.id);
    else if (p.id === 'camera') camera = guid('plugin/' + p.id);
    else children.push(guid('plugin/' + p.id));
  }
  writeFileSync(join(assets, 'scene-refs.ts'), `import type {EntityHandle} from '@forgeax/engine/ecs';
export interface GameScene{readonly root:EntityHandle;}
declare module '@forgeax/engine/plugin'{interface EngineContextServices{gameScene:GameScene;}}
`);
  writeFileSync(join(assets, 'host-plugins.ts'), `import {joinPluginFiber,mountPluginAsset,type Plugin} from '@forgeax/engine/plugin';
import {worldDespawnScene} from '@forgeax/engine/scene';
import type {} from './scene-refs.ts';
/** Engine root: mount each child in order, so component bootstraps precede the scene owner. */
export const engine:Plugin.Object<{readonly children:readonly string[]}>={name:'scene/engine',inject:['assets','pluginPrograms'],async apply(ctx,config){
 await ctx.effect(async function*(){for(const g of config.children){const r=await mountPluginAsset(ctx,g);if(!r.ok)throw r.error;yield r.value.dispose;}});}};
/** Scene owner: instantiate the default scene, provide its root, then mount children (the camera). */
export const scene:Plugin.Object<{readonly scene:string;readonly children:readonly string[]}>={name:'scene/owner',inject:['world','assets','pluginPrograms'],async apply(ctx,config){
 const assets=ctx.assets;if(!assets)throw new Error('scene owner requires assets');
 const loaded=await assets.load(assets.parseGuid(config.scene),'scene');if(!loaded.ok)throw loaded.error;
 await ctx.effect(async function*(){const handle=loaded.value;yield()=>{assets.release(handle).unwrap();};
  const root=assets.instantiate(handle,ctx.world).unwrap();yield()=>worldDespawnScene(ctx.world,root).unwrap();
  yield ctx.provide('gameScene',{root});
  for(const g of config.children){const c=await mountPluginAsset(ctx,g);if(!c.ok)throw c.error;yield joinPluginFiber(c.value);}});}};
`);
  entries['plugin/engine'] = { kind: 'plugin', module: { specifier: './host-plugins.ts', export: 'engine' }, config: { children: [...children, guid('plugin/scene')].map(g => ({ $asset: g })) } };
  entries['plugin/scene'] = { kind: 'plugin', module: { specifier: './host-plugins.ts', export: 'scene' }, config: { scene: { $asset: cfg.defaultScene }, children: camera ? [{ $asset: camera }] : [] } };
  writeFileSync(join(assets, 'host.pack.ts'), `import {definePack,definePackageId} from '@forgeax/engine/pack/source';
import {ok} from '@forgeax/engine/types';
export default definePack({schemaVersion:'2.0.0',plugins:true,packageId:definePackageId('${HOST_PACKAGE_ID}'),build:()=>ok(${JSON.stringify(entries)})});
`);
  const roots = { engine: guid('plugin/engine'), ...(frontend ? { frontend } : {}) };
  writeFileSync(configPath, JSON.stringify({ id: cfg.id, name: cfg.name, schemaVersion: '3.0.0', assetRoots: ['assets'], roots }, null, 2) + '\n');
  return roots;
}
