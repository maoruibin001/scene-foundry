import {test,expect} from 'bun:test';
import {modelSchema,normalizeModelValue} from '../model-schema';
import {assertRoleTools} from '../codex-tools';
import {modelTimeoutMs,modelTimeoutPolicy} from '../model-selection';
import {roleSettings,OPTIMIZATION_POLICY} from '../generation-policy';
import {phaseStage} from '../stage-display';
import {checkpointInput} from '../geometry/checkpoints';
import {stageContract} from '../stage-contract';
import {cacheEnabled} from '../validated-cache';

const lattice={version:'voxel-lattice-v1' as const,cellSize:.1,origin:[0,0,0] as [number,number,number]};
test('voxel entity schema freezes one native template and materials, never whole scene entities',()=>{
 const schema=modelSchema('voxel-entity',{voxelLattice:lattice,templateId:'unit',materialIds:['stone'],maxParts:8});
 expect(schema.properties.template.properties.id.enum).toEqual(['unit']);
 expect(schema.properties.template.properties.parts.maxItems).toBe(8);
 expect(schema.properties.template.properties.parts.items.properties.material.enum).toEqual(['stone']);
 expect(schema.properties.entities).toBeUndefined();
 const shape=schema.properties.template.properties.parts.items.properties.shape;
 expect(JSON.stringify(shape)).toContain('voxelVolume');
 expect(JSON.stringify(shape)).not.toContain('indexedMesh');
 expect(()=>modelSchema('voxel-entity')).toThrow('格网');
 const value={version:'asset-geometry-v1',template:{id:'unit',parts:[]}};
 expect(normalizeModelValue('voxel-entity',value)).toBe(value);
});
test('detail role gets the same limited asset tools, not arbitrary scene repair capabilities',()=>{
 const kit=(version:string,names:string[])=>({version,instructions:'',definitions:names.map(name=>({name})),call:async()=>({content:[]})});
 expect(()=>assertRoleTools('voxel-entity',kit('asset-checkpoint-preview-v1',['save_asset_parts','inspect_asset_parts','check_asset','preview_saved_asset']))).not.toThrow();
 expect(()=>assertRoleTools('voxel-entity',kit('asset-preview-context-v2',['preview_asset']))).not.toThrow();
 expect(()=>assertRoleTools('voxel-entity',kit('repair-preview-v1',['render_scene_patch']))).toThrow('不允许');
});
test('detail retains asset reasoning caps and timeouts; no hidden model/depth escalation',()=>{
 const base={model:'gpt-6-astra',reasoningEffort:'xhigh'};
 for(const policy of [OPTIMIZATION_POLICY,{...OPTIMIZATION_POLICY,matchingLevel:'standard'}])expect(roleSettings(base,'voxel-entity',policy)).toEqual(roleSettings(base,'geometry-asset',policy));
 expect(modelTimeoutMs('xhigh','voxel-entity')).toBe(modelTimeoutMs('xhigh','geometry-asset'));
 expect(modelTimeoutPolicy('high','voxel-entity')).toEqual(modelTimeoutPolicy('high','geometry-asset'));
 expect(phaseStage('体素逐组件精修（最多并发 4 类）')).toBe('assets');
});
test('new policy participates in checkpoint identity and validated stage source fingerprints',()=>{
 const old={id:'original',reuseMode:'fresh',modelSettings:{model:'gpt-6-astra',reasoningEffort:'high'},images:[],prompt:'参考图',complexity:'simple'};
 expect(checkpointInput(old)).not.toHaveProperty('voxelDetailPolicy');
 expect(checkpointInput({...old,voxelDetailPolicy:'voxel-detail-v1'})).toHaveProperty('voxelDetailPolicy','voxel-detail-v1');
 const schemaContext={voxelLattice:lattice};
 expect(stageContract({role:'voxel-entity',schemaContext})).toMatch(/^[a-f0-9]{64}$/);
 expect(stageContract({role:'voxel-entity',schemaContext})).not.toBe(stageContract({role:'geometry-asset',schemaContext}));
 expect(cacheEnabled({optimizationPolicy:{reuse:true}},'voxel-entity')).toBe(true);
 expect(cacheEnabled({reuseMode:'fresh',optimizationPolicy:{reuse:true}},'voxel-entity')).toBe(false);
});
