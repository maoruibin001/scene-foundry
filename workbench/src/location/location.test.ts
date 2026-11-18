import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { LOCATION_VERSION, runLocation } from './location';
import { voxelGrid, type VoxelOperation, type VoxelProgram } from '../voxel/program';
import { worldPoint } from './voxel-derivatives';

const rect = (min: VoxelOperation['min'], size: VoxelOperation['size'], palette = 'oak'): VoxelOperation =>
  ({action: 'fill', shape: 'box', min, size, palette, slopeAxis: 'x', reverse: false});
const source: VoxelProgram = {
  version: 'voxel-scene-v1', name: 'Covered passage', size: [8, 6, 8], cellSize: .5,
  palette: [{id: 'oak', color: '#844820'}, {id: 'slate', color: '#61717e'}],
  entities: [
    {id: 'wall', label: 'Wall', category: 'wall', role: 'subject', requirementIds: [], operations: [
      rect([0, 1, 0], [8, 1, 6]), {...rect([2, 1, 0], [4, 1, 5]), action: 'erase', palette: null},
    ]},
    {id: 'roof', label: 'Roof', category: 'roof', role: 'subject', requirementIds: [], operations: [
      rect([0, 2, 6], [4, 3, 1]), rect([4, 2, 6], [4, 3, 1], 'slate'),
    ]},
  ],
  cameras: [
    {name:'Entrance', referenceIndex:null, position:[4,-12,6], target:[4,2,3], projection:'perspective', orthographicHeight:null, fov:.9},
    {name:'Interior', referenceIndex:null, position:[4,14,6], target:[4,2,3], projection:'perspective', orthographicHeight:null, fov:.9},
  ],
  lighting: {direction:[-.4,-.6,-.8], color:[1,1,1], intensity:2, ambientColor:[1,1,1], ambientIntensity:.7, points:[]},
  assumptions: [],
};

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'location-contract-'));
  const sdk = join(root, 'game/node_modules/@forgeax/engine/package.json');
  mkdirSync(dirname(sdk), {recursive: true});
  writeFileSync(sdk, JSON.stringify({name: '@forgeax/engine', version: '0.5.0'}));
  writeFileSync(join(root, 'game/package.json'), JSON.stringify({name: '@test/game'}));
  const request = {
    version: LOCATION_VERSION, project: {id: '@test/game', root: 'game'}, sdk: '0.5.0',
    location: {
      id: 'courtyard', placement: {pivotSourceMeters: [1, 1, 0], worldAnchorEngine: [20, 10, 30]},
      boundsEngine: {min: [19, 9, 28], max: [23, 15, 31]},
      roads: [{id: 'entry', positionEngine: [20, 10, 31], widthMeters: 2}],
      anchors: {roof: {positionEngine: [21, 13.5, 30], partId: 'roof'}},
      dependencies: [],
    },
    input: {kind: 'voxel', path: 'source.json'},
    voxel: {colliderLimit: 30, coverParts: ['roof'], wetBindings: [{partId: 'roof', materialId: 'slate', hostMaterialKey: 'wet-slate'}]},
    output: 'r1',
  };
  const put = (file: string, value: unknown) => writeFileSync(join(root, file), JSON.stringify(value));
  const get = (file: string) => JSON.parse(readFileSync(join(root, file), 'utf8'));
  put('source.json', source);
  return {root, request, put, get, path: join(root, 'request.json')};
}

test('exports exact part-owned occupancy and exposed cover; an anchored revision and reuse preserve identity', async () => {
  const {root, request, put, get, path} = fixture();
  try {
    put('request.json', request);
    expect(await runLocation('preflight', path)).toMatchObject({ready:true, needsModel:false, mode:'first-import'});
    expect(existsSync(join(root, 'r1'))).toBe(false);
    const first = await runLocation('export', path);
    expect(first).toMatchObject({partIds:['wall', 'roof'], accounting:{modelCalls:0}});
    const output = get('r1/voxel-surfaces.json');
    const meshBytes = readFileSync(join(root, 'r1/native-meshes.json'));
    expect(output.meshSha256).toBe(createHash('sha256').update(meshBytes).digest('hex'));
    const grid = voxelGrid(source);
    for (let z=0; z<8; z++) for (let y=0; y<6; y++) for (let x=0; x<8; x++) {
      const position = worldPoint([(x+.5)*.5,(y+.5)*.5,(z+.5)*.5], request.location.placement as any);
      const hits = output.colliders.filter(({bounds}:any) => position.every((n,i)=>n>bounds.min[i]&&n<bounds.max[i]));
      const owner = grid.owners[x + 8*(y+6*z)];
      expect(hits.map((b:any)=>b.partId)).toEqual(owner ? [source.entities[owner-1].id] : []);
    }
    expect(output.rainCover).toHaveLength(2);
    expect(output.rainCover.every((r:any)=>r.bounds.min[1]===13.5 && r.partId==='roof')).toBe(true);
    expect(output.wetBindings).toEqual(request.voxel.wetBindings);

    const changed = structuredClone(source);
    changed.entities[1].operations.push(rect([5, 3, 7],[2, 1, 1],'slate'));
    put('source.json', changed);
    const previous = {manifest:'r1/location.json', sha256:(first as {sha256?:string}).sha256};
    const update = {...request, previous, output:'r2'};
    put('request.json', update);
    expect(await runLocation('export', path)).toMatchObject({ready:true, mode:'update', previous:previous.sha256});
    const next = get('r2/voxel-surfaces.json');
    expect(next.occupiedCells - output.occupiedCells).toBe(2);
    expect(next.meshSha256).not.toBe(output.meshSha256);
    expect(next.rainCover.some((r:any)=>r.bounds.min[1]===14)).toBe(true);
    expect(next.wetBindings).toEqual(output.wetBindings);
    expect(readFileSync(join(root, 'r1/native-meshes.json'))).toEqual(meshBytes);

    put('request.json', {...request, input:{kind:'reuse', ...previous}});
    expect(await runLocation('export', path)).toMatchObject({mode:'reuse', sha256:previous.sha256, needsModel:false});
    put('r1/voxel-surfaces.json', {corruption:true});
    await expect(runLocation('export', path)).rejects.toThrow('Artifact failed verification');
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test('preflight rejects wrong projects, geometry outside the revision boundary, and inputs beyond local compilation or reuse', async () => {
  const {root, request, put, path} = fixture();
  try {
    put('request.json', {...request, project:{...request.project,id:'@test/other-project'}});
    await expect(runLocation('preflight', path)).rejects.toThrow('Project ID must match');
    put('request.json', {...request, location:{...request.location, boundsEngine:{min:[19,9,29],max:[23,15,31]}}});
    await expect(runLocation('export', path)).rejects.toThrow('outside the allowed location bounds');
    expect(existsSync(join(root,'r1'))).toBe(false);
    put('request.json', {...request, input:{kind:'reference',route:'voxel',images:[]}});
    await expect(runLocation('preflight', path)).rejects.toThrow('Unknown input kind.');
  } finally { rmSync(root,{recursive:true,force:true}); }
});
