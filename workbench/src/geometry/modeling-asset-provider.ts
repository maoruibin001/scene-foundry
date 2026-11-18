// 引擎程序化资产提供者(与 LLM createAssetConstruction 并列的 AssetProvider)。
// 契约见 ~/scene-foundry-verify/research/engine-asset-integration/CONTRACT.md §1/§3.6。
// 职责:把"一个物体的网格"(由 @forgeax/engine modeling 内核 author/bake,或任何等价来源)
// 装成 scene-foundry 的 indexedMesh 部件,贴合 brief.bounds、只用 brief.materialIds,
// 经既有 validateAsset/compileGeometryProgram 校验与装配。摆位/相机/校验全不变。
import type {AssetGeometry,AssetBrief,SceneLayout} from './layout';
import type {Texture} from './program';

export type AssetMesh={positions:number[][];triangles:[number,number,number][]};
export type MeshSource=(input:{brief:AssetBrief;layout:SceneLayout;textures:Record<string,Texture>;signal?:AbortSignal})=>Promise<AssetMesh>;

// 把局部网格的 AABB 映射到 brief.bounds:part.scale 填满各轴跨度,part.position 对齐中心。
// 非均匀缩放是刻意的——物体应填满布局分配的尺寸框(= 冻结布局给的真实尺寸)。
export function meshToAssetGeometry(brief:AssetBrief,mesh:AssetMesh):AssetGeometry{
 if(!mesh.positions.length||!mesh.triangles.length)throw Error('引擎资产网格为空:'+brief.id);
 const mx=mesh.triangles.reduce((m,[a,b,c])=>Math.max(m,a,b,c),0);
 if(mx>=mesh.positions.length)throw Error('引擎资产三角索引越界:'+brief.id);
 const mn=[Infinity,Infinity,Infinity],mxv=[-Infinity,-Infinity,-Infinity];
 for(const p of mesh.positions)for(let k=0;k<3;k++){mn[k]=Math.min(mn[k],p[k]);mxv[k]=Math.max(mxv[k],p[k]);}
 const bmn=brief.bounds.min,bmx=brief.bounds.max;
 const scale=[0,1,2].map(k=>{const sz=mxv[k]-mn[k],bs=bmx[k]-bmn[k];return sz>1e-6?Math.min(100,Math.max(.001,bs/sz)):1;});
 const position=[0,1,2].map(k=>(bmn[k]+bmx[k])/2-scale[k]*(mn[k]+mxv[k])/2);
 return {version:'asset-geometry-v1',template:{id:brief.id,parts:[{
  id:brief.id,material:brief.materialIds[0],
  shape:{type:'indexedMesh',positions:mesh.positions as any,triangles:mesh.triangles},
  position:position as any,rotation:[0,0,0],scale:scale as any,
 } as any]}};
}

// 构造 AssetProvider:从 meshSource 取物体网格,装成 AssetGeometry。
export function createModelingAssetProvider(source:MeshSource){
 return async(input:{brief:AssetBrief;layout:SceneLayout;textures:Record<string,Texture>;signal?:AbortSignal}):Promise<AssetGeometry>=>{
  const mesh=await source(input);
  return meshToAssetGeometry(input.brief,mesh);
 };
}

// 默认 meshSource:从 @forgeax/engine modeling 内核(本地自建 dist)按 brief author 网格。
// 内核 dist 路径由 FORGEAX_MODELING_DIST 提供(portable:不写死本机路径,见 [[portable-repo-no-local-defaults]])。
// author 函数由 FORGEAX_MODELING_AUTHOR 指定(一个导出 default(input)=>AssetMesh|MeshAsset 的 .mjs)。
// 未配置则报错,指明如何接——不静默回退,避免"跑了但没用引擎"。
export function modelingKernelSource():MeshSource{
 return async({brief,layout,textures,signal})=>{
  const authorPath=process.env.FORGEAX_MODELING_AUTHOR;
  if(!authorPath)throw Error('PIPELINE_ASSET_PROVIDER=modeling 需要 FORGEAX_MODELING_AUTHOR 指向一个 author 模块(default 导出 (input)=>{positions,triangles})');
  const mod=await import(authorPath);
  const out=await (mod.default??mod.author)({brief,layout,textures,signal,modelingDist:process.env.FORGEAX_MODELING_DIST});
  return normalizeMesh(out);
 };
}

// 兼容两种来源:已是 {positions,triangles};或 @forgeax/engine modeling 的 MeshAsset(vertices Float[]×12/顶点 + indices + attributes.position)。
export function normalizeMesh(out:any):AssetMesh{
 if(out&&Array.isArray(out.positions)&&Array.isArray(out.triangles))return out as AssetMesh;
 const asset=out?.value?unwrapMeshAsset(out.value):out;
 if(asset&&asset.kind==='mesh'&&asset.attributes?.position&&asset.indices){
  const pos=asset.attributes.position,positions:number[][]=[];
  for(let i=0;i<pos.length;i+=3)positions.push([pos[i],pos[i+1],pos[i+2]]);
  const idx=asset.indices,triangles:[number,number,number][]=[];
  for(let i=0;i<idx.length;i+=3)triangles.push([idx[i],idx[i+1],idx[i+2]]);
  return {positions,triangles};
 }
 throw Error('无法识别的引擎资产网格格式');
}
function unwrapMeshAsset(value:any){
 if(value&&value.kind==='mesh')return value;
 for(const k of Object.keys(value||{}))if(value[k]?.kind==='mesh')return value[k];
 return value;
}
