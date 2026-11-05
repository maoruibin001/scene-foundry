/** 规格生成器库:规格里 family.generator.id 引用这里的实现;未实现的 ID 由导出器按手册 4.3 回退为同 ID 灰模代理。 */
import type {Generator} from './kit.ts';
import {GEN_CONTROLROOM} from './gen-controlroom.ts';
import {GEN_CORE} from './gen-core.ts';
import {GEN_ENTRY} from './gen-entry.ts';
import {GEN_BRACE,GEN_INDUSTRIALDOOR,GEN_LUMINAIRE,GEN_RINGMOUNT,GEN_SOCKET,GEN_STAIR} from './gen-fixtures.ts';
import {GEN_FLOOR} from './gen-floor.ts';
import {GEN_GLASS} from './gen-glass.ts';
import {GEN_HALL} from './gen-hall.ts';
import {GEN_CABLE,GEN_CABLETRAY,GEN_CRANERAIL,GEN_DISCHARGE,GEN_PIPE} from './gen-infra.ts';
import {GEN_PILLAR_HERO} from './gen-pillar-hero.ts';
import {GEN_NODE} from './gen-node.ts';
import {GEN_NODEBEAM} from './gen-nodebeam.ts';
import {GEN_POOL} from './gen-pool.ts';
import {GEN_CABINET,GEN_CARRIER,GEN_CONSOLE,GEN_DRESSING,GEN_PROP} from './gen-props.ts';
import {GEN_RING} from './gen-ring.ts';
import {GEN_WALK} from './gen-walk.ts';

export const GENERATORS:Record<string,Generator<any>>=Object.fromEntries([
 GEN_BRACE,GEN_CABINET,GEN_CABLE,GEN_CABLETRAY,GEN_CARRIER,GEN_CONSOLE,GEN_CONTROLROOM,GEN_CORE,GEN_CRANERAIL,GEN_DISCHARGE,GEN_DRESSING,GEN_ENTRY,
 GEN_FLOOR,GEN_GLASS,GEN_PILLAR_HERO,GEN_HALL,GEN_INDUSTRIALDOOR,GEN_LUMINAIRE,GEN_NODE,GEN_NODEBEAM,GEN_PIPE,GEN_POOL,GEN_PROP,GEN_RING,GEN_RINGMOUNT,GEN_SOCKET,GEN_STAIR,GEN_WALK,
].map(g=>[g.id,g]));
/** 导出时随生成器一起复制进游戏工程的源文件(pack 构建时在引擎里运行)。 */
export const GENERATOR_SOURCES=['kit.ts','index.ts','parts.ts','gen-controlroom.ts','gen-core.ts','gen-entry.ts','gen-fixtures.ts','gen-floor.ts','gen-glass.ts','gen-hall.ts','gen-infra.ts','gen-node.ts','gen-nodebeam.ts','gen-pillar-hero.ts','gen-pool.ts','gen-props.ts','gen-ring.ts','gen-walk.ts','textures.ts'];
