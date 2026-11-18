import { createHash } from 'node:crypto';
import { accessSync, constants, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { compileGeometryProgram, validateGeometryProgram, type GeometryProgram, type Texture } from '../geometry/program';
import { validateScene, type SceneInput } from '../geometry/scene-contract';
import { validateSceneSpec } from '../spec/schema';
import { compileVoxelSceneWithGeometry, VOXEL_LIMITS, type VoxelProgram } from '../voxel/program';
import { voxelDerivatives, worldBounds, type Bounds, type Placement, type Vec3, type WetBinding } from './voxel-derivatives';

export const LOCATION_VERSION = 'scene-foundry-location-v1';
const SDK_VERSION = '0.5.0';

type Road = { id: string; positionEngine: Vec3; widthMeters: number };
type Anchor = { positionEngine: Vec3; partId?: string };
type Dependency = { id: string; sha256: string };
type SourceKind = 'voxel' | 'ordinary' | 'spec';
type Request = {
  version: typeof LOCATION_VERSION;
  project: { id: string; root: string };
  sdk: string;
  location: {
    id: string; placement: Placement; boundsEngine: Bounds;
    roads: Road[]; anchors: Record<string, Anchor>; dependencies: Dependency[];
  };
  input: { kind: SourceKind; path: string; plan?: string; pbrDir?: string; images?: string[]; textures?: string }
    | { kind: 'reuse'; manifest: string; sha256: string }
    | { kind: 'reference'; route: 'ordinary' | 'voxel'; prompt?: string; images: string[] };
  previous?: { manifest: string; sha256: string; retirePartIds?: string[] };
  output?: string;
  voxel?: { colliderLimit?: number; coverParts: string[]; wetBindings: WetBinding[] };
};
type Manifest = {
  version: typeof LOCATION_VERSION; projectId: string; sdk: { version: string; packageSha256: string };
  location: Request['location']; sourceKind: SourceKind; partIds: string[];
  artifacts: Record<string, string>;
};
const stableId = /^[a-z0-9][a-z0-9._/-]*$/;
const shaPattern = /^[a-f0-9]{64}$/;
const sha256 = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
const requireValue = (value: unknown, message: string) => { if (!value) throw Error(message); };
const vector = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
const fileNames = (directory: string) => readdirSync(directory, {recursive: true}).map(String).sort()
  .filter(name => !lstatSync(join(directory, name)).isDirectory());
const inside = (point: Vec3, b: Bounds) => point.every((n, i) => n >= b.min[i] - 1e-6 && n <= b.max[i] + 1e-6);
const zeroModel = { modelCalls: 0, modelCost: { amount: 0, currency: null }, scope: 'this-command-only' };

function identity(request: Request, directory: string) {
  requireValue(request?.version === LOCATION_VERSION, `Expected request version ${LOCATION_VERSION}.`);
  requireValue(request.sdk === SDK_VERSION, `This contract supports ForgeaX ${SDK_VERSION}.`);
  requireValue(request.project?.id && request.project?.root, 'Specify the consuming project name and root.');
  const projectRoot = resolve(directory, request.project.root);
  const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
  requireValue(pkg.name === request.project.id, 'Project ID must match the consuming package.json name.');
  const sdkBytes = readFileSync(join(projectRoot, 'node_modules/@forgeax/engine/package.json'));
  const sdk = JSON.parse(sdkBytes.toString());
  requireValue(sdk.name === '@forgeax/engine' && sdk.version === request.sdk,
    'Installed consumer @forgeax/engine does not match the requested version.');
  const loc = request.location;
  requireValue(loc?.id && stableId.test(loc.id), 'A stable location ID is required.');
  const {placement, boundsEngine, anchors, roads, dependencies} = loc;
  requireValue(vector(placement?.pivotSourceMeters) && vector(placement?.worldAnchorEngine), 'Provide finite metre-valued placement vectors.');
  requireValue(vector(boundsEngine?.min) && vector(boundsEngine?.max)
    && boundsEngine.min.every((n, i) => n < boundsEngine.max[i]), 'Provide non-empty Engine-space location bounds.');
  requireValue(anchors && typeof anchors === 'object' && !Array.isArray(anchors)
    && Object.entries(anchors).every(([id, a]) => stableId.test(id) && vector(a?.positionEngine) && inside(a.positionEngine, boundsEngine)),
    'All named anchors must lie within the location bounds.');
  requireValue(Array.isArray(roads) && new Set(roads.map(r => r.id)).size === roads.length
    && roads.every(r => stableId.test(r.id) && vector(r.positionEngine) && inside(r.positionEngine, boundsEngine)
      && Number.isFinite(r.widthMeters) && r.widthMeters > 0), 'Road connections require unique IDs, in-bounds positions and positive widths.');
  requireValue(Array.isArray(dependencies) && new Set(dependencies.map(d => d.id)).size === dependencies.length
    && dependencies.every(d => stableId.test(d.id) && shaPattern.test(d.sha256)), 'Dependencies require unique IDs and pinned SHA-256 digests.');
  return { projectId: pkg.name as string, projectRoot: realpathSync(projectRoot), sdk: { version: sdk.version as string, packageSha256: sha256(sdkBytes) } };
}

function readBundle(directory: string, ref: {manifest: string; sha256: string}, request: Request, projectId: string) {
  const path = resolve(directory, ref.manifest);
  const bytes = readFileSync(path);
  requireValue(shaPattern.test(ref.sha256) && sha256(bytes) === ref.sha256, 'Location manifest SHA-256 mismatch.');
  const manifest: Manifest = JSON.parse(bytes.toString());
  requireValue(manifest.version === LOCATION_VERSION && manifest.projectId === projectId
    && manifest.sdk.version === request.sdk && manifest.location.id === request.location.id,
    'Prior bundle belongs to a different project, SDK or location.');
  const root = realpathSync(dirname(path));
  const expectedFiles = [...Object.keys(manifest.artifacts), 'location.json'].sort();
  requireValue(Bun.deepEquals(fileNames(root), expectedFiles), 'Prior bundle file list differs from the manifest.');
  for (const [name, digest] of Object.entries(manifest.artifacts)) {
    const file = resolve(root, name);
    requireValue(!isAbsolute(name) && relative(root, file) === name && !name.startsWith('..')
      && realpathSync(file) === file && statSync(file).isFile() && sha256(readFileSync(file)) === digest, `Artifact failed verification: ${name}`);
  }
  return { manifest, sha256: ref.sha256, path };
}

function checkUpdate(previous: Manifest, request: Request, parts: string[]) {
  const {location} = request;
  for (const field of ['placement', 'boundsEngine', 'roads'] as const) {
    requireValue(Bun.deepEquals(previous.location[field], location[field]), `Incremental update changed frozen location ${field}.`);
  }
  for (const [id, before] of Object.entries(previous.location.anchors)) {
    const after = Object.hasOwn(location.anchors, id) && location.anchors[id];
    requireValue(after && before.partId === after.partId, `Incremental update changed anchor identity: ${id}.`);
  }
  const removed = previous.partIds.filter(id => !parts.includes(id)).sort();
  const retired = [...(request.previous?.retirePartIds ?? [])].sort();
  requireValue(Bun.deepEquals(removed, retired), `Part retirement must match the removed IDs: ${removed.join(', ') || '(none)'}.`);
}

function readImages(paths: string[], directory: string) {
  requireValue(Array.isArray(paths) && paths.length <= 5, 'Supply at most five original images.');
  return paths.map(path => {
    const file = resolve(directory, path);
    requireValue(statSync(file).isFile(), `Expected an image file: ${path}`);
    const bytes = readFileSync(file);
    const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const webp = bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
    requireValue(png || jpeg || webp, `Use an original PNG, JPEG or WebP reference: ${path}`);
    return { path, sha256: sha256(bytes) };
  });
}

function referenceStatus(input: Extract<Request['input'], {kind: 'reference'}>, directory: string) {
  requireValue(input.route === 'ordinary' || input.route === 'voxel', 'Choose the ordinary or voxel reference route.');
  const images = readImages(input.images, directory);
  const missing: string[] = [];
  if (!images.length && (input.route === 'voxel' || !input.prompt?.trim())) {
    missing.push(input.route === 'voxel' ? 'An original image is required for voxel generation.' : 'Provide a prompt or an original image.');
  }
  missing.push('A worker route with verified project ownership, write authorization, model and project-scoped ledger is required.');
  return {
    ready: false, needsModel: true, missing, images,
    compatibilityRoute: input.route === 'voxel' ? '/api/voxel/jobs' : '/api/jobs',
    authorization: 'unverified', modelRoute: null, budget: null,
    accounting: zeroModel,
  };
}

async function prepare(request: Request, directory: string) {
  const who = identity(request, directory);
  const input = request.input;
  requireValue(input?.kind, 'Specify the input kind.');
  if (input.kind === 'reference') {
    return { response: { ...who, mode: 'generation', ...referenceStatus(input, directory) } };
  }
  if (input.kind === 'reuse') {
    const prior = readBundle(directory, input, request, who.projectId);
    requireValue(Bun.deepEquals(prior.manifest.location, request.location), 'Reuse must preserve the full location contract.');
    return { response: { ...who, mode: 'reuse', ready: true, needsModel: false, manifest: prior.path, sha256: prior.sha256, accounting: zeroModel } };
  }

  requireValue(['voxel', 'ordinary', 'spec'].includes(input.kind), 'Unknown input kind.');
  requireValue(request.output, 'Specify the new immutable bundle directory.');
  const target = resolve(directory, request.output!);
  const relativeToGame = relative(who.projectRoot, join(realpathSync(dirname(target)), target.split(sep).at(-1)!));
  requireValue(relativeToGame === '..' || relativeToGame.startsWith('..' + sep) || isAbsolute(relativeToGame),
    'Export to a staging directory outside the consuming project.');
  requireValue(!existsSync(target), 'The destination already exists. Choose a new revision directory.');
  accessSync(dirname(target), constants.W_OK);
  const previous = request.previous && readBundle(directory, request.previous, request, who.projectId);
  const source = readFileSync(resolve(directory, input.path));
  const data = JSON.parse(source.toString());
  const planBytes = input.plan ? readFileSync(resolve(directory, input.plan)) : undefined;
  const plan = planBytes ? JSON.parse(planBytes.toString()) : {requirements: []};
  const files: Record<string, string | Uint8Array> = {'source.json': source};
  if (planBytes) files['plan.json'] = planBytes;
  const loc = request.location;
  let partIds: string[];
  let specExport: ((root: string) => void) | undefined;
  let nativeBounds: Bounds | undefined;
  const referenceImages = readImages(input.images ?? [], directory);
  if (input.kind === 'spec') {
    requireValue(!request.voxel && !planBytes && !input.textures && !referenceImages.length, 'A frozen spec supplies its own requirements and does not have a voxel grid.');
    validateSceneSpec(data);
    // The existing Pack exporter emits Y-up scene coordinates without a host translation.
    requireValue(Bun.deepEquals(loc.placement, {pivotSourceMeters: [0, 0, 0], worldAnchorEngine: [0, 0, 0]}),
      'Specification export uses its authored origin; use zero placement and place the Pack through the existing host adapter.');
    const compilerSdk = readFileSync(join(import.meta.dir, '../../node_modules/@forgeax/engine/package.json'));
    requireValue(sha256(compilerSdk) === who.sdk.packageSha256, 'Link the workbench to the same ForgeaX SDK package as the consumer before exporting specs.');
    const compiler = await import('../spec/export-pack');
    const pbrDir = input.pbrDir && resolve(directory, input.pbrDir);
    for (const asset of compiler.pbrAssets(data)) {
      requireValue(pbrDir, 'This spec needs the local Poly Haven material catalog.');
      const name = asset + '.json';
      files['dependencies/' + name] = readFileSync(join(pbrDir!, name));
    }
    const compiled = compiler.planSpecExport(data);
    requireValue(compiled.report.errors.length === 0 && !compiled.report.proxies.length && !compiled.report.unresolved.length
      && !compiled.report.dropped.length, 'Spec export has unresolved, dropped or proxy geometry.');
    partIds = data.objects.map(o => o.id);
    nativeBounds = worldBounds(data.bounds, loc.placement);
    const packageId = sha256(`${who.projectId}/${loc.id}/${sha256(source)}`);
    const uuid = `${packageId.slice(0, 8)}-${packageId.slice(8, 12)}-5${packageId.slice(13, 16)}-8${packageId.slice(17, 20)}-${packageId.slice(20, 32)}`;
    specExport = root => {
      const receipt = compiler.writeSpecPack(data, compiled, join(root, 'pack'), {packageId: uuid, sourceKey: 'scene/main', name: data.name}, pbrDir ? join(root, 'dependencies') : undefined);
      writeFileSync(join(root, 'pack-receipt.json'), json(receipt));
    };
  } else {
    requireValue(input.kind !== 'ordinary' || data?.version === 'scene-v1' || data?.version === 'geometry-v1',
      'Ordinary input must be scene-v1 or geometry-v1.');
    requireValue(!input.pbrDir && (input.kind === 'ordinary' || !input.textures), 'This source kind cannot use the selected texture input.');
    const refCount = referenceImages.length;
    const textureBytes = input.textures && readFileSync(resolve(directory, input.textures));
    const textures: Record<string, Texture> = textureBytes ? JSON.parse(textureBytes.toString()) : {};
    if (textureBytes) files['textures.json'] = textureBytes;
    const built = input.kind === 'voxel' ? compileVoxelSceneWithGeometry(data as VoxelProgram, plan, refCount) : undefined;
    const scene = built?.scene ?? (data.version === 'scene-v1' ? validateScene(data as SceneInput, plan, refCount) : undefined);
    const program: GeometryProgram = scene?.program ?? data;
    if (!scene && planBytes) validateGeometryProgram(program, plan.requirements.map((r: {id: string}) => r.id));
    const compiled = built?.compiled ?? compileGeometryProgram(program, textures);
    nativeBounds = worldBounds(compiled.bounds, loc.placement);
    partIds = program.instances.map(instance => instance.id);
    const anchors = Object.fromEntries(Object.entries(loc.anchors).map(([id, a]) => [id, a.positionEngine]));
    files['native-meshes.json'] = json({id: loc.id, ...loc.placement, anchors, meshes: compiled.meshes});
    if (built) {
      const {colliderLimit = 512, coverParts = [], wetBindings = []} = request.voxel ?? {};
      requireValue(Number.isSafeInteger(colliderLimit) && colliderLimit > 0 && colliderLimit <= VOXEL_LIMITS.filledCells, 'Invalid host collision box limit.');
      requireValue(new Set(coverParts).size === coverParts.length && coverParts.every(id => partIds.includes(id)), 'Unknown or duplicate rain cover part.');
      const pairs = new Set(compiled.meshes.map(m => `${m.entityId}/${m.geometry.material.id}`));
      const wetPairs = wetBindings.map(b => `${b.partId}/${b.materialId}`);
      requireValue(new Set(wetPairs).size === wetBindings.length && wetBindings.every((b, i) => pairs.has(wetPairs[i]) && stableId.test(b.hostMaterialKey)),
        'Wet bindings require distinct, visible part/material pairs and valid host material keys.');
      const derivatives = voxelDerivatives(data, built.grid, built.surfaces, loc.placement, colliderLimit, coverParts);
      files['voxel-surfaces.json'] = json({meshSha256: sha256(files['native-meshes.json']), ...derivatives, wetBindings});
      files['metrics.json'] = json(built.metrics);
    } else requireValue(!request.voxel, 'Voxel collision and rain surfaces require a voxel input.');
  }

  requireValue(nativeBounds && inside(nativeBounds.min, loc.boundsEngine) && inside(nativeBounds.max, loc.boundsEngine),
    'Geometry extends outside the allowed location bounds.');
  requireValue(Object.values(loc.anchors).every(a => !a.partId || partIds.includes(a.partId)), 'An anchor refers to an unknown part.');
  if (previous) {
    requireValue(previous.manifest.sourceKind === input.kind, 'Incremental update must keep the existing host asset format.');
    checkUpdate(previous.manifest, request, partIds);
  }
  const response = { ...who, mode: previous ? 'update' : 'first-import', ready: true, needsModel: false, output: target,
    inputKind: input.kind, referenceImages, sourceSha256: sha256(source), partIds, previous: previous?.sha256 ?? null, accounting: zeroModel };
  return { response, files, specExport };
}

export async function runLocation(command: 'preflight' | 'export', path: string) {
  const start = performance.now();
  const directory = dirname(resolve(path));
  const request: Request = JSON.parse(readFileSync(path, 'utf8'));
  const result = await prepare(request, directory);
  const { response } = result;
  if (command === 'preflight' || !response.ready || !result.files) return {version: LOCATION_VERSION, ...response, elapsedMs: Math.round(performance.now() - start)};
  const target = response.output!;
  const stage = mkdtempSync(join(dirname(target), '.location-'));
  try {
    for (const [name, content] of Object.entries(result.files)) {
      const file = join(stage, name);
      mkdirSync(dirname(file), {recursive: true});
      writeFileSync(file, content);
    }
    result.specExport?.(stage);
    const files = fileNames(stage);
    const artifacts = Object.fromEntries(files.map(name => [name, sha256(readFileSync(join(stage, name)))]));
    const manifest = json({
      version: LOCATION_VERSION, projectId: response.projectId, sdk: response.sdk,
      location: request.location, coordinates: {source: 'right-handed X east, Y north, Z up', engine: 'right-handed X east, Y up, Z south', units: 'm'},
      sourceKind: response.inputKind, partIds: response.partIds, previous: response.previous,
      provenance: {operation: 'deterministic-compilation', sourceSha256: response.sourceSha256, referenceImages: response.referenceImages?.map(image => image.sha256), accounting: zeroModel, upstreamModelCalls: null, upstreamModelCost: null},
      artifacts,
    });
    writeFileSync(join(stage, 'location.json'), manifest);
    renameSync(stage, target);
    return {version: LOCATION_VERSION, ...response, manifest: join(target, 'location.json'), sha256: sha256(manifest), elapsedMs: Math.round(performance.now() - start)};
  } finally {
    rmSync(stage, {recursive: true, force: true});
  }
}
