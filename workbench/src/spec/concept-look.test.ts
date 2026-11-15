import { describe, expect, test } from 'bun:test';
import { conceptLookPlugin, conceptLookUi } from './concept-look';

const ok = <T>(val: T) => ({ ok: true as const, unwrap: () => val });
const err = (msg: string) => ({
  ok: false as const,
  unwrap: () => {
    throw new Error(msg);
  },
});

function instantiateGeneratedPlugin(
  pluginTs: string,
  auditData: {
    channelId: string;
    specSha256: string;
    parts?: Array<{ id?: string; bindingKey?: string }>;
  },
) {
  const transpiler = new Bun.Transpiler({ loader: 'ts' });
  const js = transpiler.transformSync(pluginTs);

  const tokens = {
    Time: Symbol('Time'),
    Update: Symbol('Update'),
    quat: {},
    Camera: Symbol('Camera'),
    ClippingPlanes: Symbol('ClippingPlanes'),
    Skylight: Symbol('Skylight'),
    Fog: Symbol('Fog'),
    DirectionalLight: Symbol('DirectionalLight'),
    PointLight: Symbol('PointLight'),
    SpotLight: Symbol('SpotLight'),
    RectAreaLight: Symbol('RectAreaLight'),
    Transform: Symbol('Transform'),
  };

  const messages: any[] = [];
  let closed = false;
  let channelInstance: {
    name: string;
    onmessage: ((e: { data: any }) => void) | null;
    postMessage: (data: any) => void;
    close: () => void;
  } | null = null;

  class MockBroadcastChannel {
    name: string;
    onmessage: ((e: { data: any }) => void) | null = null;
    constructor(name: string) {
      this.name = name;
      channelInstance = this;
    }
    postMessage(data: any) {
      messages.push(data);
    }
    close() {
      closed = true;
    }
  }

  const executableBody = js
    .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
    .replace(/export\s+default\s+/, 'return ');

  const factory = new Function(
    'deps',
    `const { Time, Update, quat, Camera, ClippingPlanes, clippingPlanesData, Skylight, Fog, DirectionalLight, PointLight, SpotLight, RectAreaLight, Transform, sceneEntity, worldResolveSceneEntity, audit, BroadcastChannel } = deps;\n${executableBody}`,
  );

  const plugin = factory({
    ...tokens,
    clippingPlanesData: (input: any) => ({ ...input }),
    sceneEntity: (scene: string, path: string | string[]) => ({ scene, path }),
    worldResolveSceneEntity: (world: any, root: any, ref: { scene: string; path: string | string[] }) =>
      world.__resolve(root, ref),
    audit: auditData,
    BroadcastChannel: MockBroadcastChannel,
  });

  return {
    plugin,
    tokens,
    messages,
    isClosed: () => closed,
    send: (data: any) => channelInstance?.onmessage?.({ data }),
  };
}

