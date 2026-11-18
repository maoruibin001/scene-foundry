/**
 * ForgeaX Engine Showcase Interactive Deck
 * 只在运行时通过 ECS 组件与系统切换检视模式（概念氛围 / 中性白模、实时剖切面、机构运动），不改规格、几何或正式资产数据。
 */
export function conceptLookPlugin(entities: Record<string, any>) {
  const lights = Object.entries(entities).flatMap(([key, e]) =>
    Object.entries(e?.components ?? {})
      .filter(([k]) => ['DirectionalLight', 'PointLight', 'SpotLight', 'RectAreaLight'].includes(k))
      .map(([kind]) => ({ key, kind })),
  );
  const hasFog = 'fog' in entities;
  const lightTypes = [...new Set(lights.map((x) => x.kind))];
  const renderTypes = [
    'Camera',
    'ClippingPlanes',
    'clippingPlanesData',
    'Skylight',
    ...(hasFog ? ['Fog'] : []),
    ...lightTypes,
  ];
  const fogSetup = hasFog
    ? `\n  const fogEntity = resolve('fog'), originalFog = structuredClone(ctx.world.get(fogEntity, Fog).unwrap());`
    : '';
  const fogApply = hasFog
    ? `\n      ctx.world.set(fogEntity, Fog, neutral ? { ...originalFog, maxOpacity: 0 } : originalFog).unwrap();`
    : '';

  return `import type {} from '@forgeax/engine/app';
import { Time, Update } from '@forgeax/engine/ecs';
import { quat } from '@forgeax/engine/math';
import type { Plugin } from '@forgeax/engine/plugin';
import { ${renderTypes.join(', ')} } from '@forgeax/engine/render';
import { Transform, sceneEntity, worldResolveSceneEntity } from '@forgeax/engine/scene';
import audit from './scene-audit.json';

type Vec3Tuple = [number, number, number];
type QuatTuple = [number, number, number, number];
type ClipMode = 'off' | 'hall-z' | 'core-y' | 'diag';

const KEY_LIGHT_DIR: Vec3Tuple = (() => {
  const len = Math.hypot(-0.35, -0.8, -0.45);
  return [-0.35 / len, -0.8 / len, -0.45 / len];
})();
const RING_SPEEDS = [0.35, -0.24, 0.18] as const;

const qAxisAngle = (ax: number, ay: number, az: number, rad: number): QuatTuple => {
  const half = rad * 0.5;
  const s = Math.sin(half);
  return [ax * s, ay * s, az * s, Math.cos(half)];
};

const qMul = (a: QuatTuple, b: QuatTuple): QuatTuple => {
  const rx = a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1];
  const ry = a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0];
  const rz = a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3];
  const rw = a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2];
  const len = Math.hypot(rx, ry, rz, rw) || 1;
  return [rx / len, ry / len, rz / len, rw / len];
};

const qSlerp = (a: QuatTuple, b: QuatTuple, t: number): QuatTuple => {
  let bx = b[0], by = b[1], bz = b[2], bw = b[3];
  let dot = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (dot < 0) {
    dot = -dot;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  let s0: number, s1: number;
  if (dot > 0.9995) {
    s0 = 1 - t;
    s1 = t;
  } else {
    const omega = Math.acos(Math.min(1, dot));
    const invSin = 1 / Math.sin(omega);
    s0 = Math.sin((1 - t) * omega) * invSin;
    s1 = Math.sin(t * omega) * invSin;
  }
  const rx = s0 * a[0] + s1 * bx;
  const ry = s0 * a[1] + s1 * by;
  const rz = s0 * a[2] + s1 * bz;
  const rw = s0 * a[3] + s1 * bw;
  const len = Math.hypot(rx, ry, rz, rw) || 1;
  return [rx / len, ry / len, rz / len, rw / len];
};

const readDeltaSeconds = (world: unknown, timeToken: unknown): number => {
  const w = world as { getResource?: (r: unknown) => unknown; resource?: (r: unknown) => unknown };
  const raw = typeof w.getResource === 'function'
    ? w.getResource(timeToken)
    : typeof w.resource === 'function'
      ? w.resource(timeToken)
      : undefined;
  const unpacked = raw && typeof raw === 'object' && 'ok' in raw
    ? ((raw as { ok: boolean; unwrap: () => unknown }).ok ? (raw as { unwrap: () => unknown }).unwrap() : undefined)
    : raw;
  const t = unpacked as { delta?: number; dt?: number; deltaTime?: number; deltaSeconds?: number } | undefined;
  const dt = typeof t?.delta === 'number'
    ? t.delta
    : typeof t?.dt === 'number'
      ? t.dt
      : typeof t?.deltaTime === 'number'
        ? t.deltaTime
        : typeof t?.deltaSeconds === 'number'
          ? t.deltaSeconds
          : 1 / 60;
  return Math.min(Math.max(dt, 0), 0.1);
};

export default {
  name: 'scene/concept-look',
  inject: ['world', 'gameHost'],
  apply(ctx) {
    void quat;
    const root = ctx.gameHost?.defaultSceneRoot;
    if (root === undefined) throw Error('Scene root unavailable');
    const resolve = (key: string) => worldResolveSceneEntity(ctx.world, root, sceneEntity('scene/main', key)).unwrap();
    const camera = resolve('camera');
    const originalCamera = structuredClone(ctx.world.get(camera, Camera).unwrap());
    const ambient = resolve('ambient');
    const originalAmbient = structuredClone(ctx.world.get(ambient, Skylight).unwrap());${fogSetup}
    const lightTypeMap: Record<string, any> = { ${lightTypes.map((x) => `${x}:${x}`).join(', ')} };
    const entries = ${JSON.stringify(lights)}.map(({ key, kind }) => {
      const entity = resolve(key);
      const type = lightTypeMap[kind];
      return { entity, type, original: structuredClone(ctx.world.get(entity, type).unwrap()), kind };
    });

    interface RigTarget {
      entity: ReturnType<typeof resolve>;
      kind: 'ring' | 'core';
      slot: number;
      basePos: Vec3Tuple;
      baseQuat: QuatTuple;
      curPos: Vec3Tuple;
      curQuat: QuatTuple;
    }
    const rigTargets: RigTarget[] = [];
    const seenEntities = new Set<unknown>();
    let ringCount = 0;
    let coreCount = 0;
    const rawParts = Array.isArray((audit as { parts?: unknown[] }).parts)
      ? ((audit as { parts?: unknown[] }).parts ?? [])
      : [];
    for (const part of rawParts as Array<{ id?: string; bindingKey?: string }>) {
      const label = \`\${part?.id ?? ''} \${part?.bindingKey ?? ''}\`;
      const isRing = /ring|band/i.test(label);
      const isCore = !isRing && /core/i.test(label) && !/mast|mount/i.test(label);
      if (!isRing && !isCore) continue;
      const candidates = [part?.bindingKey, part?.id]
        .filter((v): v is string => typeof v === 'string' && v.length > 0)
        .map((v) => v.replace(/^garden[/.]/, ''));
      for (const key of candidates) {
        const resolved = worldResolveSceneEntity(ctx.world, root, sceneEntity('scene/main', ['garden', key]));
        if (!resolved.ok) continue;
        const entity = resolved.unwrap();
        if (seenEntities.has(entity)) break;
        const trRes = ctx.world.get(entity, Transform);
        if (!trRes.ok) break;
        const tr = trRes.unwrap() as any;
        const pSrc = tr.pos ?? tr.position;
        const qSrc = tr.quat ?? tr.rotation;
        if (!pSrc || !qSrc) break;
        const basePos: Vec3Tuple = [pSrc[0], pSrc[1], pSrc[2]];
        const baseQuat: QuatTuple = [qSrc[0], qSrc[1], qSrc[2], qSrc[3]];
        seenEntities.add(entity);
        rigTargets.push({
          entity,
          kind: isRing ? 'ring' : 'core',
          slot: isRing ? ringCount++ : coreCount++,
          basePos,
          baseQuat,
          curPos: [...basePos],
          curQuat: [...baseQuat],
        });
        break;
      }
    }

    let rigActive = false;
    let rigSettled = true;
    let rigPhase = 0;
    let rigWeight = 0;

    const channel = new BroadcastChannel('forgeax-scene-' + audit.channelId);
    channel.onmessage = (e) => {
      if (e.data?.specSha256 !== audit.specSha256) return;

      if (e.data?.kind === 'scene-look' && ['concept', 'neutral'].includes(e.data.look)) {
        const neutral = e.data.look === 'neutral';
        const nextAmbient = neutral
          ? ({
              ...originalAmbient,
              color: [0.68, 0.7, 0.74] as [number, number, number],
              ...('groundColor' in originalAmbient && (originalAmbient as Record<string, unknown>).groundColor != null
                ? { groundColor: [0.28, 0.3, 0.33] as [number, number, number] }
                : {}),
              intensity: 0.72,
            } as typeof originalAmbient)
          : originalAmbient;
        ctx.world.set(ambient, Skylight, nextAmbient).unwrap();

        const nextCamera = neutral
          ? ({
              ...originalCamera,
              bloom: typeof (originalCamera as Record<string, unknown>).bloom === 'boolean' ? false : 0,
              bloomIntensity: 0,
              exposureMode: 0,
              exposure: 0.85,
            } as typeof originalCamera)
          : originalCamera;
        ctx.world.set(camera, Camera, nextCamera).unwrap();${fogApply}

        for (const entry of entries) {
          const nextLight = neutral
            ? entry.kind === 'DirectionalLight'
              ? {
                  ...entry.original,
                  color: [1, 1, 1],
                  intensity: 2.8,
                  ...('direction' in entry.original && entry.original.direction != null
                    ? { direction: KEY_LIGHT_DIR }
                    : {}),
                }
              : { ...entry.original, color: [1, 1, 1], intensity: 0 }
            : entry.original;
          ctx.world.set(entry.entity, entry.type, nextLight).unwrap();
        }
        channel.postMessage({ kind: 'scene-look-applied', look: e.data.look, specSha256: audit.specSha256 });
        return;
      }

      if (e.data?.kind === 'scene-clip' && ['off', 'hall-z', 'core-y', 'diag'].includes(e.data.mode)) {
        const mode = e.data.mode as ClipMode;
        const customOffset = typeof e.data.offset === 'number' && Number.isFinite(e.data.offset)
          ? e.data.offset
          : undefined;
        if (mode === 'off') {
          if (ctx.world.hasComponent(camera, ClippingPlanes)) {
            ctx.world.removeComponent(camera, ClippingPlanes);
          }
        } else {
          const plane: [number, number, number, number] = mode === 'hall-z'
            ? [-1, 0, 0, customOffset ?? 0]
            : mode === 'core-y'
              ? [0, -1, 0, customOffset ?? 18.5]
              : [-0.7071, 0, -0.7071, customOffset ?? 2];
          const data = clippingPlanesData({ planes: [plane], caps: true, clipShadows: false });
          if (ctx.world.hasComponent(camera, ClippingPlanes)) {
            ctx.world.set(camera, ClippingPlanes, data).unwrap();
          } else {
            ctx.world.addComponent(camera, { component: ClippingPlanes, data }).unwrap();
          }
        }
        channel.postMessage({ kind: 'scene-clip-applied', mode, specSha256: audit.specSha256 });
        return;
      }

      if (e.data?.kind === 'scene-rig' && typeof e.data.active === 'boolean') {
        rigActive = e.data.active;
        if (rigActive) rigSettled = false;
        channel.postMessage({
          kind: 'scene-rig-applied',
          active: rigActive,
          rigParts: rigTargets.length,
          specSha256: audit.specSha256,
        });
      }
    };

    ctx.effect(function* () {
      ctx.world.addSystem(Update, {
        name: 'scene-showcase-rig',
        queries: [],
        fn: () => {
          if ((!rigActive && rigSettled) || rigTargets.length === 0) return;
          const dt = readDeltaSeconds(ctx.world, Time);
          if (rigActive) {
            rigPhase += dt;
            rigWeight = Math.min(1, rigWeight + dt * 2.5);
            for (const target of rigTargets) {
              const trRes = ctx.world.get(target.entity, Transform);
              if (!trRes.ok) continue;
              const tr = trRes.unwrap();
              if (target.kind === 'ring') {
                const speed = RING_SPEEDS[target.slot % RING_SPEEDS.length];
                const axisIdx = target.slot % 3;
                const spin = axisIdx === 0
                  ? qAxisAngle(0, 1, 0, speed * rigPhase)
                  : axisIdx === 1
                    ? qAxisAngle(1, 0, 0, speed * rigPhase)
                    : qAxisAngle(0, 0, 1, speed * rigPhase);
                const tiltAngle = Math.sin(rigPhase * (0.45 - axisIdx * 0.05) + target.slot * 1.1) * 0.16 * rigWeight;
                const tilt = axisIdx === 0
                  ? qAxisAngle(1, 0, 0, tiltAngle)
                  : axisIdx === 1
                    ? qAxisAngle(0, 0, 1, tiltAngle)
                    : qAxisAngle(0, 1, 0, tiltAngle);
                const nextQuat = qMul(target.baseQuat, qMul(spin, tilt));
                target.curQuat = nextQuat;
                target.curPos = [...target.basePos];
                ctx.world.set(target.entity, Transform, {
                  ...tr,
                  ...('pos' in tr || !('position' in tr) ? { pos: target.curPos } : { position: target.curPos }),
                  ...('quat' in tr || !('rotation' in tr) ? { quat: nextQuat } : { rotation: nextQuat }),
                } as any).unwrap();
              } else {
                const spin = qAxisAngle(0, 1, 0, 0.12 * rigPhase);
                const nextQuat = qMul(target.baseQuat, spin);
                const lift = Math.sin(rigPhase * 1.1 + target.slot * 0.7) * 0.18 * rigWeight;
                const nextPos: Vec3Tuple = [target.basePos[0], target.basePos[1] + lift, target.basePos[2]];
                target.curQuat = nextQuat;
                target.curPos = nextPos;
                ctx.world.set(target.entity, Transform, {
                  ...tr,
                  ...('pos' in tr || !('position' in tr) ? { pos: nextPos } : { position: nextPos }),
                  ...('quat' in tr || !('rotation' in tr) ? { quat: nextQuat } : { rotation: nextQuat }),
                } as any).unwrap();
              }
            }
          } else {
            const blend = 1 - Math.exp(-6 * dt);
            rigWeight = Math.max(0, rigWeight - dt * 3);
            let allRestored = true;
            for (const target of rigTargets) {
              const trRes = ctx.world.get(target.entity, Transform);
              if (!trRes.ok) continue;
              const tr = trRes.unwrap();
              const nextPos: Vec3Tuple = [
                target.curPos[0] + (target.basePos[0] - target.curPos[0]) * blend,
                target.curPos[1] + (target.basePos[1] - target.curPos[1]) * blend,
                target.curPos[2] + (target.basePos[2] - target.curPos[2]) * blend,
              ];
              const nextQuat = qSlerp(target.curQuat, target.baseQuat, blend);
              const posErr = Math.hypot(
                nextPos[0] - target.basePos[0],
                nextPos[1] - target.basePos[1],
                nextPos[2] - target.basePos[2],
              );
              const quatDot = Math.abs(
                nextQuat[0] * target.baseQuat[0] +
                nextQuat[1] * target.baseQuat[1] +
                nextQuat[2] * target.baseQuat[2] +
                nextQuat[3] * target.baseQuat[3],
              );
              if (posErr < 1e-4 && 1 - quatDot < 1e-5) {
                target.curPos = [...target.basePos];
                target.curQuat = [...target.baseQuat];
              } else {
                allRestored = false;
                target.curPos = nextPos;
                target.curQuat = nextQuat;
              }
              ctx.world.set(target.entity, Transform, {
                ...tr,
                ...('pos' in tr || !('position' in tr) ? { pos: target.curPos } : { position: target.curPos }),
                ...('quat' in tr || !('rotation' in tr) ? { quat: target.curQuat } : { rotation: target.curQuat }),
              } as any).unwrap();
            }
            if (allRestored) {
              rigPhase = 0;
              rigWeight = 0;
              rigSettled = true;
            }
          }
        },
      }).unwrap();
      yield () => {
        ctx.world.removeSystem(Update, 'scene-showcase-rig');
        channel.close();
      };
    }, 'scene/concept-look');
  },
} satisfies Plugin;
`;
}

