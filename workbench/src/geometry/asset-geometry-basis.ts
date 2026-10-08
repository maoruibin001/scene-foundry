import {digest} from '../store';
import {stable} from '../validated-cache';

export const ASSET_GEOMETRY_BASIS='accepted-local-geometry-v1';
/** The accepted local shape is a construction basis, not a finished asset or a quality score. */
export function assetGeometryBasis(scene:any,templateId:string){
 if(scene==null)return null;
 const matches=scene.program?.templates?.filter((t:any)=>t.id===templateId)??[];
 if(matches.length!==1||!matches[0].parts?.length)throw Error('ASSET_GEOMETRY_BASIS_MISSING：已验收灰模缺少唯一模板 '+templateId);
 const template={id:templateId,parts:matches[0].parts.map((p:any)=>({id:p.id,position:structuredClone(p.position),rotation:structuredClone(p.rotation),scale:structuredClone(p.scale),shape:structuredClone(p.shape)}))};
 return {version:ASSET_GEOMETRY_BASIS,sha256:digest(stable({version:ASSET_GEOMETRY_BASIS,template})),template,
  instructions:'这是已通过空间验收的真实局部灰模结构，不是最终成品。以它的承托、连接、开口和大轮廓为细化起点，依据原图改善曲面、细节、材质与UV；可合理拆并非程序部件，不必保留灰模的低细分或灰色外观。不得退回只凭bounds重新猜结构或用实心大块填掉已有开口。branchCrown仍遵守单独的结构保持规则。最终质量由真实场景独立评审。'};
}

/** Unknown legacy provenance is a reuse miss; it must not be relabelled as the current basis. */
export function assetGeometryBasisMatches(source:any,scene:any,templateId:string){
 const expected=assetGeometryBasis(scene,templateId)?.sha256??null;
 return (source?.acceptedGeometrySha256??null)===expected;
}

export function verifyAssetGeometryBasis(basis:any,sha256:string,templateId:string){
 try{return basis?.version===ASSET_GEOMETRY_BASIS&&basis.template?.id===templateId&&basis.sha256===sha256&&assetGeometryBasis({program:{templates:[basis.template]}},templateId)?.sha256===sha256;}catch{return false;}
}
