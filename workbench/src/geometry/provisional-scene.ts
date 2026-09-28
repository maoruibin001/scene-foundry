import {assembleScene,type SceneLayout,type AssetGeometry} from './layout';
import {digest} from '../store';
/** Only existing geometry from THIS accepted spatial layout may stand in for unfinished detail. */
export function provisionalScene(layout:SceneLayout,assets:AssetGeometry[],gray:any,plan:any,count:number){
 const ids=new Set(assets.map(a=>a.template.id));if(ids.size!==assets.length)throw Error('草稿资产身份重复');
 const missing=layout.program.templates.filter(t=>!ids.has(t.id)).map(t=>t.id);
 if(!missing.length)return {scene:assembleScene(layout,assets,plan,count),missing:[]};
 const spatial=(xs:any[])=>xs.map(({surfaceOverrides,...i})=>i);
 if(!gray||digest(JSON.stringify(spatial(gray.program.instances)))!==digest(JSON.stringify(spatial(layout.program.instances)))||digest(JSON.stringify(gray.cameras))!==digest(JSON.stringify(layout.cameras)))throw Error('草稿灰模与当前冻结空间不一致');
 const materialId='delivery_gray';if(layout.program.materials.some(m=>m.id===materialId))throw Error('草稿材质身份冲突');
 const additions=missing.map(id=>{const t=gray.program.templates.find(t=>t.id===id);if(!t?.parts?.length)throw Error('没有真实已生成灰模：'+id);return {version:'asset-geometry-v1' as const,template:{...t,parts:t.parts.map(p=>({...p,material:materialId}))}};});
 const draft={...layout,program:{...layout.program,materials:[...layout.program.materials,{id:materialId,color:[.52,.55,.58,1] as [number,number,number,number],roughness:.85,metallic:0,textureId:null}],instances:layout.program.instances.map(i=>missing.includes(i.template)?{...i,surfaceOverrides:[]}:i)}};
 return {scene:assembleScene(draft,[...assets,...additions],plan,count),missing};
}