function createMockWorld(
  tokens: Record<string, symbol | object>,
  initialEntities: Record<string, Map<symbol, any>>,
  dt = 0.1,
) {
  const store = new Map<string, Map<symbol, any>>(Object.entries(initialEntities));
  const systems = new Map<string, { phase: symbol; fn: () => void }>();
  let currentDt = dt;

  const world = {
    __resolve(_root: unknown, ref: { scene: string; path: string | string[] }) {
      const key = Array.isArray(ref.path) ? ref.path.join('/') : ref.path;
      return store.has(key) ? ok(key) : err(`Entity missing: ${key}`);
    },
    get(entity: string, comp: symbol) {
      const ent = store.get(entity);
      if (!ent || !ent.has(comp)) return err(`Component missing on ${entity}`);
      return ok(ent.get(comp));
    },
    set(entity: string, comp: symbol, data: any) {
      const ent = store.get(entity);
      if (!ent) return err(`Entity missing: ${entity}`);
      ent.set(comp, data);
      return ok(undefined);
    },
    hasComponent(entity: string, comp: symbol) {
      return Boolean(store.get(entity)?.has(comp));
    },
    addComponent(entity: string, spec: { component: symbol; data: any }) {
      const ent = store.get(entity);
      if (!ent) return err(`Entity missing: ${entity}`);
      ent.set(spec.component, spec.data);
      return ok(undefined);
    },
    removeComponent(entity: string, comp: symbol) {
      store.get(entity)?.delete(comp);
    },
    getResource(res: symbol) {
      if (res === tokens.Time) return ok({ delta: currentDt });
      return err('Unknown resource');
    },
    addSystem(phase: symbol, spec: { name: string; queries: unknown[]; fn: () => void }) {
      systems.set(spec.name, { phase, fn: spec.fn });
      return ok(undefined);
    },
    removeSystem(_phase: symbol, name: string) {
      systems.delete(name);
    },
  };

  const cleanups: Array<() => void> = [];
  const ctx = {
    world,
    gameHost: { defaultSceneRoot: 'root-entity' },
    effect(fn: () => (() => void) | Generator<() => void, void, unknown>, _tag?: string) {
      const res = fn();
      if (typeof res === 'function') {
        cleanups.push(res);
      } else if (res && typeof (res as Generator<() => void>).next === 'function') {
        const step = (res as Generator<() => void>).next();
        if (typeof step.value === 'function') cleanups.push(step.value);
      }
    },
  };

  return {
    world,
    ctx,
    store,
    systems,
    setDt: (next: number) => {
      currentDt = next;
    },
    stepUpdate: () => {
      for (const sys of systems.values()) sys.fn();
    },
    dispose: () => {
      for (const fn of cleanups) fn();
    },
  };
}

