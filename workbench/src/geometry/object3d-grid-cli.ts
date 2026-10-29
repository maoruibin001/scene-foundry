// usage: bun object3d-grid-cli.ts <render-scene.json> <out.json> — the object3d ray grid in its own process, so the server stays responsive.
import {readFileSync,writeFileSync} from 'node:fs';
import {object3dGrid} from './object3d-gate';
const [scene,out]=process.argv.slice(2);writeFileSync(out,JSON.stringify(object3dGrid(JSON.parse(readFileSync(scene,'utf8')))));
