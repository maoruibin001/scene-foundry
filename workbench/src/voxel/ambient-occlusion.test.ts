import {test,expect} from 'bun:test';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {bindVoxelAmbientOcclusion} from './ambient-occlusion';

test('the recording camera gains AO once, and a changed camera template is refused',()=>{
 const world=readFileSync(join(import.meta.dirname,'../../../prototype/game/assets/world.pack.ts'),'utf8'),bound=bindVoxelAmbientOcclusion(world);
 expect(bound.split('AmbientOcclusion:{').length).toBe(2);expect(bound).toMatch(/import \{[^}]*, AmbientOcclusion \} from '@forgeax\/engine\/render'/);
 expect(()=>bindVoxelAmbientOcclusion(world.replace("Name:{value:'Recording camera'}","Name:{value:'Camera'}"))).toThrow('未应用体素环境光遮蔽');
});