export function conceptLookUi(source: string) {
  const marker = "const record=document.createElement('button');";
  if (!source.includes(marker)) throw Error('SCENE_LOOK_UI_MARKER_MISSING');

  const controlsSnippet = ` const styleDeckBtn=(btn:HTMLButtonElement,active:boolean)=>{btn.style.cssText='margin-left:8px;padding:4px 10px;border-radius:6px;font-size:12px;line-height:1.4;cursor:pointer;backdrop-filter:blur(6px);transition:background 120ms,border-color 120ms,color 120ms;'+(active?'border:1px solid rgba(56,189,248,0.68);background:rgba(14,116,144,0.42);color:#f0f9ff':'border:1px solid rgba(148,163,184,0.28);background:rgba(15,23,42,0.84);color:#e2e8f0');};
 const look=document.createElement('button');look.textContent='切换至中性照明';look.title='快捷键: L';styleDeckBtn(look,false);let currentLook:'concept'|'neutral'='concept',lookTimer:ReturnType<typeof setTimeout>|undefined;
 const clipModes=['off','hall-z','core-y','diag'] as const;type ClipMode=(typeof clipModes)[number];
 const clipLabels:Record<ClipMode,string>={off:'剖切: 关','hall-z':'剖切: 纵剖','core-y':'剖切: 横剖',diag:'剖切: 斜剖'};
 const clip=document.createElement('button');clip.textContent=clipLabels.off;clip.title='快捷键: C';styleDeckBtn(clip,false);let currentClip:ClipMode='off',clipTimer:ReturnType<typeof setTimeout>|undefined;
 const rig=document.createElement('button');rig.textContent='机构: 静止';rig.title='快捷键: M';styleDeckBtn(rig,false);let currentRig=false,rigTimer:ReturnType<typeof setTimeout>|undefined;
 channel.addEventListener('message',(e:MessageEvent)=>{if(e.data?.specSha256!==audit.specSha256)return;
  if(e.data?.kind==='scene-look-applied'){clearTimeout(lookTimer);currentLook=e.data.look;look.disabled=false;look.textContent=currentLook==='concept'?'切换至中性照明':'切换至概念氛围';styleDeckBtn(look,currentLook==='neutral');}
  else if(e.data?.kind==='scene-clip-applied'&&clipModes.includes(e.data.mode)){clearTimeout(clipTimer);currentClip=e.data.mode;clip.disabled=false;clip.textContent=clipLabels[currentClip];styleDeckBtn(clip,currentClip!=='off');}
  else if(e.data?.kind==='scene-rig-applied'){clearTimeout(rigTimer);currentRig=Boolean(e.data.active);rig.disabled=false;rig.textContent=currentRig?'机构: 运转中':'机构: 静止';styleDeckBtn(rig,currentRig);}
 });
 look.onclick=()=>{const next=currentLook==='concept'?'neutral':'concept';look.disabled=true;look.textContent='切换中…';channel.postMessage({kind:'scene-look',look:next,specSha256:audit.specSha256});lookTimer=setTimeout(()=>{look.disabled=false;look.textContent='切换未响应，重试';},3000);};
 clip.onclick=()=>{const next=clipModes[(clipModes.indexOf(currentClip)+1)%clipModes.length];clip.disabled=true;clip.textContent='剖切中…';channel.postMessage({kind:'scene-clip',mode:next,specSha256:audit.specSha256});clipTimer=setTimeout(()=>{clip.disabled=false;clip.textContent='剖切未响应，重试';},3000);};
 rig.onclick=()=>{const next=!currentRig;rig.disabled=true;rig.textContent='切换中…';channel.postMessage({kind:'scene-rig',active:next,specSha256:audit.specSha256});rigTimer=setTimeout(()=>{rig.disabled=false;rig.textContent='机构未响应，重试';},3000);};
 const onShowcaseKey=(e:KeyboardEvent)=>{if(e.ctrlKey||e.metaKey||e.altKey||e.repeat)return;const el=e.target as HTMLElement|null;const tag=el?.tagName;if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT'||el?.isContentEditable)return;if(e.code==='KeyL'&&!look.disabled)look.click();else if(e.code==='KeyC'&&!clip.disabled)clip.click();else if(e.code==='KeyM'&&!rig.disabled)rig.click();};
 window.addEventListener('keydown',onShowcaseKey);
 hud.append(look,clip,rig);
`;

  return source
    .replace(
      "if(e.data?.specSha256!==audit.specSha256)return;sources.add(e.data.sourceId);",
      "if(['scene-look','scene-look-applied','scene-clip','scene-clip-applied','scene-rig','scene-rig-applied'].includes(e.data?.kind)||e.data?.specSha256!==audit.specSha256)return;sources.add(e.data.sourceId);",
    )
    .replace(marker, controlsSnippet + marker)
    .replace(
      'channel.close();if(recorder',
      "window.removeEventListener('keydown',onShowcaseKey);clearTimeout(lookTimer);clearTimeout(clipTimer);clearTimeout(rigTimer);channel.close();if(recorder",
    );
}