describe('ForgeaX Engine Showcase Interactive Deck', () => {
  test('氛围开关只针对实际存在的灯，并保留原值用于恢复', () => {
    const plugin = conceptLookPlugin({
      ambient: { components: { Skylight: { intensity: 1 } } },
      light_A: { components: { DirectionalLight: { intensity: 4 } } },
      light_B: { components: { PointLight: { intensity: 2 } } },
    });
    expect(plugin).toContain('light_A');
    expect(plugin).toContain('light_B');
    expect(plugin).toContain('originalAmbient');
    expect(plugin).toContain('entry.original');
    expect(plugin).not.toContain('RectAreaLight:RectAreaLight');
    expect(plugin).not.toContain('Fog');

    const ui = conceptLookUi("start\n const record=document.createElement('button');\nend");
    expect(ui).toContain('切换至概念氛围');
    expect(ui).toContain("kind:'scene-look'");
    expect(() => conceptLookUi('invalid')).toThrow('SCENE_LOOK_UI_MARKER_MISSING');
  });

  test('Concept 与 Neutral (Procedural Clay) 切换：工作室半球光、关闭相机泛光、方向主光归一化与雾效恢复', () => {
    const pluginCode = conceptLookPlugin({
      camera: { components: { Camera: {} } },
      ambient: { components: { Skylight: {} } },
      fog: { components: { Fog: {} } },
      sun: { components: { DirectionalLight: {} } },
      accent: { components: { PointLight: {} } },
      spot: { components: { SpotLight: {} } },
    });
    expect(pluginCode).toContain('Fog');

    const audit = { channelId: 'ch-1', specSha256: 'sha-demo' };
    const { plugin, tokens, messages, send } = instantiateGeneratedPlugin(pluginCode, audit);

    const origCam = { fov: 50, bloom: 1, bloomIntensity: 0.65, exposureMode: 1, exposure: 1.25 };
    const origAmb = { color: [0.12, 0.16, 0.28], groundColor: [0.02, 0.03, 0.05], intensity: 1.1 };
    const origFog = { color: [0.1, 0.15, 0.2], density: 0.02, maxOpacity: 0.75 };
    const origSun = { color: [1, 0.82, 0.65], intensity: 5.2, direction: [0.2, -0.9, 0.3] };
    const origAccent = { color: [0.1, 0.9, 1], intensity: 12 };
    const origSpot = { color: [1, 0.4, 0.1], intensity: 8 };

    const env = createMockWorld(tokens as any, {
      camera: new Map([[tokens.Camera as symbol, structuredClone(origCam)]]),
      ambient: new Map([[tokens.Skylight as symbol, structuredClone(origAmb)]]),
      fog: new Map([[tokens.Fog as symbol, structuredClone(origFog)]]),
      sun: new Map([[tokens.DirectionalLight as symbol, structuredClone(origSun)]]),
      accent: new Map([[tokens.PointLight as symbol, structuredClone(origAccent)]]),
      spot: new Map([[tokens.SpotLight as symbol, structuredClone(origSpot)]]),
    });

    plugin.apply(env.ctx);

    send({ kind: 'scene-look', look: 'neutral', specSha256: 'sha-demo' });

    const neutralCam = env.store.get('camera')!.get(tokens.Camera as symbol);
    expect(neutralCam).toEqual({
      fov: 50,
      bloom: 0,
      bloomIntensity: 0,
      exposureMode: 0,
      exposure: 0.85,
    });

    const neutralAmb = env.store.get('ambient')!.get(tokens.Skylight as symbol);
    expect(neutralAmb).toEqual({
      color: [0.68, 0.7, 0.74],
      groundColor: [0.28, 0.3, 0.33],
      intensity: 0.72,
    });

    const neutralFog = env.store.get('fog')!.get(tokens.Fog as symbol);
    expect(neutralFog.maxOpacity).toBe(0);
    expect(neutralFog.density).toBe(0.02);

    const neutralSun = env.store.get('sun')!.get(tokens.DirectionalLight as symbol);
    expect(neutralSun.color).toEqual([1, 1, 1]);
    expect(neutralSun.intensity).toBe(2.8);
    expect(Math.hypot(...neutralSun.direction)).toBeCloseTo(1, 6);
    const dirNorm = Math.hypot(-0.35, -0.8, -0.45);
    expect(neutralSun.direction[0]).toBeCloseTo(-0.35 / dirNorm, 6);
    expect(neutralSun.direction[1]).toBeCloseTo(-0.8 / dirNorm, 6);
    expect(neutralSun.direction[2]).toBeCloseTo(-0.45 / dirNorm, 6);

    expect(env.store.get('accent')!.get(tokens.PointLight as symbol).intensity).toBe(0);
    expect(env.store.get('spot')!.get(tokens.SpotLight as symbol).intensity).toBe(0);
    expect(messages.at(-1)).toEqual({ kind: 'scene-look-applied', look: 'neutral', specSha256: 'sha-demo' });

    // 切回概念氛围应完整恢复原始数据
    send({ kind: 'scene-look', look: 'concept', specSha256: 'sha-demo' });
    expect(env.store.get('camera')!.get(tokens.Camera as symbol)).toEqual(origCam);
    expect(env.store.get('ambient')!.get(tokens.Skylight as symbol)).toEqual(origAmb);
    expect(env.store.get('fog')!.get(tokens.Fog as symbol)).toEqual(origFog);
    expect(env.store.get('sun')!.get(tokens.DirectionalLight as symbol)).toEqual(origSun);
    expect(env.store.get('accent')!.get(tokens.PointLight as symbol)).toEqual(origAccent);
    expect(env.store.get('spot')!.get(tokens.SpotLight as symbol)).toEqual(origSpot);
    expect(messages.at(-1)).toEqual({ kind: 'scene-look-applied', look: 'concept', specSha256: 'sha-demo' });
  });

  test('ClippingPlanes 实时剖切检视支持 hall-z / core-y / diag / 自定义 offset 与 off 移除', () => {
    const pluginCode = conceptLookPlugin({
      camera: { components: { Camera: {} } },
      ambient: { components: { Skylight: {} } },
    });
    const audit = { channelId: 'ch-clip', specSha256: 'sha-clip' };
    const { plugin, tokens, messages, send } = instantiateGeneratedPlugin(pluginCode, audit);

    const env = createMockWorld(tokens as any, {
      camera: new Map([[tokens.Camera as symbol, { bloom: 1, bloomIntensity: 0.4, exposureMode: 0, exposure: 1 }]]),
      ambient: new Map([[tokens.Skylight as symbol, { color: [0.5, 0.5, 0.5], intensity: 1 }]]),
    });
    plugin.apply(env.ctx);

    expect(env.world.hasComponent('camera', tokens.ClippingPlanes as symbol)).toBe(false);

    send({ kind: 'scene-clip', mode: 'hall-z', specSha256: 'sha-clip' });
    expect(env.world.hasComponent('camera', tokens.ClippingPlanes as symbol)).toBe(true);
    expect(env.store.get('camera')!.get(tokens.ClippingPlanes as symbol)).toEqual({
      planes: [[-1, 0, 0, 0]],
      caps: true,
      clipShadows: false,
    });
    expect(messages.at(-1)).toEqual({ kind: 'scene-clip-applied', mode: 'hall-z', specSha256: 'sha-clip' });

    send({ kind: 'scene-clip', mode: 'core-y', specSha256: 'sha-clip' });
    expect(env.store.get('camera')!.get(tokens.ClippingPlanes as symbol)).toEqual({
      planes: [[0, -1, 0, 18.5]],
      caps: true,
      clipShadows: false,
    });

    send({ kind: 'scene-clip', mode: 'diag', offset: 4.5, specSha256: 'sha-clip' });
    expect(env.store.get('camera')!.get(tokens.ClippingPlanes as symbol)).toEqual({
      planes: [[-0.7071, 0, -0.7071, 4.5]],
      caps: true,
      clipShadows: false,
    });

    send({ kind: 'scene-clip', mode: 'off', specSha256: 'sha-clip' });
    expect(env.world.hasComponent('camera', tokens.ClippingPlanes as symbol)).toBe(false);
    expect(messages.at(-1)).toEqual({ kind: 'scene-clip-applied', mode: 'off', specSha256: 'sha-clip' });
  });

  test('scene-showcase-rig 系统注册、默认静止、万向环差速进动与反应堆悬浮、平滑复位及清理', () => {
    const pluginCode = conceptLookPlugin({
      camera: { components: { Camera: {} } },
      ambient: { components: { Skylight: {} } },
    });
    const audit = {
      channelId: 'ch-rig',
      specSha256: 'sha-rig',
      parts: [
        { id: 'outer_gimbal_ring', bindingKey: 'outer_ring' },
        { id: 'inner_band', bindingKey: 'inner_band' },
        { id: 'reactor_core', bindingKey: 'reactor_core' },
        { id: 'core_mast', bindingKey: 'core_mast' },
        { id: 'core_mount', bindingKey: 'core_mount' },
        { id: 'missing_ring', bindingKey: 'missing_ring' },
      ],
    };
    const { plugin, tokens, messages, isClosed, send } = instantiateGeneratedPlugin(pluginCode, audit);

    const ring1BaseRot = [0, 0, 0.258819, 0.9659258];
    const ring2BaseRot = [0.1736482, 0, 0, 0.9848078];
    const coreBasePos = [0, 18.5, 0];
    const coreBaseRot = [0, 0, 0, 1];
    const mastBasePos = [0, 10, 0];

    const env = createMockWorld(
      tokens as any,
      {
        camera: new Map([[tokens.Camera as symbol, { bloom: 0, bloomIntensity: 0, exposureMode: 0, exposure: 1 }]]),
        ambient: new Map([[tokens.Skylight as symbol, { color: [1, 1, 1], intensity: 1 }]]),
        'garden/outer_ring': new Map([
          [tokens.Transform as symbol, { position: [0, 18.5, 0], rotation: [...ring1BaseRot], scale: [1, 1, 1] }],
        ]),
        'garden/inner_band': new Map([
          [tokens.Transform as symbol, { position: [0, 18.5, 0], rotation: [...ring2BaseRot], scale: [1, 1, 1] }],
        ]),
        'garden/reactor_core': new Map([
          [tokens.Transform as symbol, { position: [...coreBasePos], rotation: [...coreBaseRot], scale: [1, 1, 1] }],
        ]),
        'garden/core_mast': new Map([
          [tokens.Transform as symbol, { position: [...mastBasePos], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }],
        ]),
        'garden/core_mount': new Map([
          [tokens.Transform as symbol, { position: [0, 16, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }],
        ]),
      },
      0.1,
    );

    plugin.apply(env.ctx);
    expect(env.systems.has('scene-showcase-rig')).toBe(true);

    // 默认 rigActive=false，帧更新不得改动任何 Transform，确保 capture.mjs 100% 确定性
    env.stepUpdate();
    expect(env.store.get('garden/outer_ring')!.get(tokens.Transform as symbol).rotation).toEqual(ring1BaseRot);
    expect(env.store.get('garden/reactor_core')!.get(tokens.Transform as symbol).position).toEqual(coreBasePos);

    // 开启机构运动
    send({ kind: 'scene-rig', active: true, specSha256: 'sha-rig' });
    expect(messages.at(-1)).toEqual({
      kind: 'scene-rig-applied',
      active: true,
      rigParts: 3,
      specSha256: 'sha-rig',
    });

    for (let i = 0; i < 6; i++) env.stepUpdate();

    const activeRing1 = env.store.get('garden/outer_ring')!.get(tokens.Transform as symbol);
    const activeRing2 = env.store.get('garden/inner_band')!.get(tokens.Transform as symbol);
    const activeCore = env.store.get('garden/reactor_core')!.get(tokens.Transform as symbol);
    const staticMast = env.store.get('garden/core_mast')!.get(tokens.Transform as symbol);

    expect(activeRing1.rotation).not.toEqual(ring1BaseRot);
    expect(activeRing2.rotation).not.toEqual(ring2BaseRot);
    expect(Math.hypot(...activeRing1.rotation)).toBeCloseTo(1, 5);
    expect(Math.hypot(...activeRing2.rotation)).toBeCloseTo(1, 5);
    expect(activeCore.position[1]).not.toBe(coreBasePos[1]);
    expect(activeCore.rotation).not.toEqual(coreBaseRot);
    // mast/mount 必须被排除，保持不动
    expect(staticMast.position).toEqual(mastBasePos);

    // 关闭机构运动，平滑复位至 baseQuat / basePos
    send({ kind: 'scene-rig', active: false, specSha256: 'sha-rig' });
    expect(messages.at(-1)).toEqual({
      kind: 'scene-rig-applied',
      active: false,
      rigParts: 3,
      specSha256: 'sha-rig',
    });

    for (let i = 0; i < 40; i++) env.stepUpdate();

    const restoredRing1 = env.store.get('garden/outer_ring')!.get(tokens.Transform as symbol);
    const restoredCore = env.store.get('garden/reactor_core')!.get(tokens.Transform as symbol);
    for (let i = 0; i < 4; i++) {
      expect(restoredRing1.rotation[i]).toBeCloseTo(ring1BaseRot[i], 5);
      expect(restoredCore.rotation[i]).toBeCloseTo(coreBaseRot[i], 5);
    }
    expect(restoredCore.position).toEqual(coreBasePos);

    // 执行 effect 清理，卸载 Update 系统并关闭通道
    env.dispose();
    expect(env.systems.has('scene-showcase-rig')).toBe(false);
    expect(isClosed()).toBe(true);
  });

  test('conceptLookUi 注入照明/剖切/机构三个 HUD 按钮、快捷键与 sceneAudit 通道过滤', () => {
    const rawUi = [
      'const sources=new Set<string>();',
      'channel.onmessage=e=>{if(e.data?.specSha256!==audit.specSha256)return;sources.add(e.data.sourceId);};',
      "const record=document.createElement('button');",
      'hud.append(record);',
      'const cleanup=()=>{channel.close();if(recorder)recorder.stop();};',
    ].join('\n');

    const transformed = conceptLookUi(rawUi);
    expect(transformed).toContain('切换至中性照明');
    expect(transformed).toContain('切换至概念氛围');
    expect(transformed).toContain('剖切: 关');
    expect(transformed).toContain('剖切: 纵剖');
    expect(transformed).toContain('剖切: 横剖');
    expect(transformed).toContain('剖切: 斜剖');
    expect(transformed).toContain('机构: 静止');
    expect(transformed).toContain('机构: 运转中');
    expect(transformed).toContain('KeyL');
    expect(transformed).toContain('KeyC');
    expect(transformed).toContain('KeyM');
    expect(transformed).toContain('scene-look-applied');
    expect(transformed).toContain('scene-clip-applied');
    expect(transformed).toContain('scene-rig-applied');

    // 验证转换后的 UI TypeScript 代码可被无错转译并在模拟 DOM 中正确交互
    const transpiler = new Bun.Transpiler({ loader: 'ts' });
    const js = transpiler.transformSync(transformed);

    const posted: any[] = [];
    const msgListeners: Array<(e: any) => void> = [];
    const keyListeners = new Set<(e: any) => void>();
    const hudChildren: any[] = [];

    const channel = {
      onmessage: null as ((e: any) => void) | null,
      addEventListener: (_type: string, fn: (e: any) => void) => msgListeners.push(fn),
      postMessage: (msg: any) => posted.push(msg),
      close: () => {},
    };
    const mockDoc = {
      createElement: (_tag: string) => {
        const btn: any = {
          textContent: '',
          title: '',
          disabled: false,
          style: { cssText: '' },
          onclick: null as (() => void) | null,
          click() {
            this.onclick?.();
          },
        };
        return btn;
      },
    };
    const mockWin = {
      addEventListener: (_type: string, fn: (e: any) => void) => keyListeners.add(fn),
      removeEventListener: (_type: string, fn: (e: any) => void) => keyListeners.delete(fn),
    };
    const hud = {
      append: (...els: any[]) => hudChildren.push(...els),
    };

    const runUi = new Function(
      'document',
      'window',
      'channel',
      'audit',
      'hud',
      'recorder',
      `${js}\nreturn { sources, cleanup };`,
    );
    const { sources, cleanup } = runUi(
      mockDoc,
      mockWin,
      channel,
      { specSha256: 'sha-ui' },
      hud,
      null,
    );

    // look, clip, rig 位于 record 之前
    expect(hudChildren.length).toBe(4);
    const [lookBtn, clipBtn, rigBtn] = hudChildren;
    expect(lookBtn.textContent).toBe('切换至中性照明');
    expect(clipBtn.textContent).toBe('剖切: 关');
    expect(rigBtn.textContent).toBe('机构: 静止');

    // 回执消息不得污染 sources (sceneAudit)
    for (const kind of ['scene-look-applied', 'scene-clip-applied', 'scene-rig-applied']) {
      channel.onmessage?.({ data: { kind, specSha256: 'sha-ui' } });
    }
    expect(sources.size).toBe(0);
    channel.onmessage?.({ data: { sourceId: 'engine-audit', specSha256: 'sha-ui' } });
    expect([...sources]).toEqual(['engine-audit']);

    // 快捷键 KeyL / KeyC / KeyM 与状态回执循环
    const fireKey = (code: string) => {
      for (const fn of keyListeners) fn({ code, ctrlKey: false, metaKey: false, altKey: false, repeat: false, target: null });
    };
    const emitChannel = (data: any) => {
      for (const fn of msgListeners) fn({ data });
    };

    fireKey('KeyL');
    expect(posted.at(-1)).toEqual({ kind: 'scene-look', look: 'neutral', specSha256: 'sha-ui' });
    emitChannel({ kind: 'scene-look-applied', look: 'neutral', specSha256: 'sha-ui' });
    expect(lookBtn.textContent).toBe('切换至概念氛围');

    const expectedClips: Array<[string, string]> = [
      ['hall-z', '剖切: 纵剖'],
      ['core-y', '剖切: 横剖'],
      ['diag', '剖切: 斜剖'],
      ['off', '剖切: 关'],
    ];
    for (const [mode, label] of expectedClips) {
      fireKey('KeyC');
      expect(posted.at(-1)).toEqual({ kind: 'scene-clip', mode, specSha256: 'sha-ui' });
      emitChannel({ kind: 'scene-clip-applied', mode, specSha256: 'sha-ui' });
      expect(clipBtn.textContent).toBe(label);
    }

    fireKey('KeyM');
    expect(posted.at(-1)).toEqual({ kind: 'scene-rig', active: true, specSha256: 'sha-ui' });
    emitChannel({ kind: 'scene-rig-applied', active: true, rigParts: 3, specSha256: 'sha-ui' });
    expect(rigBtn.textContent).toBe('机构: 运转中');

    cleanup();
    expect(keyListeners.size).toBe(0);
  });
});
