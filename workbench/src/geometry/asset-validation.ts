import {validateAsset,validateAssetParts,type AssetGeometry,type AssetBrief,type SceneLayout} from './layout';
import type {Texture} from './program';
import {assetTriangleBudget} from './triangle-budget';

/** Preview and final selection must satisfy the same instance-expanded allocation. */
export function validateAllocatedAsset(value:AssetGeometry,brief:AssetBrief,layout:SceneLayout,textures:Record<string,Texture>){
 return withAllocatedBudget(validateAsset(value,brief,layout,textures),brief,layout);
}
/** Checkpoints are incomplete drafts. Only final validation can authorize asset selection. */
export function validateAllocatedAssetParts(value:AssetGeometry,brief:AssetBrief,layout:SceneLayout,textures:Record<string,Texture>){
 return withAllocatedBudget(validateAssetParts(value,brief,layout,textures),brief,layout);
}
function withAllocatedBudget<T extends {triangles:number}>(measured:T,brief:AssetBrief,layout:SceneLayout){
 const budget=assetTriangleBudget(layout,brief);
 if(measured.triangles>budget.maximum)throw Error('当前资产三角形 '+measured.triangles+' 超过分配额度 '+budget.maximum+'；该模板实例数 '+budget.instances+'。保留关键轮廓和结构，减少散布密度或曲面细分，不改变空间关系。');
 return {...measured,budget};
}
